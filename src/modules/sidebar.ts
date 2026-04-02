import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { AIService } from "../services/ai-service";
import {
  askPrompt,
  initPaperPrompt,
  paperSummaryPrompt,
  sessionTitlePrompt,
  summarizeHistoryPrompt,
} from "../services/prompts";
import { getContextByMode, getFullText } from "./pdf-context";
import type { ContextInfo } from "../services/prompts";
import { loadServices, getActiveServiceId, setActiveServiceId, getActiveService } from "../utils/services";
import { getPreset } from "../utils/provider-presets";
import { buildContextMessages, truncateDocContext } from "../services/context-builder";
import type { ChatMessage, ChatSession, ContextMode } from "../addon";
import { chatStore } from "../services/chat-store";
import {
  buildSlashCommands,
  consumeSlashToken,
  filterSlashCommands,
  parseSlashToken,
  type SlashCommand,
  type SlashToken,
} from "./slash-commands";
import {
  getPaperOverviewPath,
  loadPaperOverview,
  savePaperOverview,
} from "../services/paper-overview";
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_PENDING_IMAGES,
  extractImagesFromClipboard,
  isImageFile,
  optimizeImage,
  readFileAsDataURL,
} from "../utils/image-utils";

let sectionPaneID: string | null = null;
let activeBody: HTMLElement | null = null;
let activeXHR: XMLHttpRequest | null = null;
let isGenerating = false;
const slashStateByPane = new Map<
  string,
  {
    token: SlashToken;
    commands: SlashCommand[];
    activeIndex: number;
  }
>();

// ===================== Section Data Loading =====================

function loadSectionData(body: HTMLElement, item: any) {
  const reader = getActiveReader();
  const itemId = resolveAttachmentItemId(reader, item);
  if (itemId > 0) {
    applySectionData(body, reader, itemId);
  }
}

function applySectionData(
  body: HTMLElement,
  reader: _ZoteroTypes.ReaderInstance | null,
  itemId: number,
) {
  addon.data.chat.pendingImages = [];
  body.dataset.itemID = String(itemId);
  addon.data.popup.currentReader = reader;
  const session = chatStore.getSession(itemId);
  if (session) {
    addon.data.chat.contextMode = session.contextMode;
  }
  renderMessages(body, itemId);
  syncContextSelector(body, itemId);
  syncLayoutState(body, itemId);
  syncPrefill(body);
  refreshPendingImagesPreview(body);
}

// ===================== Item Resolution =====================

function resolveAttachmentItemId(
  reader: _ZoteroTypes.ReaderInstance | null,
  item: any,
): number {
  if (reader?._item?.id) return reader._item.id;
  if (!item) return 0;
  const id = Number(item.id) || 0;
  if (id <= 0) return 0;

  try {
    if (typeof item.isAttachment === "function" && item.isAttachment()) {
      return id;
    }
  } catch (_e) { /* ignore */ }

  return 0;
}

// ===================== Registration =====================

export function registerAgentSection() {
  try {
    const result = (Zotero.ItemPaneManager as any).registerSection({
      paneID: "zoteroagent-chat",
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID("itemPaneSection-header"),
        icon: `chrome://${config.addonRef}/content/icons/section-16.svg`,
      },
      sidenav: {
        l10nID: getLocaleID("itemPaneSection-sidenav"),
        icon: `chrome://${config.addonRef}/content/icons/section-20.svg`,
        // @ts-ignore
        orderable: false,
      },
      onInit: ({ body, setEnabled }: { body: HTMLElement; setEnabled: (v: boolean) => void }) => {
        setEnabled(true);
        const paneUID = Zotero.Utilities.randomString(8);
        body.dataset.paneUid = paneUID;
      },
      onDestroy: ({ body }: { body: HTMLElement }) => {
        clearSlashState(body);
        delete body.dataset.paneUid;
      },
      onItemChange: ({
        setEnabled,
        tabType,
        item,
        body,
      }: {
        setEnabled: (v: boolean) => void;
        tabType: string;
        item: any;
        body: HTMLElement;
      }) => {
        setEnabled(tabType === "reader");
        if (item) {
          body.dataset.itemID = String(item.id);
        }
        return true;
      },
      onRender: ({ body, item }: { body: HTMLElement; item: any }) => {
        activeBody = body;
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.overflow = "hidden";
        body.style.minWidth = "0";
        body.style.width = "100%";
        body.style.maxWidth = "100%";
        body.style.boxSizing = "border-box";

        ensureChatUI(body);
        loadSectionData(body, item);
        onUpdateHeight({ body });
      },
      sectionButtons: [
        {
          type: "fullHeight",
          icon: `chrome://${config.addonRef}/content/icons/full-16.svg`,
          l10nID: getLocaleID("itemPaneSection-fullHeight"),
          onClick: ({ body }: { body: HTMLElement }) => {
            const details = body.closest("item-details");
            onUpdateHeight({ body });
            // @ts-ignore item-details is a Zotero custom element
            details?.scrollToPane?.(sectionPaneID);
          },
        },
      ],
    });
    if (result && typeof result === "string") {
      sectionPaneID = result;
    }
  } catch (e) {
    ztoolkit.log("[Agent] registerAgentSection error:", e);
  }
}

function onUpdateHeight({ body }: { body: HTMLElement }) {
  try {
    const details = body.closest("item-details");
    const head = body
      .closest("item-pane-custom-section")
      ?.querySelector(".head");
    if (!details || !head) return;
    const viewItem = details.querySelector(".zotero-view-item");
    if (!viewItem) return;
    const height = viewItem.clientHeight - head.clientHeight - 8;
    if (height > 0) {
      body.style.height = `${height}px`;
      body.style.setProperty("--details-height", `${height}px`);
    }
  } catch (_e) {
    // ignore
  }
}

export function unregisterAgentSection() {
  try {
    if (sectionPaneID) {
      Zotero.ItemPaneManager.unregisterSection(sectionPaneID);
      sectionPaneID = null;
    }
  } catch (_e) {
    // ignore
  }
  activeBody = null;
}

export function updateSidebarPanels() {
  try {
    if (!activeBody) return;
    const reader = getActiveReader();
    const itemId = reader?._item?.id || Number(activeBody.dataset.itemID) || 0;
    if (itemId <= 0) return;
    applySectionData(activeBody, reader, itemId);
    onUpdateHeight({ body: activeBody });
  } catch (_e) {
    // ignore
  }
}

export function showAgentPanel() {
  updateSidebarPanels();
}

// ===================== Chat UI =====================

