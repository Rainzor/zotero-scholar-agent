import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { AIService } from "../services/ai-service";
import {
  initPaperPrompt,
  paperSummaryPrompt,
  sessionTitlePrompt,
  summarizeHistoryPrompt,
} from "../services/prompts";
import { getFullText } from "./pdf-context";
import {
  loadServices,
  getActiveServiceId,
  setActiveServiceId,
  getActiveService,
} from "../utils/services";
import { getPreset } from "../utils/provider-presets";
import { truncateDocContext } from "../services/context-builder";
import { estimateTokens } from "../utils/token-estimate";
import type {
  ChatMessage,
  ChatSession,
  ContextMode,
  SessionContextPdfRef,
  TokenUsage,
} from "../addon";
import { chatStore } from "../services/chat-store";
import { ensureAgentsMd, executeAgent } from "../services/agent-executor";
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
import {
  addLibraryContextPdf,
  addLocalPathContextPdf,
  addUploadContextPdf,
  loadContextPdfByRef,
  type ContextPdfData,
  type ContextPdfStatus,
} from "../services/context-pdf";
import {
  MAX_CONTEXT_PDF_SIZE_BYTES,
  formatFileSize,
  isPdfFile,
} from "../utils/pdf-upload-utils";
import { extractLocalPathCandidates } from "../utils/local-pdf-path";
import {
  consumeMentionToken,
  parseMentionToken,
  searchLibraryItemsForMention,
  type MentionCandidate,
  type MentionToken,
} from "./mention-commands";

let sectionPaneID: string | null = null;
let activeBody: HTMLElement | null = null;
let activeXHR: XMLHttpRequest | null = null;
let isGenerating = false;
const resizeObserverMap = new WeakMap<HTMLElement, ResizeObserver>();
const pollTimerMap = new WeakMap<HTMLElement, number>();
const lastWidthMap = new WeakMap<HTMLElement, number>();
let referenceSyncRetryTimer: number | null = null;
const slashStateByPane = new Map<
  string,
  {
    token: SlashToken;
    commands: SlashCommand[];
    activeIndex: number;
  }
>();
const mentionStateByPane = new Map<
  string,
  {
    token: MentionToken;
    candidates: MentionCandidate[];
    activeIndex: number;
    loading: boolean;
    pendingQuery: string;
    requestSeq: number;
  }
>();
let mentionRequestCounter = 0;
const AGENT_CONTEXT_MODE: ContextMode = "agent";
const SELECTED_TEXT_PREFIX = "Selected Text: ";
const RESPONSE_QUOTE_PREFIX = "Response Quote: ";
let contextPdfTaskId = 0;

function isSafeBody(body: HTMLElement | null): body is HTMLElement {
  if (!body) return false;
  try {
    if (typeof addon !== "undefined" && !addon.data.alive) return false;
    if (
      typeof Components !== "undefined" &&
      Components.utils?.isDeadWrapper?.(body)
    )
      return false;
    if (!body.isConnected) return false;
    if (!body.ownerDocument?.defaultView) return false;
    return true;
  } catch {
    return false;
  }
}

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
  if (!isSafeBody(body)) return;
  addon.data.chat.pendingImages = [];
  addon.data.chat.pendingContextPdf = null;
  body.dataset.itemID = String(itemId);
  addon.data.popup.currentReader = reader;
  chatStore.getSession(itemId);
  const steps: Array<() => void> = [
    () => renderMessages(body, itemId),
    () => syncServiceSelector(body),
    () => syncLayoutState(body, itemId),
    () => syncPrefill(body),
    () => refreshPendingImagesPreview(body),
    () => refreshContextPdfChip(body),
  ];
  for (const step of steps) {
    try {
      step();
    } catch (e) {
      ztoolkit.log("[Agent] applySectionData step error:", e);
    }
  }
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
  } catch (_e) {
    /* ignore */
  }

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
      onInit: ({
        body,
        setEnabled,
      }: {
        body: HTMLElement;
        setEnabled: (v: boolean) => void;
      }) => {
        setEnabled(true);
        const paneUID = Zotero.Utilities.randomString(8);
        body.dataset.paneUid = paneUID;
      },
      onDestroy: ({ body }: { body: HTMLElement }) => {
        teardownResizeObserver(body);
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
        setupResizeObserver(body);
      },
      sectionButtons: [
        {
          type: "fullHeight",
          icon: `chrome://${config.addonRef}/content/icons/full-16.svg`,
          l10nID: getLocaleID("itemPaneSection-fullHeight"),
          onClick: ({ body }: { body: HTMLElement }) => {
            const details = findAncestor(body, "item-details");
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

/**
 * Walk up the DOM tree crossing shadow DOM boundaries to find an ancestor
 * matching the given selector.
 */
function findAncestor(
  start: HTMLElement,
  selector: string,
): HTMLElement | null {
  const direct = start.closest(selector) as HTMLElement | null;
  if (direct) return direct;
  let current: HTMLElement | null = start;
  while (current) {
    try {
      const root = current.getRootNode();
      if (root === current.ownerDocument || !(root as ShadowRoot).host) break;
      const host = (root as ShadowRoot).host as HTMLElement;
      if (host.matches?.(selector)) return host;
      const viaHost = host.closest(selector) as HTMLElement | null;
      if (viaHost) return viaHost;
      current = host;
    } catch (_e) {
      break;
    }
  }
  return null;
}

/**
 * Resolve the reference elements for layout calculations, crossing shadow DOM
 * boundaries when necessary.
 */
function resolveLayoutRefs(body: HTMLElement): {
  details: HTMLElement | null;
  section: HTMLElement | null;
  head: HTMLElement | null;
  viewItem: HTMLElement | null;
} {
  const section = findAncestor(body, "item-pane-custom-section");
  const head = section?.querySelector(".head") as HTMLElement | null;
  const details = findAncestor(body, "item-details");
  const viewItem =
    (details?.querySelector(".zotero-view-item") as HTMLElement | null) || null;
  return { details, section, head, viewItem };
}

function onUpdateHeight({ body }: { body: HTMLElement }) {
  try {
    const { details, head, viewItem } = resolveLayoutRefs(body);
    if (details && head && viewItem) {
      const height = viewItem.clientHeight - head.clientHeight - 8;
      if (height > 0) {
        body.style.height = `${height}px`;
        body.style.setProperty("--details-height", `${height}px`);
      }
    }

    // Never lock a pixel width here; otherwise sidebar drag can leave a stale width.
    // Keep the section fluid and let parent pane resizing drive the width.
    body.style.minWidth = "0";
    body.style.width = "100%";
    body.style.maxWidth = "100%";
    const widthProbe =
      viewItem?.clientWidth ||
      details?.clientWidth ||
      body.parentElement?.clientWidth ||
      0;
    if (widthProbe > 0) lastWidthMap.set(body, widthProbe);
  } catch (_e) {
    body.style.width = "100%";
    body.style.maxWidth = "100%";
  }
}

function setupResizeObserver(body: HTMLElement) {
  teardownResizeObserver(body);
  const { details, section, viewItem } = resolveLayoutRefs(body);
  const targets = new Set<Element>();
  if (viewItem) targets.add(viewItem);
  if (details) targets.add(details);
  if (section) targets.add(section);
  if (body.parentElement) targets.add(body.parentElement);

  // ResizeObserver: primary mechanism
  if (targets.size > 0) {
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (rafId) return;
      rafId = (
        body.ownerDocument.defaultView || globalThis
      ).requestAnimationFrame(() => {
        rafId = 0;
        if (isSafeBody(body)) onUpdateHeight({ body });
      });
    });
    for (const t of targets) observer.observe(t);
    resizeObserverMap.set(body, observer);
  }

  // Polling fallback: catches splitter drags that ResizeObserver may miss
  // (e.g. when XUL layout changes don't propagate to HTML ResizeObserver)
  const win = body.ownerDocument.defaultView;
  if (win) {
    const timerId = win.setInterval(() => {
      if (!isSafeBody(body)) {
        teardownResizeObserver(body);
        return;
      }
      const refs = resolveLayoutRefs(body);
      const refEl = refs.viewItem || refs.details;
      if (!refEl) return;
      const currentWidth = refEl.clientWidth;
      const prevWidth = lastWidthMap.get(body) || 0;
      if (currentWidth > 0 && currentWidth !== prevWidth) {
        lastWidthMap.set(body, currentWidth);
        onUpdateHeight({ body });
      }
    }, 250);
    pollTimerMap.set(body, timerId);
  }
}

function teardownResizeObserver(body: HTMLElement) {
  const observer = resizeObserverMap.get(body);
  if (observer) {
    observer.disconnect();
    resizeObserverMap.delete(body);
  }
  const timerId = pollTimerMap.get(body);
  if (timerId) {
    try {
      body.ownerDocument?.defaultView?.clearInterval(timerId);
    } catch (_e) {
      /* ignore */
    }
    pollTimerMap.delete(body);
  }
  lastWidthMap.delete(body);
}

function scheduleReferenceSyncRetry(delayMs = 120) {
  try {
    const win =
      activeBody?.ownerDocument?.defaultView ||
      Zotero.getMainWindow?.() ||
      null;
    if (!win) return;
    if (referenceSyncRetryTimer) {
      win.clearTimeout(referenceSyncRetryTimer);
      referenceSyncRetryTimer = null;
    }
    referenceSyncRetryTimer = win.setTimeout(() => {
      referenceSyncRetryTimer = null;
      syncReferenceCardDirect(2);
    }, delayMs);
  } catch (_e) {
    // ignore
  }
}

export function unregisterAgentSection() {
  isGenerating = false;
  try {
    if (activeXHR) {
      activeXHR.abort();
      activeXHR = null;
    }
  } catch (_e) {
    /* ignore */
  }
  if (activeBody) {
    teardownResizeObserver(activeBody);
  }
  try {
    const win =
      activeBody?.ownerDocument?.defaultView ||
      Zotero.getMainWindow?.() ||
      null;
    if (win && referenceSyncRetryTimer) {
      win.clearTimeout(referenceSyncRetryTimer);
      referenceSyncRetryTimer = null;
    }
  } catch (_e) {
    // ignore
  }
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
    if (!isSafeBody(activeBody)) return;
    const reader = getActiveReader();
    const itemId = reader?._item?.id || Number(activeBody.dataset.itemID) || 0;
    if (itemId <= 0) return;
    applySectionData(activeBody, reader, itemId);
    onUpdateHeight({ body: activeBody });
  } catch (_e) {
    // ignore
  }
}