function ensureChatUI(body: HTMLElement) {
  if (body.querySelector("#zoteroagent-chat-panel")) return;

  const doc = body.ownerDocument;
  const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.id = "zoteroagent-chat-panel";
  container.className = "zoteroagent-chat-panel";
  body.dataset.chatMode = "chat";

  const messagesDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  messagesDiv.id = "zoteroagent-chat-messages";
  messagesDiv.className = "zoteroagent-chat-messages";

  const sessionRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  sessionRow.id = "zoteroagent-session-row";
  sessionRow.className = "zoteroagent-session-row";

  const sessionSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  sessionSelect.id = "zoteroagent-session-select";
  sessionSelect.className = "zoteroagent-session-select";
  sessionSelect.style.display = "none";

  const sessionTitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  sessionTitle.id = "zoteroagent-session-title";
  sessionTitle.className = "zoteroagent-session-title";
  sessionTitle.textContent = "New chat";

  const newSessionBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  newSessionBtn.id = "zoteroagent-session-new";
  newSessionBtn.className = "zoteroagent-session-action icon-only";
  setIconButton(newSessionBtn, "new", "New session");

  const historyBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  historyBtn.id = "zoteroagent-session-history";
  historyBtn.className = "zoteroagent-session-action icon-only";
  setIconButton(historyBtn, "history", "History");

  const renameSessionBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  renameSessionBtn.id = "zoteroagent-session-rename";
  renameSessionBtn.className = "zoteroagent-session-action icon-only";
  setIconButton(renameSessionBtn, "rename", "Rename session");

  const deleteSessionBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  deleteSessionBtn.id = "zoteroagent-session-delete";
  deleteSessionBtn.className = "zoteroagent-session-action danger icon-only";
  setIconButton(deleteSessionBtn, "delete", "Delete session");

  const historyPanel = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  historyPanel.id = "zoteroagent-history-panel";
  historyPanel.className = "zoteroagent-history-panel";
  historyPanel.style.display = "none";

  sessionRow.appendChild(sessionTitle);
  sessionRow.appendChild(sessionSelect);
  sessionRow.appendChild(newSessionBtn);
  sessionRow.appendChild(historyBtn);
  sessionRow.appendChild(renameSessionBtn);
  sessionRow.appendChild(deleteSessionBtn);

  const inputArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputArea.id = "zoteroagent-input-area";
  inputArea.className = "zoteroagent-input-area";

  const refCard = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refCard.id = "zoteroagent-reference-card";
  refCard.className = "zoteroagent-reference-card";
  refCard.style.display = "none";

  const refHeader = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refHeader.className = "zoteroagent-reference-header";
  const refLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  refLabel.className = "zoteroagent-reference-label";
  refLabel.textContent = "Reference text";
  const refDismiss = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  refDismiss.className = "zoteroagent-reference-dismiss";
  refDismiss.innerHTML = "&#x2715;";
  refDismiss.title = "Remove reference";
  refHeader.appendChild(refLabel);
  refHeader.appendChild(refDismiss);

  const refBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refBody.className = "zoteroagent-reference-body";
  const refContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refContent.className = "zoteroagent-reference-content";
  const refFade = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  refFade.className = "zoteroagent-reference-fade";
  refBody.appendChild(refContent);
  refBody.appendChild(refFade);

  refCard.appendChild(refHeader);
  refCard.appendChild(refBody);

  const slashMenu = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  slashMenu.id = "zoteroagent-slash-menu";
  slashMenu.className = "zoteroagent-slash-menu";
  slashMenu.style.display = "none";

  const composeArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  composeArea.id = "zoteroagent-compose-area";
  composeArea.className = "zoteroagent-compose-area";

  const textarea = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "textarea",
  ) as HTMLTextAreaElement;
  textarea.id = "zoteroagent-chat-input";
  textarea.rows = 3;
  textarea.placeholder = "Ask about this paper... Type / for actions";

  const actionsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsRow.id = "zoteroagent-actions-row";
  actionsRow.className = "zoteroagent-actions-row";

  const actionsLeft = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsLeft.className = "zoteroagent-actions-left";

  const uploadBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  uploadBtn.id = "zoteroagent-upload-btn";
  uploadBtn.className = "zoteroagent-upload-btn zoteroagent-icon-button";
  uploadBtn.type = "button";
  setIconButton(uploadBtn as HTMLButtonElement, "attach", "Upload images");

  const uploadInput = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "input",
  ) as HTMLInputElement;
  uploadInput.id = "zoteroagent-upload-input";
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.multiple = true;
  uploadInput.style.display = "none";

  const contextSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  contextSelect.id = "zoteroagent-context-mode";
  contextSelect.className = "zoteroagent-context-select";
  for (const [val, text] of [
    ["none", "Chat"],
    ["currentPage", "Current page"],
  ]) {
    const opt = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = val;
    opt.textContent = text;
    contextSelect.appendChild(opt);
  }

  const serviceSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  serviceSelect.id = "zoteroagent-service-select";
  serviceSelect.className = "zoteroagent-service-select";
  populateServiceOptions(serviceSelect);

  const actionsRight = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsRight.className = "zoteroagent-actions-right";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.textContent = "Send";

  actionsLeft.appendChild(uploadBtn);
  actionsLeft.appendChild(contextSelect);
  actionsLeft.appendChild(serviceSelect);
  actionsRight.appendChild(sendBtn);
  actionsRow.appendChild(actionsLeft);
  actionsRow.appendChild(actionsRight);

  const imagePreview = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  imagePreview.id = "zoteroagent-image-preview";
  imagePreview.className = "zoteroagent-image-preview";
  imagePreview.style.display = "none";

  composeArea.appendChild(textarea);
  composeArea.appendChild(imagePreview);
  composeArea.appendChild(actionsRow);
  composeArea.appendChild(uploadInput);

  const statusBar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  statusBar.id = "zoteroagent-status-bar";
  statusBar.className = "zoteroagent-status-bar";
  const statusText = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  statusText.id = "zoteroagent-status-text";
  statusText.className = "zoteroagent-status-text ready";
  statusText.textContent = "Ready";
  statusBar.appendChild(statusText);

  inputArea.appendChild(refCard);
  inputArea.appendChild(slashMenu);
  inputArea.appendChild(composeArea);
  inputArea.appendChild(statusBar);

  const headerWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  headerWrap.className = "zoteroagent-header-wrap";
  headerWrap.appendChild(sessionRow);
  headerWrap.appendChild(historyPanel);

  container.appendChild(headerWrap);
  container.appendChild(messagesDiv);
  container.appendChild(inputArea);
  body.appendChild(container);

  bindChatEvents(body);
}

function bindChatEvents(body: HTMLElement) {
  body.querySelector("#zoteroagent-chat-send")?.addEventListener("click", () => {
    void submitQuestion(body);
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("keydown", (event) => {
    const ke = event as KeyboardEvent;
    if (handleSlashMenuKeydown(body, ke)) {
      return;
    }
    if (ke.key === "Enter" && !ke.shiftKey) {
      event.preventDefault();
      void submitQuestion(body);
    }
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("input", () => {
    updateSlashMenuForInput(body);
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("click", () => {
    updateSlashMenuForInput(body);
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("keyup", () => {
    updateSlashMenuForInput(body);
  });
  body.querySelector("#zoteroagent-chat-input")?.addEventListener("paste", (event) => {
    const pe = event as ClipboardEvent;
    const files = extractImagesFromClipboard(pe);
    if (!files.length) return;
    pe.preventDefault();
    pe.stopPropagation();
    void processIncomingImages(body, files);
  });
  body.querySelector("#zoteroagent-upload-btn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const input = body.querySelector("#zoteroagent-upload-input") as HTMLInputElement | null;
    input?.click();
  });
  body.querySelector("#zoteroagent-upload-input")?.addEventListener("change", (event) => {
    const files = Array.from((event.target as HTMLInputElement).files || []);
    (event.target as HTMLInputElement).value = "";
    void processIncomingImages(body, files);
  });
  const dropZone = body.querySelector("#zoteroagent-input-area") as HTMLElement | null;
  if (dropZone) {
    let dragDepth = 0;
    const setDragActive = (active: boolean) => {
      dropZone.classList.toggle("is-drag-active", active);
    };
    dropZone.addEventListener("dragenter", (event) => {
      const de = event as DragEvent;
      if (!hasFileDragData(de)) return;
      event.preventDefault();
      dragDepth += 1;
      setDragActive(true);
    });
    dropZone.addEventListener("dragover", (event) => {
      const de = event as DragEvent;
      if (!hasFileDragData(de)) return;
      event.preventDefault();
      if (de.dataTransfer) de.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    });
    dropZone.addEventListener("dragleave", (event) => {
      const de = event as DragEvent;
      if (!hasFileDragData(de)) return;
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    });
    dropZone.addEventListener("drop", (event) => {
      const de = event as DragEvent;
      if (!hasFileDragData(de)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepth = 0;
      setDragActive(false);
      const files = Array.from(de.dataTransfer?.files || []).filter((file) => isImageFile(file));
      void processIncomingImages(body, files);
    });
  }
  body.querySelector("#zoteroagent-session-select")?.addEventListener("change", (event) => {
    const sessionId = (event.target as HTMLSelectElement).value;
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0 && sessionId) {
      chatStore.setActiveSession(itemId, sessionId);
      renderMessages(body, itemId);
      syncContextSelector(body, itemId);
      syncLayoutState(body, itemId);
    }
  });
  body.querySelector("#zoteroagent-session-new")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const session = chatStore.createSession(itemId, undefined, addon.data.chat.contextMode);
    if (!session) return;
    addon.data.chat.contextMode = session.contextMode;
    body.dataset.chatMode = "chat";
    syncSessionSelector(body, itemId);
    renderMessages(body, itemId);
    syncContextSelector(body, itemId);
    syncLayoutState(body, itemId);
    (body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null)?.focus();
  });
  body.querySelector("#zoteroagent-session-rename")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const session = chatStore.getSession(itemId);
    if (!session) return;
    const currentTitle = session.title;
    const next = body.ownerDocument.defaultView?.prompt("Session title", currentTitle);
    if (!next || !next.trim()) return;
    chatStore.renameSession(itemId, next, session.sessionId);
    syncSessionSelector(body, itemId);
  });
  body.querySelector("#zoteroagent-session-delete")?.addEventListener("click", () => {
    const itemId = Number(body.dataset.itemID);
    if (itemId <= 0) return;
    const ok = body.ownerDocument.defaultView?.confirm("Delete this session history?");
    if (!ok) return;
    const active = chatStore.getSession(itemId);
    if (!active) return;
    void chatStore.deleteSession(itemId, active.sessionId).then(() => {
      renderMessages(body, itemId);
      syncSessionSelector(body, itemId);
      syncContextSelector(body, itemId);
      syncLayoutState(body, itemId);
    });
  });
  body.querySelector("#zoteroagent-session-history")?.addEventListener("click", () => {
    const panel = body.querySelector("#zoteroagent-history-panel") as HTMLElement | null;
    if (!panel) return;
    const isOpen = panel.style.display !== "none";
    if (isOpen) {
      panel.style.display = "none";
      return;
    }
    const itemId = Number(body.dataset.itemID);
    renderHistoryPanel(body, itemId);
    panel.style.display = "block";
  });
  body.querySelector(".zoteroagent-reference-dismiss")?.addEventListener("click", () => {
    addon.data.chat.referenceText = "";
    syncReferenceCard(body);
  });
  body.querySelector(".zoteroagent-reference-body")?.addEventListener("click", () => {
    const card = body.querySelector("#zoteroagent-reference-card");
    card?.classList.toggle("is-expanded");
  });
  body.querySelector("#zoteroagent-context-mode")?.addEventListener("change", (event) => {
    const mode = (event.target as HTMLSelectElement).value as ContextMode;
    addon.data.chat.contextMode = mode;
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      chatStore.updateContextMode(itemId, mode);
    }
  });
  body.querySelector("#zoteroagent-service-select")?.addEventListener("change", (event) => {
    const id = (event.target as HTMLSelectElement).value;
    if (id) setActiveServiceId(id);
  });

  body.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;
    if (target.closest("#zoteroagent-slash-menu, #zoteroagent-chat-input")) return;
    closeSlashMenu(body);
  });
  refreshPendingImagesPreview(body);
}

function hasFileDragData(event: DragEvent): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  return types.includes("Files");
}

async function processIncomingImages(body: HTMLElement, files: File[]) {
  if (!files.length) return;
  const next = [...(addon.data.chat.pendingImages || [])];
  for (const file of files) {
    if (!isImageFile(file)) continue;
    if (file.size > MAX_IMAGE_SIZE_BYTES) continue;
    if (next.length >= MAX_PENDING_IMAGES) break;
    try {
      const raw = await readFileAsDataURL(file);
      const optimized = await optimizeImage(raw);
      if (optimized) next.push(optimized);
    } catch (_e) {
      // ignore single-file decode failures
    }
  }
  addon.data.chat.pendingImages = next.slice(0, MAX_PENDING_IMAGES);
  refreshPendingImagesPreview(body);
}

function refreshPendingImagesPreview(body: HTMLElement) {
  const wrap = body.querySelector("#zoteroagent-image-preview") as HTMLElement | null;
  if (!wrap) return;
  while (wrap.firstChild) wrap.firstChild.remove();
  const images = addon.data.chat.pendingImages || [];
  if (!images.length) {
    wrap.style.display = "none";
    return;
  }
  const doc = body.ownerDocument;
  images.forEach((dataUrl, index) => {
    const item = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    item.className = "zoteroagent-image-thumb";
    const img = doc.createElementNS("http://www.w3.org/1999/xhtml", "img") as HTMLImageElement;
    img.src = dataUrl;
    img.alt = `Image ${index + 1}`;
    const removeBtn = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    removeBtn.className = "remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove image";
    removeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const list = [...(addon.data.chat.pendingImages || [])];
      list.splice(index, 1);
      addon.data.chat.pendingImages = list;
      refreshPendingImagesPreview(body);
    });
    item.appendChild(img);
    item.appendChild(removeBtn);
    wrap.appendChild(item);
  });
  wrap.style.display = "flex";
}

function getPaneUid(body: HTMLElement): string {
  return body.dataset.paneUid || "default-pane";
}

function getSlashState(body: HTMLElement) {
  return slashStateByPane.get(getPaneUid(body)) || null;
}

function setSlashState(
  body: HTMLElement,
  next: {
    token: SlashToken;
    commands: SlashCommand[];
    activeIndex: number;
  },
) {
  slashStateByPane.set(getPaneUid(body), next);
}

function clearSlashState(body: HTMLElement) {
  slashStateByPane.delete(getPaneUid(body));
}

function getSlashCommands(body: HTMLElement): SlashCommand[] {
  return buildSlashCommands({
    init: (targetBody, itemId) => runInitCommand(targetBody, itemId),
    summary: (targetBody, itemId) => runSummaryCommand(targetBody, itemId),
    compact: (targetBody, itemId) => runCompactCommand(targetBody, itemId),
  });
}

function closeSlashMenu(body: HTMLElement) {
  const slashMenu = body.querySelector("#zoteroagent-slash-menu") as HTMLElement | null;
  if (slashMenu) {
    slashMenu.style.display = "none";
    while (slashMenu.firstChild) slashMenu.firstChild.remove();
  }
  clearSlashState(body);
}

function updateSlashMenuForInput(body: HTMLElement) {
  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  const slashMenu = body.querySelector("#zoteroagent-slash-menu") as HTMLElement | null;
  if (!input || !slashMenu) return;
  const caretEnd =
    typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const token = parseSlashToken(input.value, caretEnd);
  if (!token) {
    closeSlashMenu(body);
    return;
  }
  const commands = filterSlashCommands(getSlashCommands(body), token.query);
  if (commands.length === 0) {
    closeSlashMenu(body);
    return;
  }
  const prev = getSlashState(body);
  const activeIndex = Math.max(
    0,
    Math.min(prev?.activeIndex || 0, commands.length - 1),
  );
  setSlashState(body, { token, commands, activeIndex });
  renderSlashMenu(body);
}