export function syncReferenceCardDirect(retryCount = 0) {
  try {
    if (!isSafeBody(activeBody)) {
      if (retryCount < 2) {
        scheduleReferenceSyncRetry(120);
      }
      return;
    }
    syncContextChips(activeBody);
    const inputArea = activeBody.querySelector(
      "#zoteroagent-input-area",
    ) as HTMLElement | null;
    if (!inputArea) {
      if (retryCount < 2) {
        scheduleReferenceSyncRetry(120);
      }
      return;
    }
    if (
      inputArea &&
      (addon.data.chat.referenceText || addon.data.chat.responseQuote)
    ) {
      inputArea.style.display = "flex";
      activeBody.dataset.chatMode = "chat";
      const itemId = Number(activeBody.dataset.itemID);
      if (itemId > 0) syncLayoutState(activeBody, itemId);
      (
        activeBody.querySelector(
          "#zoteroagent-chat-input",
        ) as HTMLTextAreaElement | null
      )?.focus();
    }
  } catch (_e) {
    ztoolkit.log("[Agent] syncReferenceCardDirect error:", _e);
  }
}

export function showAgentPanel() {
  updateSidebarPanels();
  try {
    if (isSafeBody(activeBody) && sectionPaneID) {
      const details = findAncestor(activeBody, "item-details");
      (details as any)?.scrollToPane?.(sectionPaneID);
    }
  } catch (_e) {
    // ignore scroll errors
  }
}

// ===================== Chat UI =====================

function ensureChatUI(body: HTMLElement) {
  if (body.querySelector("#zoteroagent-chat-panel")) return;

  const doc = body.ownerDocument;
  const container = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  container.id = "zoteroagent-chat-panel";
  container.className = "zoteroagent-chat-panel";
  body.dataset.chatMode = "chat";

  const messagesDiv = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
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

  const sessionTitle = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  );
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

  const historyPanel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
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

  const contextChips = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  contextChips.id = "zoteroagent-context-chips";
  contextChips.className = "zoteroagent-context-chips";
  contextChips.style.display = "none";

  const slashMenu = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  slashMenu.id = "zoteroagent-slash-menu";
  slashMenu.className = "zoteroagent-slash-menu";
  slashMenu.style.display = "none";

  const mentionMenu = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  mentionMenu.id = "zoteroagent-mention-menu";
  mentionMenu.className = "zoteroagent-mention-menu";
  mentionMenu.style.display = "none";

  const composeArea = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  composeArea.id = "zoteroagent-compose-area";
  composeArea.className = "zoteroagent-compose-area";

  const textarea = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "textarea",
  ) as HTMLTextAreaElement;
  textarea.id = "zoteroagent-chat-input";
  textarea.rows = 3;
  textarea.placeholder =
    "Ask about this paper... Type / for actions, @ to attach a library PDF";

  const actionsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsRow.id = "zoteroagent-actions-row";
  actionsRow.className = "zoteroagent-actions-row";

  const actionsLeft = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  actionsLeft.className = "zoteroagent-actions-left";

  const uploadBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  uploadBtn.id = "zoteroagent-upload-btn";
  uploadBtn.className = "zoteroagent-upload-btn zoteroagent-icon-button";
  uploadBtn.type = "button";
  setIconButton(uploadBtn as HTMLButtonElement, "attach", "Upload images");

  const pdfAttachBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  pdfAttachBtn.id = "zoteroagent-pdf-attach-btn";
  pdfAttachBtn.className = "zoteroagent-upload-btn zoteroagent-icon-button";
  pdfAttachBtn.type = "button";
  setIconButton(
    pdfAttachBtn as HTMLButtonElement,
    "attachPdf",
    "Attach reference PDF",
  );

  const uploadInput = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "input",
  ) as HTMLInputElement;
  uploadInput.id = "zoteroagent-upload-input";
  uploadInput.type = "file";
  uploadInput.accept = "image/*";
  uploadInput.multiple = true;
  uploadInput.style.display = "none";

  const pdfInput = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "input",
  ) as HTMLInputElement;
  pdfInput.id = "zoteroagent-pdf-attach-input";
  pdfInput.type = "file";
  pdfInput.accept = "application/pdf,.pdf";
  pdfInput.multiple = false;
  pdfInput.style.display = "none";

  const serviceSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  serviceSelect.id = "zoteroagent-service-select";
  serviceSelect.className = "zoteroagent-service-select";
  populateServiceOptions(serviceSelect);

  const actionsRight = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  actionsRight.className = "zoteroagent-actions-right";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.textContent = "Send";

  actionsLeft.appendChild(pdfAttachBtn);
  actionsLeft.appendChild(uploadBtn);
  actionsLeft.appendChild(serviceSelect);
  actionsRight.appendChild(sendBtn);
  actionsRow.appendChild(actionsLeft);
  actionsRow.appendChild(actionsRight);

  const imagePreview = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  imagePreview.id = "zoteroagent-image-preview";
  imagePreview.className = "zoteroagent-image-preview";
  imagePreview.style.display = "none";

  const contextPdfChip = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  contextPdfChip.id = "zoteroagent-context-pdf-chip";
  contextPdfChip.className = "zoteroagent-context-pdf-chip";
  contextPdfChip.style.display = "none";

  composeArea.appendChild(textarea);
  composeArea.appendChild(contextPdfChip);
  composeArea.appendChild(imagePreview);
  composeArea.appendChild(actionsRow);
  composeArea.appendChild(uploadInput);
  composeArea.appendChild(pdfInput);

  inputArea.appendChild(contextChips);
  inputArea.appendChild(slashMenu);
  inputArea.appendChild(mentionMenu);
  inputArea.appendChild(composeArea);

  const headerWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  headerWrap.className = "zoteroagent-header-wrap";
  headerWrap.appendChild(sessionRow);
  headerWrap.appendChild(historyPanel);

  container.appendChild(headerWrap);
  container.appendChild(messagesDiv);
  container.appendChild(inputArea);
  const quotePopup = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  quotePopup.id = "zoteroagent-quote-popup";
  quotePopup.className = "zoteroagent-quote-popup";
  quotePopup.type = "button";
  quotePopup.textContent = "❞ Quote";
  container.appendChild(quotePopup);
  body.appendChild(container);

  bindChatEvents(body);
}

function bindChatEvents(body: HTMLElement) {
  body
    .querySelector("#zoteroagent-chat-send")
    ?.addEventListener("click", () => {
      void submitQuestion(body);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("keydown", (event) => {
      const ke = event as KeyboardEvent;
      if (handleMentionMenuKeydown(body, ke)) {
        return;
      }
      if (handleSlashMenuKeydown(body, ke)) {
        return;
      }
      if (ke.key === "Enter" && !ke.shiftKey) {
        event.preventDefault();
        void submitQuestion(body);
      }
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("input", () => {
      updateSlashMenuForInput(body);
      updateMentionMenuForInput(body);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("click", () => {
      updateSlashMenuForInput(body);
      updateMentionMenuForInput(body);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("keyup", () => {
      updateSlashMenuForInput(body);
      updateMentionMenuForInput(body);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("paste", (event) => {
      const pe = event as ClipboardEvent;
      const files = extractImagesFromClipboard(pe);
      if (!files.length) return;
      pe.preventDefault();
      pe.stopPropagation();
      void processIncomingImages(body, files);
    });
  body
    .querySelector("#zoteroagent-upload-btn")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const input = body.querySelector(
        "#zoteroagent-upload-input",
      ) as HTMLInputElement | null;
      input?.click();
    });
  body
    .querySelector("#zoteroagent-pdf-attach-btn")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const input = body.querySelector(
        "#zoteroagent-pdf-attach-input",
      ) as HTMLInputElement | null;
      input?.click();
    });
  body
    .querySelector("#zoteroagent-upload-input")
    ?.addEventListener("change", (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      (event.target as HTMLInputElement).value = "";
      void processIncomingImages(body, files);
    });
  body
    .querySelector("#zoteroagent-pdf-attach-input")
    ?.addEventListener("change", (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      (event.target as HTMLInputElement).value = "";
      void processIncomingContextPdf(body, files[0]);
    });
  const dropZone = body.querySelector(
    "#zoteroagent-input-area",
  ) as HTMLElement | null;
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
      const files = Array.from(de.dataTransfer?.files || []);
      const imageFiles = files.filter((file) => isImageFile(file));
      const contextPdf = files.find((file) => isPdfFile(file));
      if (imageFiles.length) {
        void processIncomingImages(body, imageFiles);
      }
      if (contextPdf) {
        void processIncomingContextPdf(body, contextPdf);
      }
    });
  }
  body
    .querySelector("#zoteroagent-session-select")
    ?.addEventListener("change", (event) => {
      const sessionId = (event.target as HTMLSelectElement).value;
      const itemId = Number(body.dataset.itemID);
      if (itemId > 0 && sessionId) {
        chatStore.setActiveSession(itemId, sessionId);
        addon.data.chat.pendingContextPdf = null;
        renderMessages(body, itemId);
        syncServiceSelector(body);
        syncLayoutState(body, itemId);
        refreshContextPdfChip(body);
      }
    });
  body
    .querySelector("#zoteroagent-session-new")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session = chatStore.createSession(
        itemId,
        undefined,
        AGENT_CONTEXT_MODE,
      );
      if (!session) return;
      body.dataset.chatMode = "chat";
      addon.data.chat.pendingContextPdf = null;
      syncSessionSelector(body, itemId);
      renderMessages(body, itemId);
      syncServiceSelector(body);
      syncLayoutState(body, itemId);
      refreshContextPdfChip(body);
      (
        body.querySelector(
          "#zoteroagent-chat-input",
        ) as HTMLTextAreaElement | null
      )?.focus();
    });
  body
    .querySelector("#zoteroagent-session-rename")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session = chatStore.getSession(itemId);
      if (!session) return;
      const currentTitle = session.title;
      const next = body.ownerDocument.defaultView?.prompt(
        "Session title",
        currentTitle,
      );
      if (!next || !next.trim()) return;
      chatStore.renameSession(itemId, next, session.sessionId);
      syncSessionSelector(body, itemId);
    });
  body
    .querySelector("#zoteroagent-session-delete")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const ok = body.ownerDocument.defaultView?.confirm(
        "Delete this session history?",
      );
      if (!ok) return;
      const active = chatStore.getSession(itemId);
      if (!active) return;
      void chatStore.deleteSession(itemId, active.sessionId).then(() => {
        if (!isSafeBody(body)) return;
        addon.data.chat.pendingContextPdf = null;
        renderMessages(body, itemId);
        syncSessionSelector(body, itemId);
        syncServiceSelector(body);
        syncLayoutState(body, itemId);
        refreshContextPdfChip(body);
      });
    });
  body
    .querySelector("#zoteroagent-session-history")
    ?.addEventListener("click", () => {
      const panel = body.querySelector(
        "#zoteroagent-history-panel",
      ) as HTMLElement | null;
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
  body
    .querySelector("#zoteroagent-service-select")
    ?.addEventListener("change", (event) => {
      const id = (event.target as HTMLSelectElement).value;
      if (id) setActiveServiceId(id);
    });

  body.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    if (!target) return;
    if (
      target.closest(
        "#zoteroagent-slash-menu, #zoteroagent-mention-menu, #zoteroagent-chat-input",
      )
    )
      return;
    closeSlashMenu(body);
    closeMentionMenu(body);
  });
  bindAssistantSelectionEvents(body);
  refreshPendingImagesPreview(body);
  refreshContextPdfChip(body);
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
  if (isSafeBody(body)) refreshPendingImagesPreview(body);
}

function refreshPendingImagesPreview(body: HTMLElement) {
  const wrap = body.querySelector(
    "#zoteroagent-image-preview",
  ) as HTMLElement | null;
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
    const img = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "img",
    ) as HTMLImageElement;
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

async function processIncomingContextPdf(body: HTMLElement, file?: File) {
  if (!file || !isPdfFile(file)) return;
  const itemId = Number(body.dataset.itemID);
  if (itemId <= 0) return;
  if (!chatStore.getSession(itemId)) {
    chatStore.createSession(itemId, undefined, AGENT_CONTEXT_MODE);
  }

  const baseRef: SessionContextPdfRef = {
    source: "upload",
    hash: "",
    fileName: String(file.name || "").trim() || "reference.pdf",
    fileSize: Math.max(0, Number(file.size) || 0),
    addedAt: Date.now(),
  };
  if (baseRef.fileSize > MAX_CONTEXT_PDF_SIZE_BYTES) {
    addon.data.chat.pendingContextPdf = {
      ...baseRef,
      status: "error",
      error: `PDF is too large. Maximum size is ${formatFileSize(MAX_CONTEXT_PDF_SIZE_BYTES)}.`,
    };
    refreshContextPdfChip(body);
    return;
  }

  const currentTaskId = ++contextPdfTaskId;
  addon.data.chat.pendingContextPdf = {
    ...baseRef,
    status: "uploading",
  };
  refreshContextPdfChip(body);

  try {
    const result = await addUploadContextPdf(file, {
      miniModel: getMiniModel(),
      maxContextTokens: getActiveMaxContextTokens(),
      onStatus: (status: ContextPdfStatus, text: string) => {
        if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
        const previous = addon.data.chat.pendingContextPdf;
        addon.data.chat.pendingContextPdf = {
          ...(previous || baseRef),
          status,
          error: status === "error" ? text : "",
        };
        refreshContextPdfChip(body);
      },
    });
    if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
    chatStore.setSessionContextPdf(itemId, result.ref);
    addon.data.chat.pendingContextPdf = {
      ...result.ref,
      status: "ready",
    };
    refreshContextPdfChip(body);
  } catch (e: any) {
    if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
    addon.data.chat.pendingContextPdf = {
      ...baseRef,
      status: "error",
      error: e?.message || String(e) || "Failed to process PDF.",
    };
    refreshContextPdfChip(body);
  }
}

async function processLocalPathContextPdfFromQuestion(
  body: HTMLElement,
  itemId: number,
  question: string,
): Promise<ContextPdfData | null> {
  const candidates = extractLocalPathCandidates(question).slice(0, 3);
  if (!candidates.length) return null;
  if (!chatStore.getSession(itemId)) {
    chatStore.createSession(itemId, undefined, AGENT_CONTEXT_MODE);
  }

  const firstPath = candidates[0];
  const baseRef: SessionContextPdfRef = {
    source: "upload",
    hash: "",
    fileName: firstPath.split(/[\\/]/).filter(Boolean).pop() || "local.pdf",
    fileSize: 0,
    addedAt: Date.now(),
  };
  const currentTaskId = ++contextPdfTaskId;
  addon.data.chat.pendingContextPdf = {
    ...baseRef,
    status: "uploading",
  };
  refreshContextPdfChip(body);

  let lastError = "";
  for (const candidate of candidates) {
    try {
      const result = await addLocalPathContextPdf(candidate, {
        miniModel: getMiniModel(),
        maxContextTokens: getActiveMaxContextTokens(),
        onStatus: (status: ContextPdfStatus, text: string) => {
          if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
          const previous = addon.data.chat.pendingContextPdf;
          addon.data.chat.pendingContextPdf = {
            ...(previous || baseRef),
            status,
            error: status === "error" ? text : "",
          };
          refreshContextPdfChip(body);
        },
      });
      if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return null;
      chatStore.setSessionContextPdf(itemId, result.ref);
      addon.data.chat.pendingContextPdf = {
        ...result.ref,
        status: "ready",
      };
      refreshContextPdfChip(body);
      return result.data;
    } catch (e: any) {
      lastError = e?.message || String(e) || "Failed to read local PDF.";
    }
  }

  if (currentTaskId === contextPdfTaskId && isSafeBody(body)) {
    addon.data.chat.pendingContextPdf = {
      ...baseRef,
      status: "error",
      error: lastError || `No readable PDF found at ${firstPath}.`,
    };
    refreshContextPdfChip(body);
  }
  throw new Error(lastError || `No readable PDF found at ${firstPath}.`);
}

function refreshContextPdfChip(body: HTMLElement) {
  const chip = body.querySelector(
    "#zoteroagent-context-pdf-chip",
  ) as HTMLElement | null;
  if (!chip) return;
  while (chip.firstChild) chip.firstChild.remove();

  const itemId = Number(body.dataset.itemID);
  const sessionRef =
    itemId > 0 ? chatStore.getSession(itemId)?.contextPdf : undefined;
  const pending = addon.data.chat.pendingContextPdf;

  let displayRef: SessionContextPdfRef | null = sessionRef || null;
  let status: ContextPdfStatus = "ready";
  let errorText = "";

  if (pending) {
    const pendingHash = String(pending.hash || "").trim();
    const sessionHash = String(sessionRef?.hash || "").trim();
    const shouldPreferPending =
      pending.status !== "ready" ||
      !sessionRef ||
      !pendingHash ||
      pendingHash === sessionHash;
    if (shouldPreferPending) {
      displayRef = {
        source: pending.source,
        hash: pending.hash,
        fileName: pending.fileName,
        fileSize: pending.fileSize,
        addedAt: pending.addedAt,
        itemKey: pending.itemKey,
        itemId: pending.itemId,
      };
      status = pending.status;
      errorText = String(pending.error || "").trim();
    }
  }

  if (!displayRef) {
    chip.style.display = "none";
    return;
  }

  const doc = body.ownerDocument;
  const source = displayRef.source || "upload";
  chip.className = `zoteroagent-context-pdf-chip is-${status} source-${source}`;

  const icon = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  icon.className = "zoteroagent-context-pdf-icon";
  icon.textContent = source === "library" ? "LIB" : "PDF";

  const textWrap = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  textWrap.className = "zoteroagent-context-pdf-text";

  const titleRow = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  titleRow.className = "zoteroagent-context-pdf-title-row";

  const sourceBadge = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  sourceBadge.className = `zoteroagent-context-pdf-source-badge is-${source}`;
  sourceBadge.textContent = source === "library" ? "Library" : "Upload";

  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.className = "zoteroagent-context-pdf-title";
  title.textContent = displayRef.fileName || "Reference PDF";
  title.title = displayRef.fileName || "Reference PDF";

  titleRow.appendChild(sourceBadge);
  titleRow.appendChild(title);

  const meta = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  meta.className = "zoteroagent-context-pdf-meta";
  const statusText = contextPdfStatusText(status);
  const sizeBytes = Math.max(0, Number(displayRef.fileSize) || 0);
  const sizeText = sizeBytes > 0 ? formatFileSize(sizeBytes) : "";
  const metaParts = [sizeText, statusText].filter(Boolean);
  meta.textContent = metaParts.join(" · ");
  if (errorText) meta.title = errorText;

  textWrap.appendChild(titleRow);
  if (meta.textContent) textWrap.appendChild(meta);

  const removeBtn = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  removeBtn.type = "button";
  removeBtn.className = "zoteroagent-context-pdf-remove";
  removeBtn.textContent = "×";
  removeBtn.title =
    status === "uploading" || status === "parsing" || status === "overviewing"
      ? "Cancel reference PDF"
      : "Remove reference PDF";
  removeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    contextPdfTaskId += 1;
    addon.data.chat.pendingContextPdf = null;
    if (itemId > 0) {
      chatStore.clearSessionContextPdf(itemId);
    }
    refreshContextPdfChip(body);
  });

  chip.appendChild(icon);
  chip.appendChild(textWrap);
  chip.appendChild(removeBtn);
  chip.style.display = "flex";
}

function contextPdfStatusText(status: ContextPdfStatus): string {
  switch (status) {
    case "uploading":
      return "Hashing";
    case "parsing":
      return "Parsing";
    case "overviewing":
      return "Generating overview";
    case "error":
      return "Error";
    case "ready":
    default:
      return "Ready";
  }
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
  const slashMenu = body.querySelector(
    "#zoteroagent-slash-menu",
  ) as HTMLElement | null;
  if (slashMenu) {
    slashMenu.style.display = "none";
    while (slashMenu.firstChild) slashMenu.firstChild.remove();
  }
  clearSlashState(body);
}