function renderSlashMenu(body: HTMLElement) {
  const slashMenu = body.querySelector("#zoteroagent-slash-menu") as HTMLElement | null;
  const state = getSlashState(body);
  if (!slashMenu || !state) return;
  while (slashMenu.firstChild) slashMenu.firstChild.remove();
  const doc = body.ownerDocument;
  state.commands.forEach((command, index) => {
    const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
    btn.type = "button";
    btn.className = "zoteroagent-slash-item";
    if (index === state.activeIndex) btn.classList.add("active");
    btn.dataset.command = command.name;

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    title.className = "zoteroagent-slash-item-title";
    title.textContent = command.label;
    const desc = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    desc.className = "zoteroagent-slash-item-desc";
    desc.textContent = command.description;

    btn.appendChild(title);
    btn.appendChild(desc);
    btn.addEventListener("mouseenter", () => {
      const current = getSlashState(body);
      if (!current) return;
      setSlashState(body, { ...current, activeIndex: index });
      renderSlashMenu(body);
    });
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void executeSlashCommandByIndex(body, index);
    });
    slashMenu.appendChild(btn);
  });
  slashMenu.style.display = "grid";
}

function handleSlashMenuKeydown(body: HTMLElement, event: KeyboardEvent): boolean {
  const state = getSlashState(body);
  if (!state) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setSlashState(body, {
      ...state,
      activeIndex: (state.activeIndex + 1) % state.commands.length,
    });
    renderSlashMenu(body);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setSlashState(body, {
      ...state,
      activeIndex:
        (state.activeIndex - 1 + state.commands.length) % state.commands.length,
    });
    renderSlashMenu(body);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeSlashMenu(body);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    void executeSlashCommandByIndex(body, state.activeIndex);
    return true;
  }
  return false;
}

async function executeSlashCommandByIndex(body: HTMLElement, index: number) {
  const state = getSlashState(body);
  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  if (!state || !input) return;
  const command = state.commands[index];
  if (!command) return;
  const itemId = Number(body.dataset.itemID) || 0;
  if (itemId <= 0) return;

  const consumed = consumeSlashToken(input.value, state.token);
  input.value = consumed.value;
  closeSlashMenu(body);
  input.focus();
  try {
    input.setSelectionRange(consumed.caret, consumed.caret);
  } catch (_e) {
    // ignore
  }
  addUserCommandMessage(body, itemId, command.label);
  await command.execute(body, itemId);
}

// ===================== Generation State =====================

function setGenerating(body: HTMLElement, generating: boolean) {
  isGenerating = generating;
  const sendBtn = body.querySelector("#zoteroagent-chat-send") as HTMLElement | null;
  const statusText = body.querySelector("#zoteroagent-status-text") as HTMLElement | null;
  if (sendBtn) {
    if (generating) {
      sendBtn.classList.add("is-stop");
      sendBtn.textContent = "Stop";
      sendBtn.title = "Stop generating";
    } else {
      sendBtn.classList.remove("is-stop");
      sendBtn.textContent = "Send";
      sendBtn.title = "Send";
      activeXHR = null;
    }
  }
  if (statusText) {
    statusText.className = generating
      ? "zoteroagent-status-text sending"
      : "zoteroagent-status-text ready";
    statusText.textContent = generating ? "Generating..." : "Ready";
  }
}

function abortGeneration(body: HTMLElement) {
  if (activeXHR) {
    try { activeXHR.abort(); } catch (_e) { /* ignore */ }
    activeXHR = null;
  }
  setGenerating(body, false);
  const itemId = Number(body.dataset.itemID);
  if (itemId > 0) renderMessages(body, itemId);
}

// ===================== AI Logic =====================

function getItemKey(itemId: number): string {
  try {
    const item = Zotero.Items.get(itemId) as any;
    return String(item?.key || itemId);
  } catch (_e) {
    return String(itemId);
  }
}

function resolvePdfAttachmentItemId(
  itemId: number,
  reader?: _ZoteroTypes.ReaderInstance | null,
): number {
  const candidates = new Set<number>();
  if (reader?._item?.id) {
    candidates.add(Number(reader._item.id));
  }
  candidates.add(itemId);

  try {
    const baseItem = Zotero.Items.get(itemId) as any;
    if (baseItem && typeof baseItem.getAttachments === "function") {
      const ids: number[] = Array.isArray(baseItem.getAttachments())
        ? baseItem.getAttachments()
        : [];
      ids.forEach((id) => candidates.add(Number(id)));
    }
  } catch (_e) {
    // ignore
  }

  for (const cid of candidates) {
    try {
      const item = Zotero.Items.get(cid) as any;
      if (!item) continue;
      const isAttachment = typeof item.isAttachment === "function" && item.isAttachment();
      const isPdf =
        (typeof item.isPDFAttachment === "function" && item.isPDFAttachment()) ||
        item.attachmentContentType === "application/pdf" ||
        item.getField?.("mimeType") === "application/pdf";
      if (isAttachment && isPdf) {
        const p = typeof item.getFilePath === "function" ? String(item.getFilePath() || "") : "";
        if (p) return cid;
      }
      if (!isAttachment && typeof item.getAttachments === "function") {
        const attachmentIds: number[] = Array.isArray(item.getAttachments())
          ? item.getAttachments()
          : [];
        for (const aid of attachmentIds) {
          const child = Zotero.Items.get(aid) as any;
          if (!child) continue;
          const childIsPdf =
            (typeof child.isPDFAttachment === "function" && child.isPDFAttachment()) ||
            child.attachmentContentType === "application/pdf" ||
            child.getField?.("mimeType") === "application/pdf";
          if (!childIsPdf) continue;
          const filePath =
            typeof child.getFilePath === "function" ? String(child.getFilePath() || "") : "";
          if (filePath) return aid;
        }
      }
    } catch (_e) {
      // continue to next candidate
    }
  }
  return 0;
}

function addAssistantMessage(body: HTMLElement, itemId: number, content: string) {
  chatStore.addMessage(
    itemId,
    { role: "assistant", content, model: getModelLabel() },
    addon.data.chat.contextMode,
  );
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
}

function addUserCommandMessage(body: HTMLElement, itemId: number, commandLabel: string) {
  chatStore.addMessage(
    itemId,
    { role: "user", content: commandLabel },
    addon.data.chat.contextMode,
  );
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
}

async function openPaperOverviewFile(body: HTMLElement, itemId: number) {
  const itemKey = getItemKey(itemId);
  const path = getPaperOverviewPath(itemKey);
  const ioUtils = (globalThis as any).IOUtils;
  try {
    if (ioUtils?.exists && !(await ioUtils.exists(path))) {
      addAssistantMessage(body, itemId, "No AGENTS.md found for this paper. Please run /init first.");
      return;
    }
    const zoteroAny = Zotero as any;
    if (typeof zoteroAny.launchFile === "function") {
      zoteroAny.launchFile(path);
      return;
    }
    const fileObj = zoteroAny.File?.pathToFile?.(path);
    if (fileObj?.launch) {
      fileObj.launch();
      return;
    }
    body.ownerDocument.defaultView?.open?.(`file://${path}`);
  } catch (e) {
    ztoolkit.log("[Agent] openPaperOverviewFile error:", e);
    addAssistantMessage(body, itemId, "Failed to open AGENTS.md. Please try again later.");
  }
}

function bindAgentsMdLink(container: HTMLElement, body: HTMLElement, itemId: number) {
  if (container.dataset.agentsMdBound === "1") return;
  container.dataset.agentsMdBound = "1";
  container.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;
    const anchor = target.closest("a") as HTMLAnchorElement | null;
    const label = (
      anchor?.textContent ||
      target.textContent ||
      ""
    ).toLowerCase();
    const href = (anchor?.getAttribute("href") || "").toLowerCase();
    const shouldOpen =
      label.includes("agents.md") ||
      href.includes("agents.md") ||
      href.startsWith("zoteroagent://agents-md");
    if (!shouldOpen) return;
    event.preventDefault();
    event.stopPropagation();
    void openPaperOverviewFile(body, itemId);
  });
}

async function runInitCommand(body: HTMLElement, itemId: number) {
  addAssistantMessage(
    body,
    itemId,
    "Generating [AGENTS.md](zoteroagent://agents-md) overview for this paper...",
  );
  const reader = getActiveReader();
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  if (pdfItemId <= 0) {
    addAssistantMessage(
      body,
      itemId,
      "No valid PDF attachment found. Please confirm the item has an accessible PDF attachment in Zotero.",
    );
    return;
  }
  const fullText = await getFullText(pdfItemId);
  if (!fullText.trim()) {
    addAssistantMessage(
      body,
      itemId,
      "PDF attachment found, but full text could not be extracted. Please verify the PDF has a text layer or has been indexed.",
    );
    return;
  }
  const maxCtx = getActiveMaxContextTokens();
  const clipped = truncateDocContext(fullText, Math.floor(maxCtx * 0.8));
  try {
    const prompts = initPaperPrompt(clipped);
    const result = await AIService.chat(prompts as any, {
      stream: false,
      disableThinking: true,
      timeoutMs: 300000,
    });
    const overview = (result.content || "").trim();
    if (!overview) {
      addAssistantMessage(body, itemId, "/init failed: the model did not return valid content.");
      return;
    }
    await savePaperOverview(getItemKey(itemId), overview);
    addAssistantMessage(
      body,
      itemId,
      "Paper overview generated. I now have context about this paper. Open [AGENTS.md](zoteroagent://agents-md).",
    );
  } catch (e: any) {
    addAssistantMessage(body, itemId, `[Error] /init failed: ${e?.message || String(e)}`);
  }
}

async function runSummaryCommand(body: HTMLElement, itemId: number) {
  if (isGenerating) return;
  const reader = getActiveReader();
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  const fullText = await getFullText(pdfItemId);
  if (!fullText.trim()) {
    addAssistantMessage(body, itemId, "Could not extract full text from the PDF. Unable to run /summary.");
    return;
  }
  const itemKey = getItemKey(itemId);
  const paperOverview = await loadPaperOverview(itemKey);
  const maxCtx = getActiveMaxContextTokens();
  const clipped = truncateDocContext(fullText, Math.floor(maxCtx * 0.8));

  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant, addon.data.chat.contextMode);
  renderMessages(body, itemId);
  setGenerating(body, true);
  try {
    const prompts = paperSummaryPrompt(clipped, paperOverview || "");
    let lastRefresh = 0;
    await AIService.chat(prompts as any, {
      stream: true,
      onRequest: (xhr) => {
        activeXHR = xhr;
      },
      onChunk: (state) => {
        assistant.content = state.content;
        assistant.reasoning = state.reasoning;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, state);
        }
      },
    });
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, addon.data.chat.contextMode);
  setGenerating(body, false);
  renderMessages(body, itemId);
}

async function runCompactCommand(body: HTMLElement, itemId: number) {
  const session = chatStore.getSession(itemId);
  const history = session?.messages || [];
  if (history.length < 4) {
    addAssistantMessage(body, itemId, "Nothing to compact.");
    return;
  }
  try {
    const prompts = summarizeHistoryPrompt("", history as any);
    const result = await AIService.chat(prompts as any, {
      stream: false,
      disableThinking: true,
      model: getMiniModel(),
    });
    const summaryText = (result.content || "").trim();
    if (!summaryText) {
      addAssistantMessage(body, itemId, "/compact failed: no summary was generated.");
      return;
    }
    const active = chatStore.getSession(itemId);
    if (active) {
      const summarizedUpTo = active.messages.length;
      const keepTail = 12;
      const tail = active.messages.slice(-keepTail);
      const summaryMsg: ChatMessage = {
        role: "assistant",
        content: `[Session Summary]\n${summaryText}`,
        timestamp: Date.now(),
      };
      active.messages = [summaryMsg, ...tail];
      chatStore.updateSessionSummary(itemId, summaryText, summarizedUpTo);
      chatStore.touchSession(itemId, addon.data.chat.contextMode);
    }
    addAssistantMessage(body, itemId, "Context compacted. Earlier conversation summarized.");
  } catch (e: any) {
    addAssistantMessage(body, itemId, `[Error] /compact failed: ${e?.message || String(e)}`);
  }
}

function getActiveReader(): _ZoteroTypes.ReaderInstance | null {
  const tabId =
    (typeof Zotero_Tabs !== "undefined"
      ? (Zotero_Tabs as any).selectedID
      : "") ||
    (Zotero as any).getActiveZoteroPane?.()?.getSelectedTabID?.() ||
    "";
  if (tabId) {
    const r = Zotero.Reader?.getByTabID?.(tabId);
    if (r) return r;
  }
  if (addon.data.popup.currentReader) {
    return addon.data.popup.currentReader;
  }
  const readers = (Zotero.Reader as any)?._readers;
  if (Array.isArray(readers) && readers.length > 0) {
    return readers[readers.length - 1];
  }
  return null;
}

async function submitQuestion(body: HTMLElement) {
  if (isGenerating) {
    abortGeneration(body);
    return;
  }

  const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
  if (!input) return;
  closeSlashMenu(body);
  const question = input.value.trim();
  if (!question) return;

  const itemId = Number(body.dataset.itemID);
  if (!itemId || itemId < 0) return;

  const refText = addon.data.chat.referenceText;
  const pendingImages = (addon.data.chat.pendingImages || []).slice(0, MAX_PENDING_IMAGES);
  const displayContent = refText
    ? `Selected Text: ${refText}\n\n${question}`
    : question;

  chatStore.addMessage(
    itemId,
    { role: "user", content: displayContent, images: pendingImages },
    addon.data.chat.contextMode,
  );
  input.value = "";
  addon.data.chat.referenceText = "";
  addon.data.chat.pendingImages = [];
  syncReferenceCard(body);
  refreshPendingImagesPreview(body);
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const assistant: ChatMessage = { role: "assistant", content: "", reasoning: "", model: getModelLabel() };
  chatStore.addMessage(itemId, assistant, addon.data.chat.contextMode);
  const sessions = chatStore.getMessages(itemId);
  renderMessages(body, itemId);
  setGenerating(body, true);

  const reader = addon.data.popup.currentReader;
  const mode = addon.data.chat.contextMode;
  const maxCtx = getActiveMaxContextTokens();
  ztoolkit.log(`[Agent] submitQuestion: mode=${mode}`);
  const ctxResult = await getContextByMode({ mode, reader, itemId });
  ztoolkit.log(`[Agent] ctxResult: source=${ctxResult.source}, text.len=${ctxResult.text?.length}, page=${ctxResult.pageNumber}`);
  const safeCtxText =
    ctxResult.source === "none"
      ? ""
      : truncateDocContext(ctxResult.text, Math.floor(maxCtx * 0.5));

  const ctxInfo: ContextInfo = {
    text: safeCtxText,
    source: ctxResult.source,
    pageNumber: ctxResult.pageNumber,
  };
  const paperOverview = await loadPaperOverview(getItemKey(itemId));

  const aiQuestion = refText
    ? `> ${refText.replace(/\n/g, "\n> ")}\n\n${question}`
    : question;
  const promptMsgs = askPrompt(aiQuestion, ctxInfo, paperOverview || "");
  if (pendingImages.length > 0) {
    promptMsgs[0].content +=
      "\nThe user has attached images. Analyze image content together with the paper context and the user question.";
  }
  const fullHistory = sessions.slice(0, -2);
  await ensureAiSessionSummary(itemId, fullHistory);
  const session = chatStore.getSession(itemId);
  const history = buildHistoryForRequest(fullHistory, session)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content }));
  const messages = buildContextMessages({
    systemMessage: promptMsgs[0] as any,
    currentMessage: promptMsgs[1] as any,
    history: history as any,
    maxContextTokens: maxCtx,
  }) as any;
  if (pendingImages.length > 0 && messages.length > 0) {
    const lastIndex = messages.length - 1;
    messages[lastIndex] = {
      ...messages[lastIndex],
      content: AIService.buildMultimodalUserContent(
        String(messages[lastIndex]?.content || ""),
        pendingImages,
      ),
    };
  }
  ztoolkit.log(`[Agent] final messages count=${messages.length}, system=${promptMsgs[0].content.substring(0, 80)}...`);

  try {
    let lastRefresh = 0;
    await AIService.chat(messages, {
      stream: true,
      onRequest: (xhr) => { activeXHR = xhr; },
      onChunk: (state) => {
        assistant.content = state.content;
        assistant.reasoning = state.reasoning;
        const now = Date.now();
        if (now - lastRefresh > 150) {
          lastRefresh = now;
          updateStreamingMessage(body, state);
        }
      },
    });
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, mode);
  setGenerating(body, false);
  renderMessages(body, itemId);
  void maybeGenerateSessionTitle(body, itemId);
}