function updateSlashMenuForInput(body: HTMLElement) {
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  const slashMenu = body.querySelector(
    "#zoteroagent-slash-menu",
  ) as HTMLElement | null;
  if (!input || !slashMenu) return;
  const caretEnd =
    typeof input.selectionStart === "number"
      ? input.selectionStart
      : input.value.length;
  const token = parseSlashToken(input.value, caretEnd);
  if (!token) {
    closeSlashMenu(body);
    return;
  }
  const mentionToken = parseMentionToken(input.value, caretEnd);
  if (mentionToken && mentionToken.atStart > token.slashStart) {
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
  const slashMenu = body.querySelector(
    "#zoteroagent-slash-menu",
  ) as HTMLElement | null;
  const state = getSlashState(body);
  if (!slashMenu || !state) return;
  while (slashMenu.firstChild) slashMenu.firstChild.remove();
  const doc = body.ownerDocument;
  state.commands.forEach((command, index) => {
    const btn = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "button",
    ) as HTMLButtonElement;
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

function handleSlashMenuKeydown(
  body: HTMLElement,
  event: KeyboardEvent,
): boolean {
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
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
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

// ===================== @-Mention Menu =====================

function getMentionState(body: HTMLElement) {
  return mentionStateByPane.get(getPaneUid(body)) || null;
}

function setMentionState(
  body: HTMLElement,
  next: {
    token: MentionToken;
    candidates: MentionCandidate[];
    activeIndex: number;
    loading: boolean;
    pendingQuery: string;
    requestSeq: number;
  },
) {
  mentionStateByPane.set(getPaneUid(body), next);
}

function clearMentionState(body: HTMLElement) {
  mentionStateByPane.delete(getPaneUid(body));
}

function closeMentionMenu(body: HTMLElement) {
  const menu = body.querySelector(
    "#zoteroagent-mention-menu",
  ) as HTMLElement | null;
  if (menu) {
    menu.style.display = "none";
    while (menu.firstChild) menu.firstChild.remove();
  }
  clearMentionState(body);
}

function updateMentionMenuForInput(body: HTMLElement) {
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  const menu = body.querySelector(
    "#zoteroagent-mention-menu",
  ) as HTMLElement | null;
  if (!input || !menu) return;
  const caretEnd =
    typeof input.selectionStart === "number"
      ? input.selectionStart
      : input.value.length;
  const token = parseMentionToken(input.value, caretEnd);
  if (!token) {
    closeMentionMenu(body);
    return;
  }
  const slashToken = parseSlashToken(input.value, caretEnd);
  if (slashToken && slashToken.slashStart > token.atStart) {
    closeMentionMenu(body);
    return;
  }
  if (slashToken) closeSlashMenu(body);
  const prev = getMentionState(body);
  const requestSeq = ++mentionRequestCounter;
  const nextState = {
    token,
    candidates: prev?.candidates || [],
    activeIndex: Math.max(
      0,
      Math.min(prev?.activeIndex || 0, (prev?.candidates?.length || 1) - 1),
    ),
    loading: true,
    pendingQuery: token.query,
    requestSeq,
  };
  setMentionState(body, nextState);
  renderMentionMenu(body);

  void (async () => {
    try {
      ztoolkit.log(
        `[Agent] @-mention search start query="${token.query}" seq=${requestSeq}`,
      );
      const candidates = await searchLibraryItemsForMention(token.query, 8);
      ztoolkit.log(
        `[Agent] @-mention search done query="${token.query}" count=${candidates.length}`,
      );
      const cur = getMentionState(body);
      if (!cur || cur.requestSeq !== requestSeq) return;
      if (cur.token.atStart !== token.atStart) return;
      const activeIndex = candidates.length
        ? Math.max(0, Math.min(cur.activeIndex || 0, candidates.length - 1))
        : 0;
      setMentionState(body, {
        ...cur,
        candidates,
        activeIndex,
        loading: false,
      });
      renderMentionMenu(body);
    } catch (e) {
      ztoolkit.log("[Agent] @-mention search error:", e);
      const cur = getMentionState(body);
      if (!cur || cur.requestSeq !== requestSeq) return;
      setMentionState(body, { ...cur, candidates: [], loading: false });
      renderMentionMenu(body);
    }
  })();
}

function renderMentionMenu(body: HTMLElement) {
  const menu = body.querySelector(
    "#zoteroagent-mention-menu",
  ) as HTMLElement | null;
  const state = getMentionState(body);
  if (!menu || !state) return;
  while (menu.firstChild) menu.firstChild.remove();
  const doc = body.ownerDocument;

  if (state.loading && state.candidates.length === 0) {
    const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    empty.className = "zoteroagent-mention-empty";
    empty.textContent = "Searching Zotero library...";
    menu.appendChild(empty);
    menu.style.display = "block";
    return;
  }
  if (state.candidates.length === 0) {
    const empty = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    empty.className = "zoteroagent-mention-empty";
    empty.textContent = state.token.query
      ? `No library items match "${state.token.query}".`
      : "Start typing to search your Zotero library (title, author, year).";
    menu.appendChild(empty);
    menu.style.display = "block";
    return;
  }

  state.candidates.forEach((cand, index) => {
    const btn = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    btn.className = "zoteroagent-mention-item";
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "-1");
    if (index === state.activeIndex) btn.classList.add("active");

    const titleText = String(cand.title || "").trim() || "Untitled";
    const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    title.className = "zoteroagent-mention-item-title";
    title.setAttribute("title", titleText);
    title.appendChild(doc.createTextNode(titleText));

    const subtitleText = String(cand.subtitle || "").trim();
    btn.appendChild(title);
    if (subtitleText) {
      const sub = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      sub.className = "zoteroagent-mention-item-subtitle";
      sub.appendChild(doc.createTextNode(subtitleText));
      btn.appendChild(sub);
    }

    btn.addEventListener("mouseenter", () => {
      const cur = getMentionState(body);
      if (!cur) return;
      setMentionState(body, { ...cur, activeIndex: index });
      renderMentionMenu(body);
    });
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void selectMentionCandidate(body, index);
    });
    menu.appendChild(btn);
  });
  menu.style.display = "block";
}

function handleMentionMenuKeydown(
  body: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const state = getMentionState(body);
  if (!state) return false;
  if (state.candidates.length === 0) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionMenu(body);
      return true;
    }
    return false;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setMentionState(body, {
      ...state,
      activeIndex: (state.activeIndex + 1) % state.candidates.length,
    });
    renderMentionMenu(body);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    setMentionState(body, {
      ...state,
      activeIndex:
        (state.activeIndex - 1 + state.candidates.length) %
        state.candidates.length,
    });
    renderMentionMenu(body);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeMentionMenu(body);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    void selectMentionCandidate(body, state.activeIndex);
    return true;
  }
  return false;
}

async function selectMentionCandidate(body: HTMLElement, index: number) {
  const state = getMentionState(body);
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  if (!state || !input) return;
  const candidate = state.candidates[index];
  if (!candidate) return;
  const itemId = Number(body.dataset.itemID) || 0;
  if (itemId <= 0) return;

  const consumed = consumeMentionToken(input.value, state.token);
  input.value = consumed.value;
  closeMentionMenu(body);
  input.focus();
  try {
    input.setSelectionRange(consumed.caret, consumed.caret);
  } catch (_e) {
    // ignore
  }
  await processIncomingLibraryReference(body, candidate);
}

async function processIncomingLibraryReference(
  body: HTMLElement,
  candidate: MentionCandidate,
) {
  const itemId = Number(body.dataset.itemID);
  if (itemId <= 0) return;
  if (!chatStore.getSession(itemId)) {
    chatStore.createSession(itemId, undefined, AGENT_CONTEXT_MODE);
  }

  const baseRef: SessionContextPdfRef = {
    source: "library",
    hash: `lib-${candidate.attachmentItemKey}`,
    fileName: candidate.fileName || candidate.title || "Library PDF",
    fileSize: Math.max(0, Number(candidate.fileSize) || 0),
    addedAt: Date.now(),
    itemKey: candidate.attachmentItemKey,
    itemId: candidate.attachmentItemId,
  };

  const currentTaskId = ++contextPdfTaskId;
  addon.data.chat.pendingContextPdf = {
    ...baseRef,
    status: "uploading",
  };
  refreshContextPdfChip(body);

  try {
    const result = await addLibraryContextPdf(candidate.attachmentItemId, {
      miniModel: getMiniModel(),
      maxContextTokens: getActiveMaxContextTokens(),
      onStatus: (status: ContextPdfStatus, text: string) => {
        if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
        const previous = addon.data.chat.pendingContextPdf;
        addon.data.chat.pendingContextPdf = {
          ...(previous || baseRef),
          status,
          error: status === "error" ? text : "",
        };
        refreshContextPdfChip(body);
      },
    });
    if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
    chatStore.setSessionContextPdf(itemId, result.ref);
    addon.data.chat.pendingContextPdf = {
      ...result.ref,
      status: "ready",
    };
    refreshContextPdfChip(body);
  } catch (e: any) {
    if (currentTaskId !== contextPdfTaskId || !isSafeBody(body)) return;
    addon.data.chat.pendingContextPdf = {
      ...baseRef,
      status: "error",
      error: e?.message || String(e) || "Failed to read library PDF.",
    };
    refreshContextPdfChip(body);
  }
}

// ===================== Generation State =====================

function setGenerating(body: HTMLElement, generating: boolean) {
  isGenerating = generating;
  if (!isSafeBody(body)) return;
  const sendBtn = body.querySelector(
    "#zoteroagent-chat-send",
  ) as HTMLElement | null;
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
  if (!generating) {
    hideAgentStatus(body);
  }
}

function showAgentStatus(body: HTMLElement, text: string) {
  if (!isSafeBody(body)) return;
  const container = body.querySelector(
    "#zoteroagent-chat-messages",
  ) as HTMLElement | null;
  if (!container) return;

  const msgWrapper = container.querySelector(
    ".zoteroagent-message.assistant:last-child",
  ) as HTMLElement | null;
  if (!msgWrapper) return;

  const mainEl =
    (msgWrapper.querySelector(
      ".zoteroagent-message-main",
    ) as HTMLElement | null) || msgWrapper;

  let statusEl = mainEl.querySelector(
    ".zoteroagent-agent-status",
  ) as HTMLElement | null;
  if (!statusEl) {
    const doc = body.ownerDocument;
    statusEl = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
    statusEl.className = "zoteroagent-agent-status";
    const insertRef =
      mainEl.querySelector(".zoteroagent-thinking") ||
      mainEl.querySelector(".zoteroagent-message-content");
    if (insertRef) {
      mainEl.insertBefore(statusEl, insertRef);
    } else {
      mainEl.appendChild(statusEl);
    }
  }
  statusEl.textContent = text || "Generating...";

  if (isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

function hideAgentStatus(body: HTMLElement) {
  if (!isSafeBody(body)) return;
  const container = body.querySelector(
    "#zoteroagent-chat-messages",
  ) as HTMLElement | null;
  if (!container) return;
  container
    .querySelectorAll(".zoteroagent-agent-status")
    .forEach((el) => el.remove());
}

function abortGeneration(body: HTMLElement) {
  if (activeXHR) {
    try {
      activeXHR.abort();
    } catch (_e) {
      /* ignore */
    }
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
      const isAttachment =
        typeof item.isAttachment === "function" && item.isAttachment();
      const isPdf =
        (typeof item.isPDFAttachment === "function" &&
          item.isPDFAttachment()) ||
        item.attachmentContentType === "application/pdf" ||
        item.getField?.("mimeType") === "application/pdf";
      if (isAttachment && isPdf) {
        const p =
          typeof item.getFilePath === "function"
            ? String(item.getFilePath() || "")
            : "";
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
            (typeof child.isPDFAttachment === "function" &&
              child.isPDFAttachment()) ||
            child.attachmentContentType === "application/pdf" ||
            child.getField?.("mimeType") === "application/pdf";
          if (!childIsPdf) continue;
          const filePath =
            typeof child.getFilePath === "function"
              ? String(child.getFilePath() || "")
              : "";
          if (filePath) return aid;
        }
      }
    } catch (_e) {
      // continue to next candidate
    }
  }
  return 0;
}