function getMiniModel(): string | undefined {
  const svc = getActiveService();
  if (svc?.miniModel) return svc.miniModel;
  const preset = getPreset(svc?.provider || "custom");
  return preset?.miniModel;
}

async function maybeGenerateSessionTitle(body: HTMLElement, itemId: number) {
  if (!chatStore.needsAutoTitle(itemId)) return;
  const exchange = chatStore.getFirstExchange(itemId);
  if (!exchange) return;
  try {
    const msgs = sessionTitlePrompt(exchange.userMsg, exchange.assistantMsg);
    const result = await AIService.chat(msgs as any, {
      stream: false,
      disableThinking: true,
      model: getMiniModel(),
      maxTokens: 64,
      timeoutMs: 15000,
    });
    const title = (result.content || "").trim().replace(/^["']|["']$/g, "");
    if (title && title.length > 0) {
      chatStore.renameSession(itemId, title);
      syncSessionSelector(body, itemId);
    }
  } catch (_e) {
    // Silently ignore title generation failures
  }
}

// ===================== Rendering =====================

function getModelLabel(): string {
  const svc = getActiveService();
  return svc ? svc.model : "AI";
}

function getActiveMaxContextTokens(): number {
  const cfg = AIService.getConfig();
  const preset = getPreset(cfg.provider);
  return preset?.maxContextTokens || 32000;
}

function buildHistoryForRequest(history: ChatMessage[], session: ChatSession | null): ChatMessage[] {
  if (!session) return history;
  const recentWindow = 8;
  const recentStart = Math.max(0, history.length - recentWindow);
  const recentTurns = history.slice(recentStart);
  const summaryText = (session.summaryText || "").trim();
  const summaryUpToIndex = Math.max(0, session.summaryUpToIndex || 0);
  if (summaryText && summaryUpToIndex > 0 && recentStart > 0) {
    return [
      {
        role: "assistant",
        content: `[Session Summary]\n${summaryText}`,
      },
      ...recentTurns,
    ];
  }
  return history;
}

async function ensureAiSessionSummary(itemId: number, history: ChatMessage[]) {
  const session = chatStore.getSession(itemId);
  if (!session) return;
  const recentWindow = 8;
  const minDeltaMessages = 6;
  const minIntervalMs = 30_000;

  const summarizeUpToIndex = Math.max(0, history.length - recentWindow);
  if (summarizeUpToIndex <= 0) return;

  const prevUpToIndex = Math.max(0, session.summaryUpToIndex || 0);
  if (summarizeUpToIndex <= prevUpToIndex) return;
  if (summarizeUpToIndex - prevUpToIndex < minDeltaMessages) return;
  if (Date.now() - (session.summaryUpdatedAt || 0) < minIntervalMs) return;

  const deltaMessages = history.slice(prevUpToIndex, summarizeUpToIndex);
  if (deltaMessages.length === 0) return;

  try {
    const prompts = summarizeHistoryPrompt(session.summaryText || "", deltaMessages as any);
    const result = await AIService.chat(prompts as any, {
      stream: false,
      disableThinking: true,
      model: getMiniModel(),
    });
    const nextSummary = (result.content || "").trim();
    if (nextSummary) {
      chatStore.updateSessionSummary(itemId, nextSummary, summarizeUpToIndex);
      return;
    }
  } catch (_e) {
    // fall through to deterministic fallback
  }

  const fallback = buildFallbackSummary(session.summaryText || "", deltaMessages);
  if (fallback) {
    chatStore.updateSessionSummary(itemId, fallback, summarizeUpToIndex);
  }
}

function buildFallbackSummary(previousSummary: string, deltaMessages: ChatMessage[]): string {
  const lines: string[] = [];
  if (previousSummary.trim()) {
    lines.push(previousSummary.trim());
    lines.push("");
    lines.push("Latest updates:");
  } else {
    lines.push("Session summary:");
  }

  const tail = deltaMessages.slice(-10);
  for (const m of tail) {
    const role = m.role === "user" ? "User" : "Assistant";
    const text = (m.content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`- ${role}: ${text.length > 180 ? `${text.slice(0, 180)}...` : text}`);
  }

  const merged = lines.join("\n").trim();
  return merged.length > 3000 ? `${merged.slice(0, 3000)}...` : merged;
}

async function copyTextToClipboard(doc: Document, text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const navClipboard = (doc.defaultView as any)?.navigator?.clipboard;
    if (navClipboard?.writeText) {
      await navClipboard.writeText(text);
      return true;
    }
  } catch (_e) {
    // fallback below
  }
  try {
    const ta = doc.createElementNS("http://www.w3.org/1999/xhtml", "textarea") as HTMLTextAreaElement;
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    doc.documentElement.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = (doc as any).execCommand?.("copy");
    ta.remove();
    return Boolean(ok);
  } catch (_e) {
    return false;
  }
}

function getIconSvg(
  icon: "copy" | "delete" | "new" | "rename" | "clear" | "check" | "error" | "history" | "attach",
): string {
  switch (icon) {
    case "attach":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.2 10.9l4.7-4.7a2.5 2.5 0 113.5 3.5l-5.8 5.8a4 4 0 11-5.7-5.7l5.8-5.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "history":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "copy":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="4" width="9" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="7" width="9" height="11" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "delete":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 6v-1.1c0-.9.7-1.6 1.6-1.6h1.8c.9 0 1.6.7 1.6 1.6V6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 6l.7 9.2c.1.8.7 1.5 1.5 1.5h2.6c.8 0 1.5-.7 1.5-1.5l.7-9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8.4v5.8M11 8.4v5.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "new":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "rename":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 13.6l-.4 2.8 2.8-.4 7.8-7.8-2.4-2.4-7.8 7.8z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.9 5.5l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.8 16.4h12.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    case "clear":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.2 5.2l9.6 9.6M14.8 5.2l-9.6 9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "check":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.4 3.4 7.6-7.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "error":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
    default:
      return "";
  }
}

function setIconButton(
  btn: HTMLButtonElement,
  icon: "copy" | "delete" | "new" | "rename" | "clear" | "check" | "error" | "history" | "attach",
  label: string,
) {
  btn.classList.add("zoteroagent-icon-button");
  btn.setAttribute("aria-label", label);
  btn.title = label;
  insertSvgMarkup(btn, getIconSvg(icon));
}

function insertSvgMarkup(el: HTMLElement, svgMarkup: string) {
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!svgMarkup) return;
  try {
    const win = el.ownerDocument.defaultView;
    if (!win) throw new Error("no window");
    const svgDoc = new win.DOMParser().parseFromString(svgMarkup, "image/svg+xml");
    if (!svgDoc.querySelector("parsererror")) {
      el.appendChild(el.ownerDocument.adoptNode(svgDoc.documentElement));
      return;
    }
  } catch (_e) { /* fallback */ }
  el.textContent = el.getAttribute("aria-label")?.charAt(0) || "?";
}

function createAssistantCopyButton(doc: Document): HTMLButtonElement {
  const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  btn.className = "zoteroagent-copy-button";
  setIconButton(btn, "copy", "Copy response");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = (btn.closest(".zoteroagent-message.assistant") || null) as HTMLElement | null;
    const raw = wrapper?.dataset.rawContent || "";
    void copyTextToClipboard(doc, raw).then((ok) => {
      insertSvgMarkup(btn, getIconSvg(ok ? "check" : "error"));
      btn.title = ok ? "Copied" : "Copy failed";
      btn.classList.toggle("is-success", ok);
      btn.classList.toggle("is-error", !ok);
      setTimeout(() => {
        insertSvgMarkup(btn, getIconSvg("copy"));
        btn.title = "Copy response";
        btn.classList.remove("is-success", "is-error");
      }, 1200);
    });
  });
  return btn;
}

function createMessageDeleteButton(doc: Document, body: HTMLElement, itemId: number): HTMLButtonElement {
  const btn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button") as HTMLButtonElement;
  btn.className = "zoteroagent-delete-button";
  setIconButton(btn, "delete", "Delete message");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = btn.closest(".zoteroagent-message") as HTMLElement | null;
    if (!wrapper) return;
    const idx = Number(wrapper.dataset.msgIndex);
    if (Number.isNaN(idx) || idx < 0) return;
    chatStore.deleteMessage(itemId, idx);
    renderMessages(body, itemId);
    syncLayoutState(body, itemId);
  });
  return btn;
}

function updateStreamingMessage(
  body: HTMLElement,
  state: { content: string; reasoning: string },
) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;

    let msgWrapper = container.querySelector(
      ".zoteroagent-message.assistant:last-child",
    ) as HTMLElement | null;

    if (!msgWrapper) {
      const doc = body.ownerDocument;
      msgWrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      msgWrapper.className = "zoteroagent-message assistant";

      const roleRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      roleRow.className = "zoteroagent-role-row";
      const dot = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      dot.className = "zoteroagent-role-dot assistant";
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      label.className = "zoteroagent-role-label";
      label.textContent = getModelLabel();
      roleRow.appendChild(dot);
      roleRow.appendChild(label);
      msgWrapper.appendChild(roleRow);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";
      msgWrapper.appendChild(inner);
      const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      actions.className = "zoteroagent-message-actions";
      actions.appendChild(createAssistantCopyButton(doc));
      msgWrapper.appendChild(actions);
      container.appendChild(msgWrapper);
    }

    if (state.reasoning) {
      let thinkBlock = msgWrapper.querySelector(".zoteroagent-thinking") as HTMLElement | null;
      if (!thinkBlock) {
        const doc = body.ownerDocument;
        thinkBlock = doc.createElementNS("http://www.w3.org/1999/xhtml", "details") as HTMLElement;
        thinkBlock.className = "zoteroagent-thinking";
        const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", "summary");
        summary.className = "zoteroagent-thinking-summary";
        thinkBlock.appendChild(summary);
        const thinkContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        thinkContent.className = "zoteroagent-thinking-content";
        thinkBlock.appendChild(thinkContent);
        const contentEl = msgWrapper.querySelector(".zoteroagent-message-content");
        if (contentEl) {
          msgWrapper.insertBefore(thinkBlock, contentEl);
        } else {
          msgWrapper.appendChild(thinkBlock);
        }
      }
      const summaryEl = thinkBlock.querySelector(".zoteroagent-thinking-summary");
      if (summaryEl) {
        const isThinking = !state.content;
        summaryEl.textContent = isThinking
          ? "Thinking..."
          : `Deeply thought`;
      }
      const thinkContentEl = thinkBlock.querySelector(".zoteroagent-thinking-content");
      if (thinkContentEl) thinkContentEl.textContent = state.reasoning;
    }

    const contentEl = msgWrapper.querySelector(".zoteroagent-message-content") as HTMLElement;
    if (contentEl) {
      try {
        contentEl.innerHTML = renderMarkdown(state.content);
      } catch (_e) {
        contentEl.textContent = state.content;
      }
      const itemId = Number(body.dataset.itemID) || 0;
      if (itemId > 0) {
        bindAgentsMdLink(contentEl, body, itemId);
      }
    }
    msgWrapper.dataset.rawContent = state.content || "";

    if (isNearBottom(container)) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (e) {
    ztoolkit.log("[Agent] updateStreamingMessage error:", e);
  }
}

function isNearBottom(el: HTMLElement, threshold = 60): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function renderMessages(body: HTMLElement, itemId: number) {
  try {
    const container = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
    if (!container) return;
    const sessions = chatStore.getMessages(itemId);

    while (container.firstChild) {
      (container.firstChild as Element).remove();
    }

    const doc = body.ownerDocument;
    for (let i = 0; i < sessions.length; i++) {
      const msg = sessions[i];
      const wrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      wrapper.className = `zoteroagent-message ${msg.role === "user" ? "user" : "assistant"}`;
      wrapper.dataset.msgIndex = String(i);

      const roleRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      roleRow.className = "zoteroagent-role-row";
      const dot = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      dot.className = `zoteroagent-role-dot ${msg.role === "user" ? "user" : "assistant"}`;
      const roleLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      roleLabel.className = "zoteroagent-role-label";
      roleLabel.textContent = msg.role === "user" ? "You" : (msg.model || getModelLabel());
      roleRow.appendChild(dot);
      roleRow.appendChild(roleLabel);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";

      wrapper.appendChild(roleRow);

      if (msg.role === "assistant") {
        if (msg.reasoning) {
          const thinkBlock = doc.createElementNS("http://www.w3.org/1999/xhtml", "details") as HTMLElement;
          thinkBlock.className = "zoteroagent-thinking";
          const summary = doc.createElementNS("http://www.w3.org/1999/xhtml", "summary");
          summary.className = "zoteroagent-thinking-summary";
          summary.textContent = "Deeply thought";
          thinkBlock.appendChild(summary);
          const thinkContent = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          thinkContent.className = "zoteroagent-thinking-content";
          thinkContent.textContent = msg.reasoning;
          thinkBlock.appendChild(thinkContent);
          wrapper.appendChild(thinkBlock);
        }
        try {
          inner.innerHTML = renderMarkdown(msg.content);
        } catch (_e) {
          inner.textContent = msg.content;
        }
        bindAgentsMdLink(inner, body, itemId);
      } else {
        renderUserMessage(inner, msg.content, msg.images || []);
      }

      wrapper.appendChild(inner);
      const actions = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      actions.className = "zoteroagent-message-actions";
      if (msg.role === "assistant") {
        (wrapper as HTMLElement).dataset.rawContent = msg.content || "";
        actions.appendChild(createAssistantCopyButton(doc));
      }
      actions.appendChild(createMessageDeleteButton(doc, body, itemId));
      wrapper.appendChild(actions);
      container.appendChild(wrapper);
    }

    syncSessionSelector(body, itemId);
    if (isNearBottom(container)) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (e) {
    ztoolkit.log("[Agent] renderMessages error:", e);
  }
}

// ===================== Helpers =====================

function syncPrefill(body: HTMLElement) {
  if (addon.data.chat.prefillInput) {
    const input = body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null;
    if (input) {
      input.value = addon.data.chat.prefillInput;
      addon.data.chat.prefillInput = "";
    }
  }

  syncReferenceCard(body);

  if (addon.data.chat.referenceText || addon.data.chat.prefillInput) {
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
    }
    (body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null)?.focus();
  }
}

function syncReferenceCard(body: HTMLElement) {
  const card = body.querySelector("#zoteroagent-reference-card") as HTMLElement | null;
  if (!card) return;
  const text = addon.data.chat.referenceText;
  const content = card.querySelector(".zoteroagent-reference-content") as HTMLElement | null;
  if (text) {
    if (content) content.textContent = text;
    card.classList.remove("is-expanded");
    card.style.display = "flex";
  } else {
    if (content) content.textContent = "";
    card.style.display = "none";
  }
}