function addAssistantMessage(
  body: HTMLElement,
  itemId: number,
  content: string,
) {
  chatStore.addMessage(
    itemId,
    { role: "assistant", content, model: getModelLabel() },
    AGENT_CONTEXT_MODE,
  );
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
}

function addUserCommandMessage(
  body: HTMLElement,
  itemId: number,
  commandLabel: string,
) {
  chatStore.addMessage(
    itemId,
    { role: "user", content: commandLabel },
    AGENT_CONTEXT_MODE,
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
      addAssistantMessage(
        body,
        itemId,
        "No AGENTS.md found for this paper. Please run /init first.",
      );
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
    addAssistantMessage(
      body,
      itemId,
      "Failed to open AGENTS.md. Please try again later.",
    );
  }
}

function bindAgentsMdLink(
  container: HTMLElement,
  body: HTMLElement,
  itemId: number,
) {
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
  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant, AGENT_CONTEXT_MODE);
  renderMessages(body, itemId);
  setGenerating(body, true);
  showAgentStatus(body, "Reading PDF full text...");

  const reader = getActiveReader();
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  if (pdfItemId <= 0) {
    assistant.content =
      "No valid PDF attachment found. Please confirm the item has an accessible PDF attachment in Zotero.";
    setGenerating(body, false);
    renderMessages(body, itemId);
    return;
  }
  const fullText = await getFullText(pdfItemId);
  if (!fullText.trim()) {
    assistant.content =
      "PDF attachment found, but full text could not be extracted. Please verify the PDF has a text layer or has been indexed.";
    setGenerating(body, false);
    renderMessages(body, itemId);
    return;
  }
  showAgentStatus(body, "Generating AGENTS.md overview...");
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
      assistant.content =
        "/init failed: the model did not return valid content.";
      setGenerating(body, false);
      renderMessages(body, itemId);
      return;
    }
    await savePaperOverview(getItemKey(itemId), overview);
    assistant.content =
      "Paper overview generated. I now have context about this paper. Open [AGENTS.md](zoteroagent://agents-md).";
  } catch (e: any) {
    assistant.content = `[Error] /init failed: ${e?.message || String(e)}`;
  }
  chatStore.touchSession(itemId, AGENT_CONTEXT_MODE);
  setGenerating(body, false);
  renderMessages(body, itemId);
}

async function runSummaryCommand(body: HTMLElement, itemId: number) {
  if (isGenerating) return;
  const reader = getActiveReader();
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  const fullText = await getFullText(pdfItemId);
  if (!fullText.trim()) {
    addAssistantMessage(
      body,
      itemId,
      "Could not extract full text from the PDF. Unable to run /summary.",
    );
    return;
  }
  const itemKey = getItemKey(itemId);
  const maxCtx = getActiveMaxContextTokens();

  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant, AGENT_CONTEXT_MODE);
  renderMessages(body, itemId);
  setGenerating(body, true);
  try {
    const paperOverview = await ensureAgentsMd(
      itemKey,
      pdfItemId,
      maxCtx,
      (_stage, text) => showAgentStatus(body, text),
      reader,
    );
    showAgentStatus(body, "Generating summary...");
    const clipped = truncateDocContext(fullText, Math.floor(maxCtx * 0.8));
    const prompts = paperSummaryPrompt(clipped, paperOverview);
    let lastRefresh = 0;
    const result = await AIService.chat(prompts as any, {
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
    if (result.usage) assistant.usage = result.usage;
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, AGENT_CONTEXT_MODE);
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
  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant, AGENT_CONTEXT_MODE);
  renderMessages(body, itemId);
  setGenerating(body, true);
  showAgentStatus(body, "Compacting conversation...");
  try {
    const prompts = summarizeHistoryPrompt("", history as any);
    const result = await AIService.chat(prompts as any, {
      stream: false,
      disableThinking: true,
      model: getMiniModel(),
    });
    const summaryText = (result.content || "").trim();
    if (!summaryText) {
      assistant.content = "/compact failed: no summary was generated.";
      setGenerating(body, false);
      renderMessages(body, itemId);
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
      chatStore.touchSession(itemId, AGENT_CONTEXT_MODE);
    }
    assistant.content = "Context compacted. Earlier conversation summarized.";
  } catch (e: any) {
    assistant.content = `[Error] /compact failed: ${e?.message || String(e)}`;
  }
  setGenerating(body, false);
  renderMessages(body, itemId);
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

  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  if (!input) return;
  closeSlashMenu(body);
  closeMentionMenu(body);
  const question = input.value.trim();
  if (!question) return;

  const itemId = Number(body.dataset.itemID);
  if (!itemId || itemId < 0) return;

  const refText = addon.data.chat.referenceText;
  const responseQuote = addon.data.chat.responseQuote;
  const pendingImages = (addon.data.chat.pendingImages || []).slice(
    0,
    MAX_PENDING_IMAGES,
  );
  const activeSession = chatStore.getSession(itemId);
  const activeContextPdfRef = activeSession?.contextPdf;
  const contextBlocks: string[] = [];
  if (refText) contextBlocks.push(`${SELECTED_TEXT_PREFIX}${refText}`);
  if (responseQuote)
    contextBlocks.push(`${RESPONSE_QUOTE_PREFIX}${responseQuote}`);
  const displayContent = contextBlocks.length
    ? `${contextBlocks.join("\n\n")}\n\n${question}`
    : question;

  chatStore.addMessage(
    itemId,
    {
      role: "user",
      content: displayContent,
      images: pendingImages,
      contextPdfRef: activeContextPdfRef
        ? {
            fileName: activeContextPdfRef.fileName,
            source: activeContextPdfRef.source,
          }
        : undefined,
    },
    AGENT_CONTEXT_MODE,
  );
  input.value = "";
  addon.data.chat.referenceText = "";
  addon.data.chat.responseQuote = "";
  addon.data.chat.pendingImages = [];
  syncContextChips(body);
  refreshPendingImagesPreview(body);
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant, AGENT_CONTEXT_MODE);
  const sessions = chatStore.getMessages(itemId);
  renderMessages(body, itemId);
  setGenerating(body, true);
  showAgentStatus(body, "Preparing agent...");

  const reader = addon.data.popup.currentReader;
  const maxCtx = getActiveMaxContextTokens();
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  let localPathContextPdfData: ContextPdfData | null = null;
  try {
    localPathContextPdfData = await processLocalPathContextPdfFromQuestion(
      body,
      itemId,
      question,
    );
  } catch (e: any) {
    assistant.content = `[Error] ${e?.message || String(e)}`;
    setGenerating(body, false);
    renderMessages(body, itemId);
    return;
  }
  const localPathPdfAsMain = Boolean(localPathContextPdfData);
  if (pdfItemId <= 0 && !localPathPdfAsMain) {
    assistant.content =
      "No valid PDF attachment found. Please confirm the item has an accessible PDF attachment in Zotero.";
    setGenerating(body, false);
    renderMessages(body, itemId);
    return;
  }
  const paperOverview = await loadPaperOverview(getItemKey(itemId));

  const quotedBlocks: string[] = [];
  if (refText)
    quotedBlocks.push(`[PDF Text]\n> ${refText.replace(/\n/g, "\n> ")}`);
  if (responseQuote) {
    quotedBlocks.push(
      `[Previous Response]\n> ${responseQuote.replace(/\n/g, "\n> ")}`,
    );
  }
  const aiQuestion = quotedBlocks.length
    ? `${quotedBlocks.join("\n\n")}\n\n${question}`
    : question;
  const fullHistory = sessions.slice(0, -2);
  await ensureAiSessionSummary(itemId, fullHistory);
  const session = chatStore.getSession(itemId);
  let contextPdfData: Awaited<ReturnType<typeof loadContextPdfByRef>> | null =
    localPathContextPdfData;
  const sessionContextPdfRef = localPathPdfAsMain
    ? null
    : session?.contextPdf || activeContextPdfRef;
  if (sessionContextPdfRef) {
    contextPdfData = await loadContextPdfByRef(sessionContextPdfRef);
    if (!contextPdfData) {
      chatStore.clearSessionContextPdf(itemId);
      addon.data.chat.pendingContextPdf = null;
      refreshContextPdfChip(body);
    }
  }
  const history = buildHistoryForRequest(fullHistory, session)
    .filter((m: ChatMessage) => (m.content || "").trim())
    .map((m: ChatMessage) => ({ role: m.role, content: m.content })) as Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;

  try {
    let lastRefresh = 0;
    const result = await executeAgent({
      itemId,
      itemKey: getItemKey(itemId),
      pdfItemId,
      question: aiQuestion,
      reader,
      history,
      maxContextTokens: maxCtx,
      paperOverview: localPathPdfAsMain
        ? contextPdfData?.overview || paperOverview || ""
        : paperOverview || "",
      miniModel: getMiniModel(),
      pendingImages,
      contextPdf: contextPdfData
        ? {
            hash: contextPdfData.hash,
            fileName: contextPdfData.fileName,
            overview: contextPdfData.overview,
            pages: contextPdfData.pages,
            asMain: localPathPdfAsMain,
          }
        : undefined,
      historySummary: (session?.summaryText || "").trim(),
      onStatus: (_stage, text) => showAgentStatus(body, text),
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
    assistant.content = result.answer.content || assistant.content;
    assistant.reasoning = result.answer.reasoning || assistant.reasoning;
    if (result.answer.usage) assistant.usage = result.answer.usage;
    ztoolkit.log(
      `[Agent] planned pages: ${result.plan.pages.join(",") || "none"}; loaded pages: ${result.usedPages.map((p) => p.pageNumber).join(",") || "none"}; reference pages: ${result.usedContextPages.map((p) => p.pageNumber).join(",") || "none"}`,
    );
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId, AGENT_CONTEXT_MODE);
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
      if (isSafeBody(body)) syncSessionSelector(body, itemId);
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

function buildHistoryForRequest(
  history: ChatMessage[],
  session: ChatSession | null,
): ChatMessage[] {
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
    const prompts = summarizeHistoryPrompt(
      session.summaryText || "",
      deltaMessages as any,
    );
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

  const fallback = buildFallbackSummary(
    session.summaryText || "",
    deltaMessages,
  );
  if (fallback) {
    chatStore.updateSessionSummary(itemId, fallback, summarizeUpToIndex);
  }
}

function buildFallbackSummary(
  previousSummary: string,
  deltaMessages: ChatMessage[],
): string {
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
    lines.push(
      `- ${role}: ${text.length > 180 ? `${text.slice(0, 180)}...` : text}`,
    );
  }

  const merged = lines.join("\n").trim();
  return merged.length > 3000 ? `${merged.slice(0, 3000)}...` : merged;
}

async function copyTextToClipboard(
  doc: Document,
  text: string,
): Promise<boolean> {
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
    const ta = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "textarea",
    ) as HTMLTextAreaElement;
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

type IconName =
  | "copy"
  | "delete"
  | "new"
  | "rename"
  | "clear"
  | "check"
  | "error"
  | "history"
  | "attach"
  | "attachPdf"
  | "edit"
  | "send";

function getIconSvg(icon: IconName): string {
  switch (icon) {
    case "attach":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M7.2 10.9l4.7-4.7a2.5 2.5 0 113.5 3.5l-5.8 5.8a4 4 0 11-5.7-5.7l5.8-5.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "attachPdf":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2.8h6.5l3.5 3.6v10.8a1.8 1.8 0 01-1.8 1.8H6a1.8 1.8 0 01-1.8-1.8V4.6A1.8 1.8 0 016 2.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12.5 2.9V6.4h3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.1 11.6h5.8M7.1 14.3h4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    case "history":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4.5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "edit":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.6a2.1 2.1 0 013 3L7.3 15.8l-4 1 1-4L13.6 3.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "send":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h13M10.5 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

function setIconButton(btn: HTMLButtonElement, icon: IconName, label: string) {
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
    const svgDoc = new win.DOMParser().parseFromString(
      svgMarkup,
      "image/svg+xml",
    );
    if (!svgDoc.querySelector("parsererror")) {
      el.appendChild(el.ownerDocument.adoptNode(svgDoc.documentElement));
      return;
    }
  } catch (_e) {
    /* fallback */
  }
  el.textContent = el.getAttribute("aria-label")?.charAt(0) || "?";
}

function createAssistantCopyButton(doc: Document): HTMLButtonElement {
  const btn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  btn.className = "zoteroagent-copy-button";
  setIconButton(btn, "copy", "Copy response");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const wrapper = (btn.closest(".zoteroagent-message.assistant") ||
      null) as HTMLElement | null;
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

function createMessageDeleteButton(
  doc: Document,
  body: HTMLElement,
  itemId: number,
): HTMLButtonElement {
  const btn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
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

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function formatTimestampHeader(ts: number): string {
  const d = new Date(ts);
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${MM}/${DD} ${HH}:${mm}`;
}

function messageTitleParts(msg: Pick<ChatMessage, "role" | "model">): string {
  if (msg.role === "user") return "You";
  const svc = getActiveService();
  const model = msg.model || svc?.model || "AI";
  const svcName = (svc?.name || "").trim();
  return svcName ? `${model} | ${svcName}` : model;
}

function avatarInitial(msg: Pick<ChatMessage, "role" | "model">): string {
  if (msg.role === "user") return "Y";
  const m = (msg.model || "AI").trim();
  const match = m.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "A";
}

function createMessageAvatar(
  doc: Document,
  msg: Pick<ChatMessage, "role" | "model">,
): HTMLElement {
  const el = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  el.className = `zoteroagent-msg-avatar ${msg.role === "user" ? "user" : "assistant"}`;
  el.setAttribute("aria-hidden", "true");
  const inner = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  inner.className = "zoteroagent-msg-avatar-inner";
  inner.textContent = avatarInitial(msg);
  el.appendChild(inner);
  return el;
}

function createMessageHeader(
  doc: Document,
  msg: Pick<ChatMessage, "role" | "model"> & { timestamp?: number },
): HTMLElement {
  const header = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  header.className = "zoteroagent-msg-header";
  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.className = "zoteroagent-msg-title";
  title.textContent = messageTitleParts(msg);
  header.appendChild(title);
  if (msg.timestamp) {
    const sub = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    sub.className = "zoteroagent-msg-subtime";
    sub.textContent = formatTimestampHeader(msg.timestamp);
    header.appendChild(sub);
  }
  return header;
}

function formatUsageLine(usage: TokenUsage): string {
  const total =
    usage.totalTokens ??
    (usage.promptTokens || 0) + (usage.completionTokens || 0);
  if (!total) return "";
  const inp = usage.promptTokens || 0;
  const out = usage.completionTokens || 0;
  return `Tokens: ${total} ↑${inp} ↓${out}`;
}

function buildUsageDisplayText(msg: ChatMessage): string {
  if (msg.role === "user") {
    const n = estimateTokens(msg.content || "");
    return `Tokens: ${n}`;
  }
  if (!(msg.content || "").trim() && !(msg.reasoning || "").trim()) {
    return "…";
  }
  const line = msg.usage ? formatUsageLine(msg.usage) : "";
  if (line) return line;
  const approx = estimateTokens(`${msg.content || ""}${msg.reasoning || ""}`);
  return approx > 0 ? `≈ Tokens: ${approx}` : "Tokens: —";
}

function createMessageMetaRow(
  doc: Document,
  msg: ChatMessage,
  body: HTMLElement,
  itemId: number,
): HTMLElement {
  const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  row.className = "zoteroagent-msg-meta-row";
  const usageEl = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  usageEl.className = "zoteroagent-msg-usage";
  usageEl.textContent = buildUsageDisplayText(msg);
  const actions = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  actions.className = "zoteroagent-message-actions";
  if (msg.role === "user") {
    actions.appendChild(createUserEditButton(doc, body, itemId));
  }
  if (msg.role === "assistant") {
    actions.appendChild(createAssistantCopyButton(doc));
  }
  actions.appendChild(createMessageDeleteButton(doc, body, itemId));
  row.appendChild(usageEl);
  row.appendChild(actions);
  return row;
}

function createUserEditButton(
  doc: Document,
  body: HTMLElement,
  itemId: number,
): HTMLButtonElement {
  const btn = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  btn.className = "zoteroagent-edit-button";
  setIconButton(btn, "edit", "Edit & resend");
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isGenerating) return;
    const wrapper = btn.closest(".zoteroagent-message") as HTMLElement | null;
    if (!wrapper) return;
    const idx = Number(wrapper.dataset.msgIndex);
    if (Number.isNaN(idx) || idx < 0) return;
    enterEditMode(wrapper, body, itemId, idx);
  });
  return btn;
}

function extractRawUserText(content: string): string {
  return parseUserContent(content).questionText || content;
}

function enterEditMode(
  wrapper: HTMLElement,
  body: HTMLElement,
  itemId: number,
  msgIndex: number,
) {
  if (wrapper.classList.contains("is-editing")) return;
  wrapper.classList.add("is-editing");

  const messages = chatStore.getMessages(itemId);
  const msg = messages[msgIndex];
  if (!msg || msg.role !== "user") return;

  const mainEl = wrapper.querySelector(
    ".zoteroagent-message-main",
  ) as HTMLElement | null;
  if (!mainEl) return;
  const contentEl = mainEl.querySelector(
    ".zoteroagent-message-content",
  ) as HTMLElement | null;
  const metaRow = mainEl.querySelector(
    ".zoteroagent-msg-meta-row",
  ) as HTMLElement | null;

  if (contentEl) contentEl.style.display = "none";
  if (metaRow) metaRow.style.display = "none";

  const doc = wrapper.ownerDocument;
  const editContainer = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  editContainer.className = "zoteroagent-edit-container";

  const textarea = doc.createElementNS(
    XHTML_NS,
    "textarea",
  ) as HTMLTextAreaElement;
  textarea.className = "zoteroagent-edit-textarea";
  textarea.value = extractRawUserText(msg.content);
  textarea.rows = 3;

  const btnRow = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  btnRow.className = "zoteroagent-edit-btn-row";

  const cancelBtn = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  cancelBtn.className = "zoteroagent-edit-cancel";
  cancelBtn.textContent = "Cancel";

  const submitBtn = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  submitBtn.className = "zoteroagent-edit-submit";
  submitBtn.textContent = "Send";

  cancelBtn.addEventListener("click", () => exitEditMode(wrapper));
  submitBtn.addEventListener("click", () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    exitEditMode(wrapper);
    commitEdit(body, itemId, msgIndex, newText);
  });

  textarea.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      exitEditMode(wrapper);
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const newText = textarea.value.trim();
      if (!newText) return;
      exitEditMode(wrapper);
      commitEdit(body, itemId, msgIndex, newText);
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  editContainer.appendChild(textarea);
  editContainer.appendChild(btnRow);
  mainEl.appendChild(editContainer);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function exitEditMode(wrapper: HTMLElement) {
  wrapper.classList.remove("is-editing");
  const mainEl = wrapper.querySelector(
    ".zoteroagent-message-main",
  ) as HTMLElement | null;
  if (!mainEl) return;
  const editContainer = mainEl.querySelector(".zoteroagent-edit-container");
  if (editContainer) editContainer.remove();
  const contentEl = mainEl.querySelector(
    ".zoteroagent-message-content",
  ) as HTMLElement | null;
  const metaRow = mainEl.querySelector(
    ".zoteroagent-msg-meta-row",
  ) as HTMLElement | null;
  if (contentEl) contentEl.style.display = "";
  if (metaRow) metaRow.style.display = "";
}

function commitEdit(
  body: HTMLElement,
  itemId: number,
  msgIndex: number,
  newContent: string,
) {
  chatStore.truncateMessagesFrom(itemId, msgIndex);

  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  if (input) {
    input.value = newContent;
  }

  renderMessages(body, itemId);
  void submitQuestion(body);
}

function updateStreamingMessage(
  body: HTMLElement,
  state: { content: string; reasoning: string },
) {
  try {
    if (!isSafeBody(body)) return;
    const container = body.querySelector(
      "#zoteroagent-chat-messages",
    ) as HTMLElement | null;
    if (!container) return;

    let msgWrapper = container.querySelector(
      ".zoteroagent-message.assistant:last-child",
    ) as HTMLElement | null;

    const itemId = Number(body.dataset.itemID) || 0;

    if (!msgWrapper) {
      const doc = body.ownerDocument;
      msgWrapper = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      msgWrapper.className = "zoteroagent-message assistant";

      const row = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      row.className = "zoteroagent-message-row";
      const avatar = createMessageAvatar(doc, {
        role: "assistant",
        model: getModelLabel(),
      });
      const main = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      main.className = "zoteroagent-message-main";
      const header = createMessageHeader(doc, {
        role: "assistant",
        model: getModelLabel(),
        timestamp: Date.now(),
      });
      main.appendChild(header);

      const inner = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      inner.className = "zoteroagent-message-content";
      main.appendChild(inner);

      const meta = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      ) as HTMLElement;
      meta.className = "zoteroagent-msg-meta-row";
      const usageEl = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      ) as HTMLElement;
      usageEl.className = "zoteroagent-msg-usage";
      usageEl.textContent = "…";
      const actions = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      actions.className = "zoteroagent-message-actions";
      actions.appendChild(createAssistantCopyButton(doc));
      if (itemId > 0) {
        actions.appendChild(createMessageDeleteButton(doc, body, itemId));
      }
      meta.appendChild(usageEl);
      meta.appendChild(actions);
      main.appendChild(meta);

      row.appendChild(avatar);
      row.appendChild(main);
      msgWrapper.appendChild(row);
      container.appendChild(msgWrapper);
    }

    const mainEl =
      (msgWrapper.querySelector(
        ".zoteroagent-message-main",
      ) as HTMLElement | null) || msgWrapper;

    if (state.reasoning) {
      let thinkBlock = msgWrapper.querySelector(
        ".zoteroagent-thinking",
      ) as HTMLElement | null;
      if (!thinkBlock) {
        const doc = body.ownerDocument;
        thinkBlock = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "details",
        ) as HTMLElement;
        thinkBlock.className = "zoteroagent-thinking";
        const summary = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "summary",
        );
        summary.className = "zoteroagent-thinking-summary";
        thinkBlock.appendChild(summary);
        const thinkContent = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "div",
        );
        thinkContent.className = "zoteroagent-thinking-content";
        thinkBlock.appendChild(thinkContent);
        const contentEl = mainEl.querySelector(".zoteroagent-message-content");
        if (contentEl) {
          mainEl.insertBefore(thinkBlock, contentEl);
        } else {
          mainEl.appendChild(thinkBlock);
        }
      }
      const summaryEl = thinkBlock.querySelector(
        ".zoteroagent-thinking-summary",
      );
      if (summaryEl) {
        const isThinking = !state.content;
        summaryEl.textContent = isThinking ? "Thinking..." : `Deeply thought`;
      }
      const thinkContentEl = thinkBlock.querySelector(
        ".zoteroagent-thinking-content",
      );
      if (thinkContentEl) thinkContentEl.textContent = state.reasoning;
    }

    const contentEl = mainEl.querySelector(
      ".zoteroagent-message-content",
    ) as HTMLElement;
    if (contentEl) {
      try {
        contentEl.innerHTML = renderMarkdown(state.content);
      } catch (_e) {
        contentEl.textContent = state.content;
      }
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
    if (!isSafeBody(body)) return;
    hideQuotePopup(body);
    const container = body.querySelector(
      "#zoteroagent-chat-messages",
    ) as HTMLElement | null;
    if (!container) return;
    const sessions = chatStore.getMessages(itemId);

    while (container.firstChild) {
      (container.firstChild as Element).remove();
    }

    const doc = body.ownerDocument;
    for (let i = 0; i < sessions.length; i++) {
      const msg = sessions[i];
      const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      wrapper.className = `zoteroagent-message ${msg.role === "user" ? "user" : "assistant"}`;
      wrapper.dataset.msgIndex = String(i);

      const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      row.className = "zoteroagent-message-row";

      const avatar = createMessageAvatar(doc, msg);
      const main = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
      main.className = "zoteroagent-message-main";

      main.appendChild(createMessageHeader(doc, msg));

      if (msg.role === "assistant") {
        if (msg.reasoning) {
          const thinkBlock = doc.createElementNS(
            XHTML_NS,
            "details",
          ) as HTMLElement;
          thinkBlock.className = "zoteroagent-thinking";
          const summary = doc.createElementNS(XHTML_NS, "summary");
          summary.className = "zoteroagent-thinking-summary";
          summary.textContent = "Deeply thought";
          thinkBlock.appendChild(summary);
          const thinkContent = doc.createElementNS(XHTML_NS, "div");
          thinkContent.className = "zoteroagent-thinking-content";
          thinkContent.textContent = msg.reasoning;
          thinkBlock.appendChild(thinkContent);
          main.appendChild(thinkBlock);
        }
        wrapper.dataset.rawContent = msg.content || "";
      }

      const inner = doc.createElementNS(XHTML_NS, "div");
      inner.className = "zoteroagent-message-content";

      if (msg.role === "assistant") {
        try {
          inner.innerHTML = renderMarkdown(msg.content);
        } catch (_e) {
          inner.textContent = msg.content;
        }
        bindAgentsMdLink(inner, body, itemId);
      } else {
        renderUserMessage(inner, msg);
      }

      main.appendChild(inner);

      if (msg.timestamp) {
        main.appendChild(createMessageMetaRow(doc, msg, body, itemId));
      }

      row.appendChild(avatar);
      row.appendChild(main);
      wrapper.appendChild(row);

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
    const input = body.querySelector(
      "#zoteroagent-chat-input",
    ) as HTMLTextAreaElement | null;
    if (input) {
      input.value = addon.data.chat.prefillInput;
      addon.data.chat.prefillInput = "";
    }
  }

  syncContextChips(body);

  if (
    addon.data.chat.referenceText ||
    addon.data.chat.responseQuote ||
    addon.data.chat.prefillInput
  ) {
    body.dataset.chatMode = "chat";
    const itemId = Number(body.dataset.itemID);
    if (itemId > 0) {
      syncLayoutState(body, itemId);
    }
    (
      body.querySelector(
        "#zoteroagent-chat-input",
      ) as HTMLTextAreaElement | null
    )?.focus();
  }
}

function parseQuotedPageContext(raw: string): {
  pageLabel: string;
  text: string;
} {
  const trimmed = String(raw || "");
  const match = trimmed.match(/^\[Quote\|page=([^\]]+)\]\n([\s\S]*)$/);
  if (!match) {
    return { pageLabel: "", text: trimmed };
  }
  return {
    pageLabel: String(match[1] || "").trim(),
    text: String(match[2] || "").trim(),
  };
}

function truncateContextPreview(text: string, max = 180): string {
  const trimmed = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function createContextChip(
  body: HTMLElement,
  kind: "text" | "response",
  rawText: string,
): HTMLElement {
  const doc = body.ownerDocument;
  const chip = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  chip.className = `zoteroagent-context-chip ${kind === "text" ? "text-context" : "response-quote"}`;

  const icon = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  icon.className = "zoteroagent-context-chip-icon";
  icon.textContent = kind === "text" ? "📋" : "💬";

  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-context-chip-label";

  let displayText = rawText;
  if (kind === "text") {
    const parsed = parseQuotedPageContext(rawText);
    displayText = parsed.text;
    label.textContent = "Text Context";
    if (parsed.pageLabel) {
      const meta = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      meta.className = "zoteroagent-context-chip-meta";
      meta.textContent = `p.${parsed.pageLabel}`;
      chip.appendChild(icon);
      chip.appendChild(label);
      chip.appendChild(meta);
    } else {
      chip.appendChild(icon);
      chip.appendChild(label);
    }
  } else {
    label.textContent = "Response Quote";
    chip.appendChild(icon);
    chip.appendChild(label);
  }

  const dismiss = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  dismiss.type = "button";
  dismiss.className = "zoteroagent-context-chip-dismiss";
  dismiss.textContent = "×";
  dismiss.title =
    kind === "text" ? "Remove text context" : "Remove response quote";
  dismiss.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "text") {
      addon.data.chat.referenceText = "";
    } else {
      addon.data.chat.responseQuote = "";
    }
    syncContextChips(body);
    hideQuotePopup(body);
  });
  chip.appendChild(dismiss);

  const content = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  content.className = "zoteroagent-context-chip-content";
  content.textContent = String(displayText || "").trim();
  chip.appendChild(content);

  return chip;
}

function syncContextChips(body: HTMLElement) {
  const wrap = body.querySelector(
    "#zoteroagent-context-chips",
  ) as HTMLElement | null;
  if (!wrap) return;
  while (wrap.firstChild) wrap.firstChild.remove();

  const refText = String(addon.data.chat.referenceText || "").trim();
  const responseQuote = String(addon.data.chat.responseQuote || "").trim();
  if (!refText && !responseQuote) {
    wrap.style.display = "none";
    return;
  }

  if (refText) wrap.appendChild(createContextChip(body, "text", refText));
  if (responseQuote)
    wrap.appendChild(createContextChip(body, "response", responseQuote));
  wrap.style.display = "flex";
}

function findAssistantBubbleFromNode(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === 1) {
      const element = current as Element;
      if (
        element.classList?.contains("zoteroagent-message") &&
        element.classList?.contains("assistant")
      ) {
        return element as HTMLElement;
      }
      const viaClosest = element.closest(".zoteroagent-message.assistant");
      if (viaClosest) return viaClosest as HTMLElement;
    }
    current = (current as any).parentNode || null;
  }
  return null;
}

function getAssistantSelection(
  body: HTMLElement,
): { text: string; rect: DOMRect } | null {
  const win = body.ownerDocument.defaultView;
  const selection = win?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  const startBubble = findAssistantBubbleFromNode(selection.anchorNode);
  const endBubble = findAssistantBubbleFromNode(selection.focusNode);
  if (!startBubble || !endBubble || startBubble !== endBubble) return null;
  const messages = body.querySelector("#zoteroagent-chat-messages");
  if (!messages || !messages.contains(startBubble)) return null;

  const text = String(selection.toString() || "").trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  let rect: DOMRect | null = null;
  try {
    const focusRange = body.ownerDocument.createRange();
    focusRange.setStart(
      selection.focusNode || range.endContainer,
      selection.focusOffset,
    );
    focusRange.collapse(true);
    const focusRect = focusRange.getBoundingClientRect();
    if (focusRect && (focusRect.width || focusRect.height)) {
      rect = focusRect;
    } else {
      const focusRects = Array.from(focusRange.getClientRects() || []);
      if (focusRects.length > 0) {
        rect = focusRects[focusRects.length - 1] as DOMRect;
      }
    }
  } catch {
    // fall back to range rect below
  }
  if (!rect) {
    rect = range.getBoundingClientRect();
    const allRects = Array.from(range.getClientRects() || []);
    if (!rect.width && !rect.height && allRects.length > 0) {
      rect = allRects[allRects.length - 1] as DOMRect;
    }
  }
  if (!rect || (!rect.width && !rect.height)) return null;
  return { text, rect };
}

function hideQuotePopup(body: HTMLElement) {
  const popup = body.querySelector(
    "#zoteroagent-quote-popup",
  ) as HTMLElement | null;
  if (!popup) return;
  popup.classList.remove("is-visible");
}

function showQuotePopup(body: HTMLElement, selectionRect: DOMRect) {
  const popup = body.querySelector(
    "#zoteroagent-quote-popup",
  ) as HTMLElement | null;
  const win = body.ownerDocument.defaultView;
  if (!popup || !win) return;

  popup.classList.add("is-visible");
  const popupWidth = popup.offsetWidth || 92;
  const popupHeight = popup.offsetHeight || 30;
  const margin = 8;
  let left = selectionRect.left + 6;
  let top = selectionRect.bottom + 6;
  const maxWidth = win.innerWidth || 0;
  const maxHeight = win.innerHeight || 0;
  if (left + popupWidth > maxWidth - margin) {
    left = maxWidth - popupWidth - margin;
  }
  if (left < margin) left = margin;
  if (top + popupHeight > maxHeight - margin) {
    top = selectionRect.top - popupHeight - 6;
  }
  if (top < margin) top = margin;
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function updateQuotePopupFromSelection(body: HTMLElement) {
  const selection = getAssistantSelection(body);
  if (!selection) {
    hideQuotePopup(body);
    return;
  }
  showQuotePopup(body, selection.rect);
}

function quoteSelectedAssistantText(body: HTMLElement) {
  const selection = getAssistantSelection(body);
  if (!selection) {
    hideQuotePopup(body);
    return;
  }
  addon.data.chat.responseQuote = selection.text;
  syncContextChips(body);
  hideQuotePopup(body);
  body.dataset.chatMode = "chat";
  const itemId = Number(body.dataset.itemID);
  if (itemId > 0) syncLayoutState(body, itemId);
  const win = body.ownerDocument.defaultView;
  win?.getSelection()?.removeAllRanges();
  (
    body.querySelector("#zoteroagent-chat-input") as HTMLTextAreaElement | null
  )?.focus();
}

function bindAssistantSelectionEvents(body: HTMLElement) {
  if (body.dataset.quoteSelectionBound === "1") return;
  body.dataset.quoteSelectionBound = "1";

  const messages = body.querySelector(
    "#zoteroagent-chat-messages",
  ) as HTMLElement | null;
  const popup = body.querySelector(
    "#zoteroagent-quote-popup",
  ) as HTMLButtonElement | null;
  const doc = body.ownerDocument;
  if (!messages || !popup) return;

  popup.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    quoteSelectedAssistantText(body);
  });

  const handleSelectionUpdate = () => {
    doc.defaultView?.setTimeout(() => {
      if (isSafeBody(body)) updateQuotePopupFromSelection(body);
    }, 0);
  };
  messages.addEventListener("mouseup", handleSelectionUpdate);
  doc.addEventListener("mouseup", handleSelectionUpdate, true);
  doc.addEventListener("keyup", handleSelectionUpdate, true);
  messages.addEventListener("scroll", () => {
    hideQuotePopup(body);
  });
  body.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest("#zoteroagent-quote-popup")) return;
      hideQuotePopup(body);
    },
    true,
  );
}

function syncServiceSelector(body: HTMLElement) {
  const svcSel = body.querySelector(
    "#zoteroagent-service-select",
  ) as HTMLSelectElement | null;
  if (svcSel) {
    populateServiceOptions(svcSel);
  }
}

function getItemTitle(itemId: number): string {
  try {
    const item = Zotero.Items.get(itemId) as any;
    return String(
      item?.getField?.("title") ||
        item?.getDisplayTitle?.() ||
        `Item ${itemId}`,
    );
  } catch (_e) {
    return `Item ${itemId}`;
  }
}

function syncSessionSelector(body: HTMLElement, itemId: number) {
  const select = body.querySelector(
    "#zoteroagent-session-select",
  ) as HTMLSelectElement | null;
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

  const titleEl = body.querySelector(
    "#zoteroagent-session-title",
  ) as HTMLElement | null;
  if (titleEl) {
    const activeSession = chatStore.getSession(itemId);
    titleEl.textContent = activeSession?.title || "New chat";
  }
}

function renderHistoryPanel(body: HTMLElement, itemId: number) {
  const panel = body.querySelector(
    "#zoteroagent-history-panel",
  ) as HTMLElement | null;
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
    const row = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    ) as HTMLElement;
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
      addon.data.chat.pendingContextPdf = null;
      renderMessages(body, itemId);
      syncSessionSelector(body, itemId);
      syncServiceSelector(body);
      syncLayoutState(body, itemId);
      refreshContextPdfChip(body);
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
  const sessionRow = body.querySelector(
    "#zoteroagent-session-row",
  ) as HTMLElement | null;
  const messages = body.querySelector(
    "#zoteroagent-chat-messages",
  ) as HTMLElement | null;
  const inputArea = body.querySelector(
    "#zoteroagent-input-area",
  ) as HTMLElement | null;
  if (!messages || !inputArea || !sessionRow) return;
  sessionRow.style.display = "flex";
  messages.style.display = "flex";
  messages.style.flexDirection = "column";
  inputArea.style.display = "flex";
}

function parseUserContent(content: string): {
  textContext: string;
  responseQuote: string;
  questionText: string;
} {
  let remaining = String(content || "");
  let textContext = "";
  let responseQuote = "";

  if (remaining.startsWith(SELECTED_TEXT_PREFIX)) {
    const rest = remaining.slice(SELECTED_TEXT_PREFIX.length);
    const splitAt = rest.indexOf("\n\n");
    if (splitAt >= 0) {
      textContext = rest.slice(0, splitAt).trim();
      remaining = rest.slice(splitAt + 2);
    } else {
      textContext = rest.trim();
      remaining = "";
    }
  }

  if (remaining.startsWith(RESPONSE_QUOTE_PREFIX)) {
    const rest = remaining.slice(RESPONSE_QUOTE_PREFIX.length);
    const splitAt = rest.indexOf("\n\n");
    if (splitAt >= 0) {
      responseQuote = rest.slice(0, splitAt).trim();
      remaining = rest.slice(splitAt + 2);
    } else {
      responseQuote = rest.trim();
      remaining = "";
    }
  } else if (!textContext && remaining.startsWith(SELECTED_TEXT_PREFIX)) {
    // Backward compatibility for old "Selected Text: ...\n\nquestion" format.
    const rest = remaining.slice(SELECTED_TEXT_PREFIX.length);
    const splitAt = rest.indexOf("\n\n");
    if (splitAt >= 0) {
      textContext = rest.slice(0, splitAt).trim();
      remaining = rest.slice(splitAt + 2);
    } else {
      textContext = rest.trim();
      remaining = "";
    }
  }

  return {
    textContext,
    responseQuote,
    questionText: remaining.trim(),
  };
}

function renderUserContextCard(
  doc: Document,
  kind: "text" | "response",
  rawText: string,
): HTMLElement | null {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const card = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  card.className =
    kind === "text"
      ? "zoteroagent-msg-reference"
      : "zoteroagent-msg-response-quote";

  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className =
    kind === "text"
      ? "zoteroagent-msg-ref-label"
      : "zoteroagent-msg-response-label";
  label.textContent = kind === "text" ? "Text Context" : "Response Quote";

  const textEl = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  textEl.className =
    kind === "text"
      ? "zoteroagent-msg-ref-text"
      : "zoteroagent-msg-response-text";
  if (kind === "text") {
    const parsed = parseQuotedPageContext(text);
    textEl.textContent = parsed.text || text;
    if (parsed.pageLabel) {
      const pageMeta = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      pageMeta.className = "zoteroagent-msg-ref-page";
      pageMeta.textContent = `page ${parsed.pageLabel}`;
      label.appendChild(pageMeta);
    }
  } else {
    textEl.textContent = text;
  }

  const fade = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  fade.className =
    kind === "text"
      ? "zoteroagent-msg-ref-fade"
      : "zoteroagent-msg-response-fade";

  card.appendChild(label);
  card.appendChild(textEl);
  card.appendChild(fade);
  card.addEventListener("click", () => {
    card.classList.toggle("is-expanded");
  });
  return card;
}

function renderUserReferencePdfCard(
  doc: Document,
  fileName: string,
  source?: "upload" | "library",
): HTMLElement | null {
  const safeName = String(fileName || "").trim();
  if (!safeName) return null;
  const card = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  const safeSource = source === "library" ? "library" : "upload";
  card.className = `zoteroagent-msg-reference-pdf source-${safeSource}`;
  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-msg-reference-pdf-label";
  label.textContent = safeSource === "library" ? "Library PDF" : "Reference PDF";
  const text = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  text.className = "zoteroagent-msg-reference-pdf-text";
  text.textContent = safeName;
  card.appendChild(label);
  card.appendChild(text);
  return card;
}

function renderUserMessage(container: HTMLElement, msg: ChatMessage) {
  const doc = container.ownerDocument;
  renderUserImages(container, msg.images || []);
  const refPdfCard = renderUserReferencePdfCard(
    doc,
    msg.contextPdfRef?.fileName || "",
    msg.contextPdfRef?.source,
  );
  if (refPdfCard) container.appendChild(refPdfCard);
  const parsed = parseUserContent(msg.content);

  if (parsed.textContext || parsed.responseQuote) {
    const textCard = renderUserContextCard(doc, "text", parsed.textContext);
    if (textCard) container.appendChild(textCard);
    const responseCard = renderUserContextCard(
      doc,
      "response",
      parsed.responseQuote,
    );
    if (responseCard) container.appendChild(responseCard);
    if (parsed.questionText) {
      const question = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      question.className = "zoteroagent-msg-question";
      question.textContent = parsed.questionText;
      container.appendChild(question);
    }
    return;
  }

  const quoteLines: string[] = [];
  const bodyLines: string[] = [];
  const lines = msg.content.split("\n");
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
    const img = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "img",
    ) as HTMLImageElement;
    img.src = dataUrl;
    img.alt = `Attached image ${index + 1}`;
    thumb.appendChild(img);
    thumb.addEventListener("click", () => {
      wrap.classList.toggle("is-expanded");
      thumb.classList.add("active");
      for (const el of Array.from(
        wrap.querySelectorAll(".zoteroagent-msg-image-thumb"),
      )) {
        const btn = el as HTMLElement;
        if (btn !== thumb) btn.classList.remove("active");
      }
    });
    wrap.appendChild(thumb);
  });
  container.appendChild(wrap);
}