function syncContextSelector(body: HTMLElement, itemId?: number) {
  if (itemId && itemId > 0) {
    const session = chatStore.getSession(itemId);
    if (session) {
      addon.data.chat.contextMode = session.contextMode;
    }
  }
  const sel = body.querySelector("#zoteroagent-context-mode") as HTMLSelectElement | null;
  if (sel) sel.value = addon.data.chat.contextMode;
  const svcSel = body.querySelector("#zoteroagent-service-select") as HTMLSelectElement | null;
  if (svcSel) {
    populateServiceOptions(svcSel);
  }
}

function getItemTitle(itemId: number): string {
  try {
    const item = Zotero.Items.get(itemId) as any;
    return String(item?.getField?.("title") || item?.getDisplayTitle?.() || `Item ${itemId}`);
  } catch (_e) {
    return `Item ${itemId}`;
  }
}

function syncSessionSelector(body: HTMLElement, itemId: number) {
  const select = body.querySelector("#zoteroagent-session-select") as HTMLSelectElement | null;
  if (!select) return;
  while (select.firstChild) {
    select.firstChild.remove();
  }

  const sessionList = chatStore.listSessions(itemId);
  for (const s of sessionList) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = s.sessionId;
    opt.textContent = s.title;
    select.appendChild(opt);
  }
  if (sessionList.length === 0) {
    const fallback = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    fallback.value = "";
    fallback.textContent = `No chats for ${getItemTitle(itemId)}`;
    select.appendChild(fallback);
  }
  select.value = chatStore.getActiveSessionId(itemId);

  const titleEl = body.querySelector("#zoteroagent-session-title") as HTMLElement | null;
  if (titleEl) {
    const activeSession = chatStore.getSession(itemId);
    titleEl.textContent = activeSession?.title || "New chat";
  }
}

function renderHistoryPanel(body: HTMLElement, itemId: number) {
  const panel = body.querySelector("#zoteroagent-history-panel") as HTMLElement | null;
  if (!panel) return;
  const doc = body.ownerDocument;
  while (panel.firstChild) panel.firstChild.remove();

  const sessionList = chatStore.listSessions(itemId);
  if (sessionList.length === 0) {
    const empty = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    empty.className = "zoteroagent-history-empty";
    empty.textContent = "No chat history";
    panel.appendChild(empty);
    return;
  }

  for (const s of sessionList) {
    const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    row.className = "zoteroagent-history-item";
    if (chatStore.getActiveSessionId(itemId) === s.sessionId) {
      row.classList.add("active");
    }
    row.dataset.sessionId = s.sessionId;

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    title.className = "zoteroagent-history-item-title";
    title.textContent = s.title;

    const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    meta.className = "zoteroagent-history-item-meta";
    const msgCount = s.messageCount;
    const dateStr = new Date(s.updatedAt).toLocaleDateString();
    meta.textContent = `${msgCount} messages · ${dateStr}`;

    row.appendChild(title);
    row.appendChild(meta);

    row.addEventListener("click", () => {
      chatStore.setActiveSession(itemId, s.sessionId);
      panel.style.display = "none";
      renderMessages(body, itemId);
      syncSessionSelector(body, itemId);
      syncContextSelector(body, itemId);
      syncLayoutState(body, itemId);
    });

    panel.appendChild(row);
  }
}

function populateServiceOptions(select: HTMLSelectElement) {
  const services = loadServices();
  const activeId = getActiveServiceId();
  while (select.firstChild) select.firstChild.remove();
  if (services.length === 0) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = "";
    opt.textContent = "No service configured";
    select.appendChild(opt);
    return;
  }
  for (const svc of services) {
    const opt = select.ownerDocument.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "option",
    ) as HTMLOptionElement;
    opt.value = svc.id;
    opt.textContent = `${svc.name} / ${svc.model}`;
    select.appendChild(opt);
  }
  select.value = activeId || services[0]?.id || "";
}

function syncLayoutState(body: HTMLElement, _itemId: number) {
  const sessionRow = body.querySelector("#zoteroagent-session-row") as HTMLElement | null;
  const messages = body.querySelector("#zoteroagent-chat-messages") as HTMLElement | null;
  const inputArea = body.querySelector("#zoteroagent-input-area") as HTMLElement | null;
  if (!messages || !inputArea || !sessionRow) return;
  sessionRow.style.display = "flex";
  messages.style.display = "flex";
  messages.style.flexDirection = "column";
  inputArea.style.display = "flex";
}

function renderUserMessage(container: HTMLElement, content: string, images: string[]) {
  const doc = container.ownerDocument;
  renderUserImages(container, images || []);

  const selectedPrefix = "Selected Text: ";
  if (content.startsWith(selectedPrefix)) {
    const rest = content.slice(selectedPrefix.length);
    const doubleNewline = rest.indexOf("\n\n");
    const refText = doubleNewline >= 0 ? rest.slice(0, doubleNewline) : rest;
    const bodyText = doubleNewline >= 0 ? rest.slice(doubleNewline + 2).trim() : "";

    if (refText) {
      const refCard = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      refCard.className = "zoteroagent-msg-reference";

      const refLabel = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      refLabel.className = "zoteroagent-msg-ref-label";
      refLabel.textContent = "Reference text";

      const refTextEl = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      refTextEl.className = "zoteroagent-msg-ref-text";
      refTextEl.textContent = refText;

      const fade = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      fade.className = "zoteroagent-msg-ref-fade";

      refCard.appendChild(refLabel);
      refCard.appendChild(refTextEl);
      refCard.appendChild(fade);
      refCard.addEventListener("click", () => {
        refCard.classList.toggle("is-expanded");
      });
      container.appendChild(refCard);
    }
    if (bodyText) {
      const question = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      question.className = "zoteroagent-msg-question";
      question.textContent = bodyText;
      container.appendChild(question);
    }
    return;
  }

  const quoteLines: string[] = [];
  const bodyLines: string[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.trimStart().startsWith(">")) {
      quoteLines.push(line.replace(/^\s*>\s?/, ""));
    } else {
      bodyLines.push(line);
    }
  }
  if (quoteLines.length > 0) {
    const quote = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "blockquote",
    ) as HTMLQuoteElement;
    quote.className = "zoteroagent-user-quote";
    quote.textContent = quoteLines.join("\n");
    container.appendChild(quote);
  }
  const bodyText = bodyLines.join("\n").trim();
  if (bodyText) {
    const text = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    text.textContent = bodyText;
    container.appendChild(text);
  }
}

function renderUserImages(container: HTMLElement, images: string[]) {
  if (!images || images.length === 0) return;
  const doc = container.ownerDocument;
  const wrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  wrap.className = "zoteroagent-msg-images";
  images.forEach((dataUrl, index) => {
    const thumb = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
    thumb.className = "zoteroagent-msg-image-thumb";
    thumb.type = "button";
    thumb.title = `Attached image ${index + 1}`;
    const img = doc.createElementNS("http://www.w3.org/1999/xhtml", "img") as HTMLImageElement;
    img.src = dataUrl;
    img.alt = `Attached image ${index + 1}`;
    thumb.appendChild(img);
    thumb.addEventListener("click", () => {
      wrap.classList.toggle("is-expanded");
      thumb.classList.add("active");
      for (const el of Array.from(wrap.querySelectorAll(".zoteroagent-msg-image-thumb"))) {
        const btn = el as HTMLElement;
        if (btn !== thumb) btn.classList.remove("active");
      }
    });
    wrap.appendChild(thumb);
  });
  container.appendChild(wrap);
}
