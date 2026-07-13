import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { estimateTokens } from "../utils/token-estimate";
import {
  buildCodexUsageTitle,
  formatCodexUsageLine,
} from "../utils/token-usage";
import {
  parsePageEvidenceText,
  type PageEvidenceRef,
} from "../services/page-evidence";
import { generateContextDigest } from "../services/context-digest";
import {
  PAPER_VALUE_TYPES,
  parseKnowledgeSurface,
  valueTypeDescription,
  valueTypeLabel,
  type PaperTier,
  type PaperValueType,
} from "../services/knowledge-surface";
import {
  evaluateKnowledgeSurface,
  isUnbuiltSkeleton,
} from "../services/knowledge-quality";
import { runPaperColdStart } from "../services/cold-start";
import {
  repairPaperKnowledge,
  transitionPaperTier,
} from "../services/knowledge-workflows";
import { analyzePaperCode } from "../services/code-analysis";
import {
  createOrUpdateTopicNote,
  listTopicNotes,
  parseTopicNote,
  readTopicNote,
} from "../services/topic-notes";
import {
  acceptRelationshipProposal,
  type RelationshipProposal,
} from "../services/relationship-proposals";
import { listPaperBacklinks } from "../services/paper-network";
import {
  parseScannedPdfWithCodex,
  renderPdfPage,
} from "../services/pdf-enrichment";
import {
  deleteLocalImage,
  resolveLocalImagePaths,
  saveLocalClipboardImage,
  type LocalImageRef,
} from "../services/local-images";
import { buildQuotedQuestion } from "../services/research-turn/prompt";
import { runResearchTurn } from "../services/research-turn/orchestrator";
import { type AgentStatusKind } from "../services/agent-status";
import {
  clearAgentStatus,
  isTokenCurrent,
  mountAgentStatusSlot,
  showBusyStatus,
  showNoticeStatus,
} from "./sidebar/agent-status-bar";
import {
  canJumpToPage,
  jumpToReaderPage,
  type PageJumpState,
} from "./page-jump";
import { getIconSvg, insertSvgMarkup, setIconButton } from "./sidebar/icons";
import { showUndoToast } from "./sidebar/feedback";
import { autoResizeTextarea } from "./sidebar/composer";
import {
  getCommandMenuItems,
  insertCommandTemplate,
} from "./sidebar/command-menu";
import type { ActionCardCommand } from "./sidebar/action-card";
import { isNearBottom, scrollToBottomIfPinned } from "./sidebar/scroll";
import {
  bindSessionControls,
  createSessionActionElements,
  syncSessionTitle,
} from "./sidebar/session-controls";
import {
  syncModelControls,
  updateModelSelectorTitle,
} from "./sidebar/model-controls";
import { renderContextDigestStatus as renderDigestStatus } from "./sidebar/context-digest-view";
import {
  createMessageAvatar,
  createMessageHeader,
  renderMessageList,
} from "./sidebar/message-list-view";
import {
  extractRawUserText,
  renderUserMessage as renderUserMessageView,
} from "./sidebar/user-message-view";
import {
  prepareCodeNotesMarkdown,
  filterEmptyMarkdownSections,
  prepareMemoryMarkdown,
  prepareNotesMarkdown,
} from "./sidebar/memory-markdown";
import type { ChatMessage, PaperContext, TokenUsage } from "../addon";
import { chatStore } from "../services/chat-store";
import {
  DefaultChatSendFlow,
  type ChatFlowSink,
  type ChatSubmission,
} from "../services/chat-actions/flow";
import { organizePaperNote } from "../services/chat-actions/note";
import {
  getZoteroPaperMeta,
  getZoteroPaperMetaByKey,
  mergeVaultPaperMetadata,
} from "../services/zotero-paper-metadata";
import {
  listVaultPapers,
  appendConversationTurn,
  readPaperCodeNotes,
  readPaperMemory,
  readPaperNotes,
  searchVaultMemory,
  PaperTextUnavailableError,
  acceptPaperKeyword,
  updatePaperValueTypes,
  type CodexReasoningEffort,
  type PaperVaultMeta,
  type RunningLineProcess,
  type VaultSearchHit,
} from "../services/codex";

let sectionPaneID: string | null = null;
let activeBody: HTMLElement | null = null;
let activeCodexProcess: RunningLineProcess | null = null;
let activeCodexOwner: { itemId: number; sessionId: string } | null = null;
let isGenerating = false;
let mentionRequestSeq = 0;
const resizeObserverMap = new WeakMap<HTMLElement, ResizeObserver>();
const pollTimerMap = new WeakMap<HTMLElement, number>();
const lastWidthMap = new WeakMap<HTMLElement, number>();
const chatSendFlowMap = new WeakMap<HTMLElement, DefaultChatSendFlow>();
let referenceSyncRetryTimer: number | null = null;
const SELECTED_TEXT_PREFIX = "Selected Text: ";
const RESPONSE_QUOTE_PREFIX = "Response Quote: ";

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
  body.dataset.itemID = String(itemId);
  addon.data.popup.currentReader = reader;
  chatStore.getSession(itemId);
  const steps: Array<() => void> = [
    () => renderMessages(body, itemId),
    () => syncLayoutState(body, itemId),
    () => syncPrefill(body),
    () => {
      if (body.dataset.chatMode === "memory") void renderMemoryBrowse(body);
    },
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
  if ((reader as any)?.itemID) return Number((reader as any).itemID);
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
          // The conversation is keyed by the PDF attachment item everywhere
          // else (applySectionData / updateSidebarPanels both resolve via the
          // reader's attachment). In a reader tab `item` here is the parent
          // regular item, so writing `item.id` directly keys the chat under a
          // different id. When switching papers frequently this makes the
          // stored conversation appear to vanish, because the pane then reads
          // messages from the wrong key. Resolve to the same attachment id to
          // keep a single, stable conversation key.
          const rawId = Number(item.id) || 0;
          const resolvedId = resolvePdfAttachmentItemId(rawId, null) || rawId;
          if (resolvedId > 0) body.dataset.itemID = String(resolvedId);
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
    if (activeCodexProcess) {
      activeCodexProcess.kill();
      activeCodexProcess = null;
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

const XHTML = "http://www.w3.org/1999/xhtml";
let memorySearchTimer: ReturnType<typeof setTimeout> | null = null;
const topicPaperSelection = new Set<string>();
const pendingRelationshipProposals = new Map<string, RelationshipProposal[]>();
const codeAnalysisNotices = new Map<string, string>();

function buildMemoryPanel(doc: Document): HTMLElement {
  const panel = doc.createElementNS(XHTML, "div") as HTMLElement;
  panel.id = "zoteroagent-memory-panel";
  panel.className = "zoteroagent-memory-panel";
  panel.style.display = "none";

  const toolbar = doc.createElementNS(XHTML, "div") as HTMLElement;
  toolbar.className = "zoteroagent-memory-toolbar";

  const search = doc.createElementNS(XHTML, "input") as HTMLInputElement;
  search.id = "zoteroagent-memory-search";
  search.type = "text";
  search.placeholder = "Search across all papers' memory...";
  search.className = "zoteroagent-memory-search";

  const refresh = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  refresh.id = "zoteroagent-memory-refresh";
  refresh.className = "zoteroagent-memory-refresh";
  setIconButton(refresh, "refresh", "Refresh");

  const sort = doc.createElementNS(XHTML, "select") as HTMLSelectElement;
  sort.id = "zoteroagent-memory-sort";
  sort.className = "zoteroagent-memory-sort";
  for (const [value, label] of [
    ["title", "Sort: Title"],
    ["rating", "Sort: Rating"],
  ]) {
    const option = doc.createElementNS(XHTML, "option") as HTMLOptionElement;
    option.value = value;
    option.textContent = label;
    sort.appendChild(option);
  }

  toolbar.appendChild(search);
  toolbar.appendChild(sort);
  toolbar.appendChild(refresh);

  const topicForm = doc.createElementNS(XHTML, "div") as HTMLElement;
  topicForm.id = "zoteroagent-topic-form";
  topicForm.className = "zoteroagent-topic-form";
  const topicTitle = doc.createElementNS(XHTML, "input") as HTMLInputElement;
  topicTitle.id = "zoteroagent-topic-title";
  topicTitle.type = "text";
  topicTitle.placeholder = "Topic title";
  topicTitle.className = "zoteroagent-topic-title";
  const topicCreate = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  topicCreate.id = "zoteroagent-topic-create";
  topicCreate.type = "button";
  topicCreate.textContent = "Create Topic";
  topicCreate.className = "zoteroagent-topic-create";
  const topicStatus = doc.createElementNS(XHTML, "span") as HTMLElement;
  topicStatus.id = "zoteroagent-topic-status";
  topicStatus.className = "zoteroagent-topic-status";
  topicForm.appendChild(topicTitle);
  topicForm.appendChild(topicCreate);
  topicForm.appendChild(topicStatus);

  const bodyDiv = doc.createElementNS(XHTML, "div") as HTMLElement;
  bodyDiv.id = "zoteroagent-memory-body";
  bodyDiv.className = "zoteroagent-memory-body";

  panel.appendChild(toolbar);
  panel.appendChild(topicForm);
  panel.appendChild(bodyDiv);
  return panel;
}

function switchChatView(
  body: HTMLElement,
  mode: "chat" | "memory",
  renderBrowse = true,
) {
  hideQuotePopup(body);
  body.dataset.chatMode = mode;
  const isMemory = mode === "memory";
  const setDisplay = (sel: string, value: string) => {
    const el = body.querySelector(sel) as HTMLElement | null;
    if (el) el.style.display = value;
  };
  if (isMemory) {
    setDisplay("#zoteroagent-chat-messages", "none");
    setDisplay("#zoteroagent-input-area", "none");
    setDisplay("#zoteroagent-session-row", "none");
    setDisplay("#zoteroagent-context-digest-bar", "none");
    setDisplay("#zoteroagent-memory-panel", "flex");
  } else {
    setDisplay("#zoteroagent-memory-panel", "none");
    // Restore the chat layout with explicit `flex`. The chat messages,
    // input area (对话栏) and session row default to `display: none` in the
    // stylesheet and are only shown via inline styles, so we must set them
    // back explicitly here instead of clearing the inline style.
    syncLayoutState(body, Number(body.dataset.itemID) || 0);
  }
  body
    .querySelector("#zoteroagent-view-chat")
    ?.classList.toggle("is-active", !isMemory);
  body
    .querySelector("#zoteroagent-view-memory")
    ?.classList.toggle("is-active", isMemory);
  if (isMemory && renderBrowse) void renderMemoryBrowse(body);
}

function getMemoryBodyEl(body: HTMLElement): HTMLElement | null {
  return body.querySelector("#zoteroagent-memory-body") as HTMLElement | null;
}

async function renderMemoryBrowse(body: HTMLElement) {
  hideQuotePopup(body);
  const host = getMemoryBodyEl(body);
  if (!host) return;
  const search = body.querySelector(
    "#zoteroagent-memory-search",
  ) as HTMLInputElement | null;
  if (search) search.value = "";
  host.textContent = "";
  const doc = host.ownerDocument;

  const currentItemId = Number(body.dataset.itemID);
  const currentKey =
    currentItemId > 0 ? getPaperMeta(currentItemId).itemKey : "";

  let papers: PaperVaultMeta[] = [];
  try {
    papers = await listVaultPapers();
    papers = papers.map((paper) =>
      mergeVaultPaperMetadata(paper, getZoteroPaperMetaByKey(paper.itemKey)),
    );
  } catch (error) {
    host.appendChild(
      memoryNotice(doc, `Failed to read vault: ${String(error)}`),
    );
    return;
  }
  const sortMode = (
    body.querySelector("#zoteroagent-memory-sort") as HTMLSelectElement | null
  )?.value;
  if (sortMode === "rating") {
    papers.sort(
      (a, b) =>
        Number(b.rating || 0) - Number(a.rating || 0) ||
        String(a.title || a.itemKey).localeCompare(
          String(b.title || b.itemKey),
        ),
    );
  }

  if (currentItemId > 0) {
    const currentMeta = getPaperMeta(currentItemId);
    const header = doc.createElementNS(XHTML, "div") as HTMLElement;
    header.className = "zoteroagent-memory-section-title";
    header.textContent = "Current paper";
    host.appendChild(header);
    await appendPaperMemoryCard(
      body,
      host,
      currentKey,
      currentMeta.title,
      currentMeta,
    );
  }

  try {
    const topics = await listTopicNotes();
    if (topics.length) {
      const topicTitle = doc.createElementNS(XHTML, "div") as HTMLElement;
      topicTitle.className = "zoteroagent-memory-section-title";
      topicTitle.textContent = `Topics (${topics.length})`;
      host.appendChild(topicTitle);
      const topicList = doc.createElementNS(XHTML, "div") as HTMLElement;
      topicList.className = "zoteroagent-memory-list";
      for (const topic of topics) {
        const row = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
        row.type = "button";
        row.className = "zoteroagent-memory-list-item";
        const title = doc.createElementNS(XHTML, "span") as HTMLElement;
        title.className = "zoteroagent-memory-list-title";
        title.textContent = topic.title;
        const sub = doc.createElementNS(XHTML, "span") as HTMLElement;
        sub.className = "zoteroagent-memory-list-sub";
        sub.textContent = `${topic.paperItemKeys.length} papers`;
        row.appendChild(title);
        row.appendChild(sub);
        row.addEventListener("click", () => {
          void renderTopicDetail(body, topic.slug);
        });
        topicList.appendChild(row);
      }
      host.appendChild(topicList);
    }
  } catch (error) {
    host.appendChild(
      memoryNotice(doc, `Failed to read Topic Notes: ${String(error)}`),
    );
  }

  const listTitle = doc.createElementNS(XHTML, "div") as HTMLElement;
  listTitle.className = "zoteroagent-memory-section-title";
  listTitle.textContent = `All papers (${papers.length})`;
  host.appendChild(listTitle);

  if (!papers.length) {
    host.appendChild(
      memoryNotice(
        doc,
        "No papers in the vault yet. Ask a question in Chat to let Codex build memory.",
      ),
    );
    return;
  }

  const list = doc.createElementNS(XHTML, "div") as HTMLElement;
  list.className = "zoteroagent-memory-list";
  for (const paper of papers) {
    const wrapper = doc.createElementNS(XHTML, "div") as HTMLElement;
    wrapper.className = "zoteroagent-memory-list-row";
    const select = doc.createElementNS(XHTML, "input") as HTMLInputElement;
    select.type = "checkbox";
    select.className = "zoteroagent-topic-paper-select";
    select.checked = topicPaperSelection.has(paper.itemKey);
    select.title = `Include ${paper.title || paper.itemKey} in Topic Note`;
    select.setAttribute("aria-label", select.title);
    select.addEventListener("change", () => {
      if (select.checked) topicPaperSelection.add(paper.itemKey);
      else topicPaperSelection.delete(paper.itemKey);
      updateTopicSelectionStatus(body);
    });
    const row = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    row.type = "button";
    row.className = "zoteroagent-memory-list-item";
    if (paper.itemKey === currentKey) row.classList.add("is-current");
    const title = doc.createElementNS(XHTML, "span") as HTMLElement;
    title.className = "zoteroagent-memory-list-title";
    title.textContent = paper.title || paper.itemKey;
    const sub = doc.createElementNS(XHTML, "span") as HTMLElement;
    sub.className = "zoteroagent-memory-list-sub";
    sub.textContent = [
      paper.rating ? `${paper.rating}/5` : "",
      paper.creators,
      paper.year,
    ]
      .filter(Boolean)
      .join(" · ");
    row.appendChild(title);
    if (sub.textContent) row.appendChild(sub);
    row.addEventListener("click", () => {
      void renderMemoryDetail(
        body,
        paper.itemKey,
        paper.title || paper.itemKey,
      );
    });
    wrapper.appendChild(select);
    wrapper.appendChild(row);
    list.appendChild(wrapper);
  }
  host.appendChild(list);
  updateTopicSelectionStatus(body);
}

async function appendPaperMemoryCard(
  body: HTMLElement,
  host: HTMLElement,
  itemKey: string,
  title: string,
  paper?: PaperVaultMeta,
) {
  const doc = host.ownerDocument;
  const card = doc.createElementNS(XHTML, "div") as HTMLElement;
  card.className = "zoteroagent-memory-card";
  const content = await readPaperMemory(itemKey);
  const codeNotes = await readPaperCodeNotes(itemKey);
  const surface = parseKnowledgeSurface(content);
  let quality: ReturnType<typeof evaluateKnowledgeSurface> | null = null;
  if (paper) {
    card.appendChild(buildPaperSignalBar(body, host, paper, surface.signals));
    quality = evaluateKnowledgeSurface({
      after: content,
      sourceAbstract: paper.abstract,
      itemKey: paper.itemKey,
      codeNotes,
    });
    if (quality.status !== "passed") {
      card.appendChild(buildColdStartAction(body, paper, quality));
    }
    card.appendChild(buildCodeAnalysisAction(body, paper));
    const proposals = pendingRelationshipProposals.get(paper.itemKey) || [];
    if (proposals.length) {
      card.appendChild(buildRelationshipProposalReview(body, paper, proposals));
    }
  }
  const inner = doc.createElementNS(XHTML, "div") as HTMLElement;
  inner.className = "zoteroagent-memory-content markdown-body";
  if (surface.body.trim()) {
    inner.innerHTML = renderMarkdown(prepareMemoryMarkdown(surface.body));
  } else {
    inner.appendChild(
      memoryNotice(
        doc,
        `No memory yet for "${title}". Ask about it in Chat and Codex will write one.`,
      ),
    );
  }
  card.appendChild(inner);
  const notes = await readPaperNotes(itemKey);
  if (notes.trim()) {
    const notesHeading = doc.createElementNS(XHTML, "div") as HTMLElement;
    notesHeading.className = "zoteroagent-memory-section-title";
    notesHeading.id = "zoteroagent-memory-reader-thinking";
    notesHeading.textContent = "Reader Thinking";
    const notesContent = doc.createElementNS(XHTML, "div") as HTMLElement;
    notesContent.className = "zoteroagent-memory-content markdown-body";
    notesContent.innerHTML = renderMarkdown(prepareNotesMarkdown(notes));
    card.appendChild(notesHeading);
    card.appendChild(notesContent);
  }
  if (codeNotes.trim()) {
    const codeHeading = doc.createElementNS(XHTML, "div") as HTMLElement;
    codeHeading.className = "zoteroagent-memory-section-title";
    codeHeading.textContent = "Code Analysis";
    const codeContent = doc.createElementNS(XHTML, "div") as HTMLElement;
    codeContent.className = "zoteroagent-memory-content markdown-body";
    codeContent.innerHTML = renderMarkdown(prepareCodeNotesMarkdown(codeNotes));
    card.appendChild(codeHeading);
    card.appendChild(codeContent);
  }
  const backlinks = await listPaperBacklinks(itemKey);
  if (backlinks.length) {
    const backlinkHeading = doc.createElementNS(XHTML, "div") as HTMLElement;
    backlinkHeading.className = "zoteroagent-memory-section-title";
    backlinkHeading.textContent = `Linked from (${backlinks.length})`;
    const backlinkList = doc.createElementNS(XHTML, "div") as HTMLElement;
    backlinkList.className = "zoteroagent-backlink-list";
    for (const backlink of backlinks) {
      const row = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
      row.type = "button";
      row.className = "zoteroagent-memory-list-item";
      row.textContent = `[${backlink.relationship.type}] ${
        backlink.source.title || backlink.source.itemKey
      }: ${backlink.relationship.rationale}`;
      row.addEventListener("click", () => {
        void renderMemoryDetail(
          body,
          backlink.source.itemKey,
          backlink.source.title || backlink.source.itemKey,
        );
      });
      backlinkList.appendChild(row);
    }
    card.appendChild(backlinkHeading);
    card.appendChild(backlinkList);
  }
  host.appendChild(card);
}

function buildColdStartAction(
  body: HTMLElement,
  paper: PaperVaultMeta,
  quality: ReturnType<typeof evaluateKnowledgeSurface>,
): HTMLElement {
  const doc = body.ownerDocument;
  const row = doc.createElementNS(XHTML, "div") as HTMLElement;
  row.className = "zoteroagent-cold-start";
  const status = doc.createElementNS(XHTML, "span") as HTMLElement;
  status.className = "zoteroagent-cold-start-status";
  status.textContent =
    quality.status === "failed"
      ? "Knowledge Record needs repair."
      : "Knowledge Record has review items.";
  const button = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  button.className = "zoteroagent-cold-start-action";
  button.type = "button";
  const hasExistingKnowledge = !isUnbuiltSkeleton(quality);
  button.dataset.action = hasExistingKnowledge ? "repair" : "build";
  button.textContent = hasExistingKnowledge
    ? "Repair Knowledge Record"
    : "Build Knowledge Record";
  button.addEventListener("click", () => {
    if (body.dataset.coldStartBusy === "true") {
      abortGeneration(body);
      delete body.dataset.coldStartBusy;
      button.textContent =
        button.dataset.action === "repair"
          ? "Repair Knowledge Record"
          : "Build Knowledge Record";
      status.textContent = "Initialization cancelled.";
      return;
    }
    if (button.dataset.action === "enrich-pdf") {
      void startPdfEnrichment(body, paper, button, status);
    } else if (button.dataset.action === "repair") {
      void startPaperRepair(body, paper, quality, button, status);
    } else {
      void startPaperColdStart(body, paper, button, status);
    }
  });
  row.appendChild(status);
  row.appendChild(button);
  return row;
}

async function startPaperColdStart(
  body: HTMLElement,
  paper: PaperVaultMeta,
  button: HTMLButtonElement,
  status: HTMLElement,
) {
  if (isGenerating || body.dataset.coldStartBusy === "true") return;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(paper.itemId, reader);
  if (pdfItemId <= 0) {
    status.textContent = "No accessible PDF attachment.";
    return;
  }
  body.dataset.coldStartBusy = "true";
  button.textContent = "Cancel";
  setGenerating(body, true);
  const session = chatStore.getSession(paper.itemId);
  const model = session?.modelSlug || "";
  try {
    const result = await runPaperColdStart(
      {
        paper,
        pdfItemId,
        model,
        reasoningEffort: session?.reasoningEffort,
        linkRelationships: true,
      },
      {
        onStatus: (text) => {
          if (isSafeBody(body)) status.textContent = text;
        },
        onProcess: (process) => {
          activeCodexProcess = process;
        },
      },
    );
    status.textContent =
      result.quality.status === "passed"
        ? "Knowledge Record built."
        : "Knowledge Record built with review items.";
    if (result.relationshipProposals.length) {
      pendingRelationshipProposals.set(
        paper.itemKey,
        result.relationshipProposals,
      );
      status.textContent += ` ${result.relationshipProposals.length} relationship suggestion(s) need review.`;
    }
  } catch (error) {
    if (error instanceof PaperTextUnavailableError) {
      button.dataset.action = "enrich-pdf";
      button.textContent = "Parse PDF with Codex";
      status.textContent =
        "This PDF has no readable text layer. Codex enrichment is opt-in.";
      return;
    }
    status.textContent = `Initialization failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    delete body.dataset.coldStartBusy;
    setGenerating(body, false);
  }
  if (isSafeBody(body)) void renderMemoryBrowse(body);
}

async function startPaperRepair(
  body: HTMLElement,
  paper: PaperVaultMeta,
  quality: ReturnType<typeof evaluateKnowledgeSurface>,
  button: HTMLButtonElement,
  status: HTMLElement,
) {
  if (isGenerating || body.dataset.coldStartBusy === "true") return;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(paper.itemId, reader);
  if (pdfItemId <= 0) {
    status.textContent = "No accessible PDF attachment.";
    return;
  }
  body.dataset.coldStartBusy = "true";
  button.textContent = "Cancel";
  setGenerating(body, true);
  const session = chatStore.getSession(paper.itemId);
  try {
    const result = await repairPaperKnowledge({
      paper,
      pdfItemId,
      quality,
      model: session?.modelSlug,
      reasoningEffort: session?.reasoningEffort,
      onStatus: (text) => {
        if (isSafeBody(body)) status.textContent = text;
      },
      onProcess: (process) => {
        activeCodexProcess = process;
      },
    });
    status.textContent =
      result.quality.status === "passed"
        ? "Knowledge Record repaired."
        : "Repair completed with remaining review items.";
  } catch (error) {
    status.textContent = `Repair failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    delete body.dataset.coldStartBusy;
    setGenerating(body, false);
  }
  if (isSafeBody(body)) void renderMemoryBrowse(body);
}

async function startPdfEnrichment(
  body: HTMLElement,
  paper: PaperVaultMeta,
  button: HTMLButtonElement,
  status: HTMLElement,
) {
  if (isGenerating || body.dataset.coldStartBusy === "true") return;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(paper.itemId, reader);
  const pdfItem = pdfItemId > 0 ? (Zotero.Items.get(pdfItemId) as any) : null;
  const pdfPath = String(pdfItem?.getFilePath?.() || "");
  if (!pdfPath) {
    status.textContent = "Could not resolve the local PDF path.";
    return;
  }
  body.dataset.coldStartBusy = "true";
  button.textContent = "Cancel";
  setGenerating(body, true);
  const model = chatStore.getSession(paper.itemId)?.modelSlug || "";
  let parsed = false;
  try {
    await parseScannedPdfWithCodex({
      paper,
      pdfPath,
      model,
      onStatus: (text) => {
        if (isSafeBody(body)) status.textContent = text;
      },
      onProcess: (process) => {
        activeCodexProcess = process;
      },
    });
    parsed = true;
  } catch (error) {
    status.textContent = `PDF parsing failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    delete body.dataset.coldStartBusy;
    setGenerating(body, false);
  }
  if (!parsed || !isSafeBody(body)) return;
  button.dataset.action = "build";
  await startPaperColdStart(body, paper, button, status);
}

function buildPaperSignalBar(
  body: HTMLElement,
  host: HTMLElement,
  paper: PaperVaultMeta,
  signals: ReturnType<typeof parseKnowledgeSurface>["signals"],
): HTMLElement {
  const doc = host.ownerDocument;
  const bar = doc.createElementNS(XHTML, "div") as HTMLElement;
  bar.className = "zoteroagent-paper-signals";
  const label = doc.createElementNS(XHTML, "span") as HTMLElement;
  label.className = "zoteroagent-paper-signals-label";
  label.textContent = "Rating";
  bar.appendChild(label);
  const rating = doc.createElementNS(XHTML, "span") as HTMLElement;
  rating.className = "zoteroagent-rating-value";
  rating.textContent = signals.rating
    ? `${"\u2605".repeat(signals.rating)}${"\u2606".repeat(5 - signals.rating)}`
    : "Unrated";
  rating.setAttribute(
    "aria-label",
    signals.rating ? `${signals.rating} of 5` : "Unrated",
  );
  bar.appendChild(rating);
  const tierLabel = doc.createElementNS(XHTML, "span") as HTMLElement;
  tierLabel.className = "zoteroagent-paper-signals-label";
  tierLabel.textContent = "Depth";
  bar.appendChild(tierLabel);
  const tier = doc.createElementNS(XHTML, "span") as HTMLElement;
  tier.className = "zoteroagent-paper-tier-value";
  tier.textContent = signals.tier;
  tier.title = "L0 card, L1 skim, L2 close reading, L3 code/reproduction";
  bar.appendChild(tier);
  for (const valueType of PAPER_VALUE_TYPES) {
    const button = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    button.type = "button";
    button.className = "zoteroagent-value-type";
    button.classList.toggle(
      "is-active",
      signals.valueTypes.includes(valueType),
    );
    button.textContent = valueTypeLabel(valueType);
    button.title = valueTypeDescription(valueType);
    button.addEventListener("click", () => {
      const next = signals.valueTypes.includes(valueType)
        ? signals.valueTypes.filter((entry) => entry !== valueType)
        : [...signals.valueTypes, valueType];
      void updatePaperValueTypes(paper, next).then(() => {
        if (isSafeBody(body)) void renderMemoryBrowse(body);
      });
    });
    bar.appendChild(button);
  }
  for (const collection of signals.zoteroCollections.slice(0, 2)) {
    const chip = doc.createElementNS(XHTML, "span") as HTMLElement;
    chip.className = "zoteroagent-paper-signal-chip";
    chip.textContent = collection.name;
    chip.title = collection.path;
    bar.appendChild(chip);
  }
  for (const tag of signals.zoteroTags.slice(0, 3)) {
    const chip = doc.createElementNS(XHTML, "span") as HTMLElement;
    chip.className = "zoteroagent-paper-signal-chip is-tag";
    chip.textContent = tag;
    bar.appendChild(chip);
  }
  return bar;
}

function buildCodeAnalysisAction(
  body: HTMLElement,
  paper: PaperVaultMeta,
): HTMLElement {
  const doc = body.ownerDocument;
  const wrap = doc.createElementNS(XHTML, "div") as HTMLElement;
  wrap.className = "zoteroagent-code-analysis";
  const input = doc.createElementNS(XHTML, "input") as HTMLInputElement;
  input.type = "url";
  input.placeholder = "https://github.com/owner/repository";
  input.className = "zoteroagent-code-repository";
  input.setAttribute("aria-label", "GitHub repository URL");
  const button = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  button.type = "button";
  button.className = "zoteroagent-cold-start-action";
  button.textContent = "Analyze code";
  const status = doc.createElementNS(XHTML, "span") as HTMLElement;
  status.className = "zoteroagent-cold-start-status";
  status.textContent = codeAnalysisNotices.get(paper.itemKey) || "";
  button.addEventListener("click", () => {
    void startCodeAnalysis(body, paper, input, button, status);
  });
  wrap.appendChild(input);
  wrap.appendChild(button);
  wrap.appendChild(status);
  return wrap;
}

async function startCodeAnalysis(
  body: HTMLElement,
  paper: PaperVaultMeta,
  input: HTMLInputElement,
  button: HTMLButtonElement,
  status: HTMLElement,
) {
  if (isGenerating) return;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(paper.itemId, reader);
  if (pdfItemId <= 0) {
    status.textContent = "No accessible PDF attachment.";
    return;
  }
  const repositoryUrl = input.value.trim();
  if (!repositoryUrl) {
    status.textContent = "Enter a GitHub repository URL.";
    return;
  }
  setGenerating(body, true);
  input.disabled = true;
  button.disabled = true;
  const session = chatStore.getSession(paper.itemId);
  try {
    const result = await analyzePaperCode(
      {
        paper,
        pdfItemId,
        repositoryUrl,
        model: session?.modelSlug,
        reasoningEffort: session?.reasoningEffort,
      },
      {
        onStatus: (text) => {
          status.textContent = text;
        },
        onProcess: (process) => {
          activeCodexProcess = process;
        },
      },
    );
    const notice = result.repositoryModified
      ? "Analysis saved. The local checkout was modified; review it before updating."
      : `Analyzed ${result.repository.owner}/${result.repository.repository} at ${result.commit.slice(
          0,
          8,
        )}.`;
    codeAnalysisNotices.set(paper.itemKey, notice);
    status.textContent = notice;
  } catch (error) {
    const notice = `Code analysis failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    codeAnalysisNotices.set(paper.itemKey, notice);
    status.textContent = notice;
  } finally {
    input.disabled = false;
    button.disabled = false;
    setGenerating(body, false);
  }
  if (isSafeBody(body)) void renderMemoryBrowse(body);
}

function buildRelationshipProposalReview(
  body: HTMLElement,
  paper: PaperVaultMeta,
  proposals: RelationshipProposal[],
): HTMLElement {
  const doc = body.ownerDocument;
  const block = doc.createElementNS(XHTML, "div") as HTMLElement;
  block.className = "zoteroagent-relationship-proposals";
  const label = doc.createElementNS(XHTML, "div") as HTMLElement;
  label.className = "zoteroagent-paper-signals-label";
  label.textContent = "Suggested relationships";
  block.appendChild(label);
  for (const proposal of proposals) {
    const row = doc.createElementNS(XHTML, "div") as HTMLElement;
    row.className = "zoteroagent-relationship-proposal";
    const text = doc.createElementNS(XHTML, "span") as HTMLElement;
    text.textContent = `[${proposal.type}] ${proposal.title}: ${proposal.rationale}`;
    const accept = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    accept.type = "button";
    accept.textContent = "Accept";
    accept.addEventListener("click", () => {
      void acceptRelationshipProposal({ paper, proposal }).then(() => {
        removePendingRelationshipProposal(paper.itemKey, proposal);
        if (isSafeBody(body)) void renderMemoryBrowse(body);
      });
    });
    const dismiss = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      removePendingRelationshipProposal(paper.itemKey, proposal);
      if (isSafeBody(body)) void renderMemoryBrowse(body);
    });
    row.appendChild(text);
    row.appendChild(accept);
    row.appendChild(dismiss);
    block.appendChild(row);
  }
  return block;
}

function removePendingRelationshipProposal(
  itemKey: string,
  proposal: RelationshipProposal,
) {
  const remaining = (pendingRelationshipProposals.get(itemKey) || []).filter(
    (entry) =>
      !(
        entry.type === proposal.type &&
        entry.targetItemKey === proposal.targetItemKey &&
        entry.rationale === proposal.rationale
      ),
  );
  if (remaining.length) pendingRelationshipProposals.set(itemKey, remaining);
  else pendingRelationshipProposals.delete(itemKey);
}

async function renderMemoryDetail(
  body: HTMLElement,
  itemKey: string,
  title: string,
) {
  const host = getMemoryBodyEl(body);
  if (!host) return;
  host.textContent = "";
  const doc = host.ownerDocument;

  const back = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  back.className = "zoteroagent-memory-back";
  back.textContent = "\u2190 All papers";
  back.addEventListener("click", () => void renderMemoryBrowse(body));
  host.appendChild(back);

  const heading = doc.createElementNS(XHTML, "div") as HTMLElement;
  heading.className = "zoteroagent-memory-section-title";
  heading.textContent = title;
  host.appendChild(heading);

  const currentItemId = Number(body.dataset.itemID);
  const currentMeta =
    currentItemId > 0 && getPaperMeta(currentItemId).itemKey === itemKey
      ? getPaperMeta(currentItemId)
      : undefined;
  await appendPaperMemoryCard(body, host, itemKey, title, currentMeta);
}

function updateTopicSelectionStatus(body: HTMLElement) {
  const status = body.querySelector(
    "#zoteroagent-topic-status",
  ) as HTMLElement | null;
  const button = body.querySelector(
    "#zoteroagent-topic-create",
  ) as HTMLButtonElement | null;
  if (status) {
    status.textContent = topicPaperSelection.size
      ? `${topicPaperSelection.size} selected`
      : "Select papers below";
  }
  if (button) button.disabled = topicPaperSelection.size < 2 || isGenerating;
}

async function startTopicNoteCreation(body: HTMLElement) {
  if (isGenerating || topicPaperSelection.size < 2) return;
  const input = body.querySelector(
    "#zoteroagent-topic-title",
  ) as HTMLInputElement | null;
  const status = body.querySelector(
    "#zoteroagent-topic-status",
  ) as HTMLElement | null;
  const button = body.querySelector(
    "#zoteroagent-topic-create",
  ) as HTMLButtonElement | null;
  const title = String(input?.value || "").trim();
  if (!title) {
    if (status) status.textContent = "Enter a topic title.";
    input?.focus();
    return;
  }
  const currentItemId = Number(body.dataset.itemID) || 0;
  const session =
    currentItemId > 0 ? chatStore.getSession(currentItemId) : null;
  setGenerating(body, true);
  if (input) input.disabled = true;
  if (button) button.disabled = true;
  let finalStatus = "";
  try {
    const result = await createOrUpdateTopicNote({
      title,
      paperItemKeys: Array.from(topicPaperSelection),
      model: session?.modelSlug,
      reasoningEffort: session?.reasoningEffort,
      onStatus: (text) => {
        if (status) status.textContent = text;
      },
      onProcess: (process) => {
        activeCodexProcess = process;
      },
    });
    finalStatus = `Saved ${result.topic.title} from ${result.topic.paperItemKeys.length} papers.`;
    topicPaperSelection.clear();
    if (input) input.value = "";
  } catch (error) {
    finalStatus = `Topic creation failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    if (input) input.disabled = false;
    if (button) button.disabled = false;
    setGenerating(body, false);
    if (status) status.textContent = finalStatus;
  }
  if (isSafeBody(body)) void renderMemoryBrowse(body);
}

async function renderTopicDetail(body: HTMLElement, slug: string) {
  const host = getMemoryBodyEl(body);
  if (!host) return;
  host.textContent = "";
  const doc = host.ownerDocument;
  const back = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  back.className = "zoteroagent-memory-back";
  back.textContent = "\u2190 All papers and topics";
  back.addEventListener("click", () => void renderMemoryBrowse(body));
  host.appendChild(back);
  const markdown = await readTopicNote(slug);
  const topic = parseTopicNote(markdown);
  const heading = doc.createElementNS(XHTML, "div") as HTMLElement;
  heading.className = "zoteroagent-memory-section-title";
  heading.textContent = `${topic.meta.title} (${topic.meta.paperItemKeys.length} papers)`;
  host.appendChild(heading);
  const card = doc.createElementNS(XHTML, "div") as HTMLElement;
  card.className = "zoteroagent-memory-card";
  const content = doc.createElementNS(XHTML, "div") as HTMLElement;
  content.className = "zoteroagent-memory-content markdown-body";
  content.innerHTML = renderMarkdown(filterEmptyMarkdownSections(topic.body));
  card.appendChild(content);
  host.appendChild(card);
}

function scheduleMemorySearch(body: HTMLElement, query: string) {
  if (memorySearchTimer) clearTimeout(memorySearchTimer);
  const trimmed = query.trim();
  if (!trimmed) {
    void renderMemoryBrowse(body);
    return;
  }
  memorySearchTimer = setTimeout(() => {
    void runMemorySearch(body, trimmed);
  }, 220);
}

async function runMemorySearch(body: HTMLElement, query: string) {
  const host = getMemoryBodyEl(body);
  if (!host) return;
  host.textContent = "";
  const doc = host.ownerDocument;
  let hits: VaultSearchHit[] = [];
  try {
    hits = await searchVaultMemory(query);
  } catch (error) {
    host.appendChild(memoryNotice(doc, `Search failed: ${String(error)}`));
    return;
  }
  const title = doc.createElementNS(XHTML, "div") as HTMLElement;
  title.className = "zoteroagent-memory-section-title";
  title.textContent = `${hits.length} paper(s) match "${query}"`;
  host.appendChild(title);

  if (!hits.length) {
    host.appendChild(memoryNotice(doc, "No matches."));
    return;
  }

  const list = doc.createElementNS(XHTML, "div") as HTMLElement;
  list.className = "zoteroagent-memory-list";
  for (const hit of hits) {
    const row = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    row.className = "zoteroagent-memory-list-item";
    const t = doc.createElementNS(XHTML, "span") as HTMLElement;
    t.className = "zoteroagent-memory-list-title";
    t.textContent = hit.title || hit.itemKey;
    row.appendChild(t);
    for (const m of hit.matches.slice(0, 3)) {
      const snippet = doc.createElementNS(XHTML, "span") as HTMLElement;
      snippet.className = "zoteroagent-memory-snippet";
      snippet.textContent = highlightSnippet(m.text, query);
      row.appendChild(snippet);
    }
    row.addEventListener("click", () => {
      void renderMemoryDetail(body, hit.itemKey, hit.title || hit.itemKey);
    });
    list.appendChild(row);
  }
  host.appendChild(list);
}

function highlightSnippet(text: string, query: string): string {
  const clean = text.replace(/^#+\s*/, "").trim();
  if (clean.length <= 160) return clean;
  const idx = clean.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return `${clean.slice(0, 157)}...`;
  const start = Math.max(0, idx - 40);
  return `${start > 0 ? "..." : ""}${clean.slice(start, start + 157)}...`;
}

function memoryNotice(doc: Document, text: string): HTMLElement {
  const el = doc.createElementNS(XHTML, "div") as HTMLElement;
  el.className = "zoteroagent-memory-notice";
  el.textContent = text;
  return el;
}

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

  const {
    menuToggle: sessionMenuBtn,
    menu: sessionMenu,
    deleteConfirm: sessionDeleteConfirm,
  } = createSessionActionElements(doc);

  const historyPanel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  historyPanel.id = "zoteroagent-history-panel";
  historyPanel.className = "zoteroagent-history-panel";
  historyPanel.style.display = "none";

  sessionRow.appendChild(sessionTitle);
  sessionRow.appendChild(newSessionBtn);
  sessionRow.appendChild(historyBtn);
  sessionRow.appendChild(sessionMenuBtn);

  const contextDigestBar = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  contextDigestBar.id = "zoteroagent-context-digest-bar";
  contextDigestBar.className = "zoteroagent-context-digest-bar";
  contextDigestBar.style.display = "none";

  const inputArea = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  inputArea.id = "zoteroagent-input-area";
  inputArea.className = "zoteroagent-input-area";

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
  textarea.rows = 1;
  textarea.placeholder = "Ask about this paper...";

  const contextChips = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  contextChips.id = "zoteroagent-context-chips";
  contextChips.className = "zoteroagent-context-chips";

  const mentionPanel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  mentionPanel.id = "zoteroagent-mention-panel";
  mentionPanel.className = "zoteroagent-mention-panel";
  mentionPanel.style.display = "none";

  const commandPanel = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  commandPanel.id = "zoteroagent-command-panel";
  commandPanel.className = "zoteroagent-command-panel";
  commandPanel.style.display = "none";

  const actionsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsRow.id = "zoteroagent-actions-row";
  actionsRow.className = "zoteroagent-actions-row";

  const modelSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  modelSelect.id = "zoteroagent-model-select";
  modelSelect.className = "zoteroagent-model-select";
  modelSelect.title = "Model for this chat";
  const defaultModelOption = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "option",
  ) as HTMLOptionElement;
  defaultModelOption.value = "";
  defaultModelOption.textContent = "Codex default";
  modelSelect.appendChild(defaultModelOption);

  const reasoningSelect = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "select",
  ) as HTMLSelectElement;
  reasoningSelect.id = "zoteroagent-reasoning-select";
  reasoningSelect.className = "zoteroagent-reasoning-select";
  reasoningSelect.title = "Thinking intensity for this chat";
  const defaultReasoningOption = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "option",
  ) as HTMLOptionElement;
  defaultReasoningOption.value = "";
  defaultReasoningOption.textContent = "Thinking default";
  reasoningSelect.appendChild(defaultReasoningOption);

  const actionsRight = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  actionsRight.className = "zoteroagent-actions-right";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.textContent = "Send";

  const attachPageBtn = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  attachPageBtn.id = "zoteroagent-attach-page";
  attachPageBtn.className = "zoteroagent-compose-action icon-only";
  setIconButton(attachPageBtn, "image", "Attach current PDF page");

  actionsRight.appendChild(attachPageBtn);
  actionsRight.appendChild(sendBtn);
  actionsRow.appendChild(modelSelect);
  actionsRow.appendChild(reasoningSelect);
  actionsRow.appendChild(actionsRight);

  composeArea.appendChild(contextChips);
  composeArea.appendChild(textarea);
  composeArea.appendChild(mentionPanel);
  composeArea.appendChild(commandPanel);
  composeArea.appendChild(actionsRow);

  inputArea.appendChild(composeArea);

  const viewTabs = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  viewTabs.id = "zoteroagent-view-tabs";
  viewTabs.className = "zoteroagent-view-tabs";
  const chatTab = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  chatTab.id = "zoteroagent-view-chat";
  chatTab.className = "zoteroagent-view-tab is-active";
  chatTab.textContent = "Chat";
  const memoryTab = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "button",
  ) as HTMLButtonElement;
  memoryTab.id = "zoteroagent-view-memory";
  memoryTab.className = "zoteroagent-view-tab";
  memoryTab.textContent = "Memory";
  viewTabs.appendChild(chatTab);
  viewTabs.appendChild(memoryTab);

  const headerWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  headerWrap.className = "zoteroagent-header-wrap";
  headerWrap.appendChild(viewTabs);
  mountAgentStatusSlot(doc, headerWrap);
  headerWrap.appendChild(sessionRow);
  headerWrap.appendChild(sessionMenu);
  headerWrap.appendChild(sessionDeleteConfirm);
  headerWrap.appendChild(contextDigestBar);
  headerWrap.appendChild(historyPanel);

  const memoryPanel = buildMemoryPanel(doc);

  container.appendChild(headerWrap);
  container.appendChild(messagesDiv);
  container.appendChild(memoryPanel);
  container.appendChild(inputArea);
  const quotePopup = doc.createElementNS(
    XHTML_NS,
    "button",
  ) as HTMLButtonElement;
  quotePopup.id = "zoteroagent-quote-popup";
  quotePopup.className = "zoteroagent-quote-popup";
  quotePopup.type = "button";
  setIconButton(quotePopup, "quote", "Quote selection");
  container.appendChild(quotePopup);
  body.appendChild(container);

  bindChatEvents(body);
  autoResizeTextarea(textarea);
}

function bindChatEvents(body: HTMLElement) {
  body
    .querySelector("#zoteroagent-view-chat")
    ?.addEventListener("click", () => switchChatView(body, "chat"));
  body
    .querySelector("#zoteroagent-view-memory")
    ?.addEventListener("click", () => switchChatView(body, "memory"));
  const memorySearch = body.querySelector(
    "#zoteroagent-memory-search",
  ) as HTMLInputElement | null;
  memorySearch?.addEventListener("input", () => {
    scheduleMemorySearch(body, memorySearch.value);
  });
  body
    .querySelector("#zoteroagent-memory-sort")
    ?.addEventListener("change", () => {
      void renderMemoryBrowse(body);
    });
  body
    .querySelector("#zoteroagent-memory-refresh")
    ?.addEventListener("click", () => {
      void renderMemoryBrowse(body);
    });
  body
    .querySelector("#zoteroagent-topic-create")
    ?.addEventListener("click", () => {
      void startTopicNoteCreation(body);
    });
  body
    .querySelector("#zoteroagent-chat-send")
    ?.addEventListener("click", () => {
      void submitQuestion(body);
    });
  body
    .querySelector("#zoteroagent-attach-page")
    ?.addEventListener("click", (event) => {
      void attachCurrentPdfPage(body, event.currentTarget as HTMLButtonElement);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("keydown", (event) => {
      const ke = event as KeyboardEvent;
      if (handleCommandMenuKeyDown(body, ke)) return;
      if (handleMentionKeyDown(body, ke)) return;
      if (ke.key === "Enter" && !ke.shiftKey) {
        event.preventDefault();
        void submitQuestion(body);
      }
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("paste", (event) => {
      void handleClipboardImages(body, event as ClipboardEvent);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("input", () => {
      const input = body.querySelector(
        "#zoteroagent-chat-input",
      ) as HTMLTextAreaElement | null;
      if (input) autoResizeTextarea(input);
      updateCommandMenu(body);
      if (getCommandMenuItems(input?.value || "").length) {
        hideMentionAutocomplete(body);
      } else {
        void updateMentionAutocomplete(body);
      }
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("blur", () => {
      body.ownerDocument.defaultView?.setTimeout(() => {
        hideMentionAutocomplete(body);
        hideCommandMenu(body);
      }, 150);
    });
  body
    .querySelector("#zoteroagent-model-select")
    ?.addEventListener("change", (event) => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session =
        chatStore.getSession(itemId) || chatStore.createSession(itemId);
      if (!session) return;
      const select = event.target as HTMLSelectElement;
      chatStore.updateSessionModel(itemId, select.value, session.sessionId);
      updateModelSelectorTitle(select, select.value);
      void syncModelControls(body, itemId, {
        isGenerating: () => isGenerating,
        isSafeBody,
      });
    });
  body
    .querySelector("#zoteroagent-reasoning-select")
    ?.addEventListener("change", (event) => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session =
        chatStore.getSession(itemId) || chatStore.createSession(itemId);
      if (!session) return;
      const value = (event.target as HTMLSelectElement).value;
      chatStore.updateSessionReasoningEffort(
        itemId,
        (value || undefined) as CodexReasoningEffort | undefined,
        session.sessionId,
      );
    });
  body
    .querySelector("#zoteroagent-session-new")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session = chatStore.createSession(itemId);
      if (!session) return;
      body.dataset.chatMode = "chat";
      syncSessionHeader(body, itemId);
      renderMessages(body, itemId);
      syncLayoutState(body, itemId);
      (
        body.querySelector(
          "#zoteroagent-chat-input",
        ) as HTMLTextAreaElement | null
      )?.focus();
    });
  bindSessionControls(body, {
    isGenerating: () => isGenerating,
    compact: (itemId) => {
      void compactSessionContext(body, itemId, "manual");
    },
    refresh: (itemId) => {
      renderMessages(body, itemId);
      syncSessionHeader(body, itemId);
      syncLayoutState(body, itemId);
    },
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
  bindAssistantSelectionEvents(body);
}

// ===================== Generation State =====================

function setGenerating(body: HTMLElement, generating: boolean) {
  isGenerating = generating;
  if (!isSafeBody(body)) return;
  const sendBtn = body.querySelector(
    "#zoteroagent-chat-send",
  ) as HTMLElement | null;
  const modelSelect = body.querySelector(
    "#zoteroagent-model-select",
  ) as HTMLSelectElement | null;
  const reasoningSelect = body.querySelector(
    "#zoteroagent-reasoning-select",
  ) as HTMLSelectElement | null;
  const attachPage = body.querySelector(
    "#zoteroagent-attach-page",
  ) as HTMLButtonElement | null;
  const sessionActions = Array.from(
    body.querySelectorAll(
      "#zoteroagent-session-new, #zoteroagent-session-history, #zoteroagent-session-menu-toggle",
    ),
  ) as HTMLButtonElement[];
  if (modelSelect) modelSelect.disabled = generating;
  if (reasoningSelect) reasoningSelect.disabled = generating;
  if (attachPage) attachPage.disabled = generating;
  for (const action of sessionActions) action.disabled = generating;
  for (const action of Array.from(
    body.querySelectorAll(
      ".zoteroagent-delete-button, .zoteroagent-edit-button, .zoteroagent-topic-create, .zoteroagent-paper-tier-select",
    ),
  ) as Array<HTMLButtonElement | HTMLSelectElement>) {
    action.disabled = generating;
  }
  if (sendBtn) {
    if (generating) {
      sendBtn.classList.add("is-stop");
      sendBtn.textContent = "Stop";
      sendBtn.title = "Stop generating";
    } else {
      sendBtn.classList.remove("is-stop");
      sendBtn.textContent = "Send";
      sendBtn.title = "Send";
      activeCodexProcess = null;
      activeCodexOwner = null;
    }
  }
  if (!generating) {
    hideAgentStatus(body);
  }
  updateTopicSelectionStatus(body);
}

function showAgentStatus(
  body: HTMLElement,
  text: string,
  kind: AgentStatusKind = "progress",
) {
  if (!isSafeBody(body)) return;
  const slot = body.querySelector(
    "#zoteroagent-agent-status-slot",
  ) as HTMLElement | null;
  if (!slot) return;
  if (kind === "notice") {
    showNoticeStatus(slot, text || "Generating...");
  } else {
    showBusyStatus(slot, text || "Generating...", () =>
      abortGeneration(body),
    );
  }
}

function hideAgentStatus(body: HTMLElement) {
  if (!isSafeBody(body)) return;
  const slot = body.querySelector(
    "#zoteroagent-agent-status-slot",
  ) as HTMLElement | null;
  if (slot) clearAgentStatus(slot);
}

function abortGeneration(body: HTMLElement) {
  const itemId = Number(body.dataset.itemID);
  const owner = activeCodexOwner;
  const targetItemId = owner?.itemId || itemId;
  const sessionId =
    owner?.sessionId ||
    (targetItemId > 0 ? chatStore.getActiveSessionId(targetItemId) : "");
  if (targetItemId > 0 && sessionId) {
    getChatSendFlow(body).cancel(targetItemId, sessionId);
    if (getChatSendFlow(body).isActive(targetItemId, sessionId)) {
      renderMessages(body, itemId);
      return;
    }
  }
  if (activeCodexProcess) {
    try {
      activeCodexProcess.kill();
    } catch (_e) {
      /* ignore */
    }
    activeCodexProcess = null;
  }
  setGenerating(body, false);
  const slot = body.querySelector(
    "#zoteroagent-agent-status-slot",
  ) as HTMLElement | null;
  if (slot) showNoticeStatus(slot, "Cancelled.");
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

function getPaperMeta(itemId: number): PaperVaultMeta {
  return getZoteroPaperMeta(itemId);
}

function normalizePaperContexts(
  papers: PaperContext[],
  inFocusItemKey: string,
): PaperContext[] {
  const seen = new Set<string>();
  const result: PaperContext[] = [];
  for (const paper of papers || []) {
    const itemKey = String(paper.itemKey || "").trim();
    if (!itemKey || itemKey === inFocusItemKey || seen.has(itemKey)) continue;
    seen.add(itemKey);
    result.push({
      itemKey,
      title: String(paper.title || itemKey),
      creators: paper.creators || "",
      year: paper.year || "",
    });
  }
  return result;
}

async function compactSessionContext(
  body: HTMLElement,
  itemId: number,
  trigger: "manual" | "auto",
) {
  const session = chatStore.getSession(itemId);
  if (!session || session.messages.length === 0) return;
  if (body.dataset.contextDigestBusy === "true") return;
  body.dataset.contextDigestBusy = "true";
  renderDigestStatus(
    body,
    itemId,
    isGenerating,
    "Compacting hidden context...",
  );
  const paperMeta = getPaperMeta(itemId);
  const isActivePane = () =>
    isSafeBody(body) &&
    Number(body.dataset.itemID) === itemId &&
    chatStore.getActiveSessionId(itemId) === session.sessionId;
  try {
    const digest = await generateContextDigest({
      itemKey: paperMeta.itemKey,
      title: paperMeta.title,
      messages: session.messages,
      previousDigest: session.contextDigest,
      previousDigestUpToMessageIndex: session.contextDigestUpToMessageIndex,
      onStatus: (text) => {
        if (trigger === "auto" && isActivePane()) showAgentStatus(body, text);
        if (isActivePane())
          renderDigestStatus(body, itemId, isGenerating, text);
      },
    });
    chatStore.updateContextDigest(itemId, digest, session.sessionId);
  } catch (error) {
    ztoolkit.log("[Agent] Context digest compaction error:", error);
  } finally {
    delete body.dataset.contextDigestBusy;
    if (isActivePane()) renderDigestStatus(body, itemId, isGenerating);
  }
}

function resolvePdfAttachmentItemId(
  itemId: number,
  reader?: _ZoteroTypes.ReaderInstance | null,
): number {
  const candidates = new Set<number>();
  if ((reader as any)?.itemID) {
    candidates.add(Number((reader as any).itemID));
  }
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
  chatStore.addMessage(itemId, {
    role: "assistant",
    content,
    model: getModelLabel(),
  });
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
}

function addUserCommandMessage(
  body: HTMLElement,
  itemId: number,
  commandLabel: string,
) {
  chatStore.addMessage(itemId, {
    role: "user",
    content: commandLabel,
  });
  renderMessages(body, itemId);
  syncLayoutState(body, itemId);
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
  const question = input.value.trim();
  if (!question) return;

  const itemId = Number(body.dataset.itemID);
  if (!itemId || itemId < 0) return;
  let session = chatStore.getSession(itemId);
  if (!session) session = chatStore.createSession(itemId);
  if (!session) return;
  const flow = getChatSendFlow(body);
  if (!flow.canSubmit()) {
    showAgentStatus(body, "Wait for the running turn to finish.", "notice");
    return;
  }

  const refText = addon.data.chat.referenceText;
  const responseQuote = addon.data.chat.responseQuote;
  const paperMeta = getPaperMeta(itemId);
  const mentionedPapers = normalizePaperContexts(
    addon.data.chat.mentionedPapers,
    paperMeta.itemKey,
  );
  const imageRefs = addon.data.chat.pendingImages.filter(
    (ref) =>
      ref.relativePath.startsWith(`${paperMeta.itemKey}/`) &&
      ref.sessionId === session.sessionId,
  );
  const priorVisibleMessages = chatStore
    .getMessages(itemId)
    .map((message) => ({ ...message }));
  const contextBlocks: string[] = [];
  if (refText) contextBlocks.push(`${SELECTED_TEXT_PREFIX}${refText}`);
  if (responseQuote)
    contextBlocks.push(`${RESPONSE_QUOTE_PREFIX}${responseQuote}`);
  const displayContent = contextBlocks.length
    ? `${contextBlocks.join("\n\n")}\n\n${question}`
    : question;
  const conversationDisplayContent = imageRefs.length
    ? `${displayContent}\n\n[Local screenshots: ${imageRefs
        .map(
          (ref) =>
            `${ref.relativePath}${
              ref.pageNumber ? ` (PDF page ${ref.pageNumber})` : ""
            }`,
        )
        .join(", ")}]`
    : displayContent;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  input.value = "";
  autoResizeTextarea(input);
  addon.data.chat.referenceText = "";
  addon.data.chat.responseQuote = "";
  addon.data.chat.mentionedPapers = [];
  addon.data.chat.pendingImages = addon.data.chat.pendingImages.filter(
    (ref) => !imageRefs.some((used) => used.id === ref.id),
  );
  syncContextChips(body);
  hideMentionAutocomplete(body);
  hideCommandMenu(body);
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const submission: ChatSubmission = {
    itemId,
    paper: paperMeta,
    pdfItemId,
    session: {
      sessionId: session.sessionId,
      codexThreadId: session.codexThreadId || "",
      modelSlug: session.modelSlug || "",
      reasoningEffort: session.reasoningEffort,
      contextDigest: session.contextDigest,
      contextDigestUpToMessageIndex: session.contextDigestUpToMessageIndex,
    },
    text: question,
    selectedText: refText,
    responseQuote,
    mentionedPapers,
    imageRefs: imageRefs.map((ref) => ({ ...ref })),
    imagePaths: [],
    priorVisibleMessages,
    displayContent,
    conversationDisplayContent,
  };
  await flow.submit(
    submission,
    createChatFlowSink(body, itemId, session.sessionId),
  );
}

async function executeResearchSubmission(
  body: HTMLElement,
  request: ChatSubmission,
  sink: ChatFlowSink,
) {
  const {
    itemId,
    paper: paperMeta,
    mentionedPapers,
    imageRefs,
    imagePaths,
    priorVisibleMessages,
    displayContent,
    conversationDisplayContent,
    session,
  } = request;
  const isActivePane = () =>
    isSafeBody(body) &&
    Number(body.dataset.itemID) === itemId &&
    chatStore.getActiveSessionId(itemId) === session.sessionId;

  const selectedModel = String(session?.modelSlug || "").trim();
  chatStore.addMessage(
    itemId,
    {
      role: "user",
      content: displayContent,
      contextPapers: mentionedPapers,
      imageRefs: imageRefs.map((ref) => ({ ...ref })),
    },
    session.sessionId,
  );
  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    model: getModelLabel(selectedModel),
    reasoningEffort: session?.reasoningEffort,
    contextPapers: mentionedPapers,
  };
  chatStore.addMessage(itemId, assistant, session.sessionId);
  if (isActivePane()) renderMessages(body, itemId);
  sink.onRunning?.(true);
  sink.onStatus?.("Preparing Codex...");
  let resolvedImagePaths = imagePaths;
  if (!resolvedImagePaths.length && imageRefs.length) {
    try {
      resolvedImagePaths = await resolveLocalImagePaths(imageRefs);
    } catch (error) {
      ztoolkit.log("[Agent] Failed to resolve local screenshots:", error);
      resolvedImagePaths = [];
      sink.onStatus?.(
        "Local screenshots are unavailable; continuing without them...",
      );
    }
  }

  if (request.pdfItemId <= 0) {
    assistant.content =
      "No valid PDF attachment found. Please confirm the item has an accessible PDF attachment in Zotero.";
    sink.onRunning?.(false);
    if (isActivePane()) renderMessages(body, itemId);
    return;
  }

  const aiQuestion = buildQuotedQuestion({
    question: request.text,
    selectedText: request.selectedText,
    responseQuote: request.responseQuote,
  });

  try {
    let lastRefresh = 0;
    const result = await runResearchTurn(
      {
        paper: paperMeta,
        pdfItemId: request.pdfItemId,
        question: aiQuestion,
        mentionedPapers,
        session: {
          sessionId: session?.sessionId || chatStore.getActiveSessionId(itemId),
          codexThreadId: session?.codexThreadId || "",
          modelSlug: selectedModel,
          reasoningEffort: session?.reasoningEffort,
          contextDigest: session?.contextDigest,
          contextDigestUpToMessageIndex: session?.contextDigestUpToMessageIndex,
        },
        priorVisibleMessages,
        userDisplayContent: conversationDisplayContent,
        images: resolvedImagePaths,
        imageEvidence: imageRefs.map((ref, index) => ({
          path: resolvedImagePaths[index] || ref.relativePath,
          pageNumber: ref.pageNumber,
        })),
      },
      {
        onStatus: (text) => sink.onStatus?.(text),
        onProcess: (proc) => {
          sink.onProcess?.(proc);
        },
        onActivities: (activities) => {
          assistant.activities = activities.slice();
        },
        onChunk: (state) => {
          assistant.content = state.content;
          assistant.reasoning = state.reasoning;
          if (state.usage) assistant.usage = state.usage;
          const now = Date.now();
          if (now - lastRefresh > 150) {
            lastRefresh = now;
            if (isActivePane()) updateStreamingMessage(body, state);
          }
        },
      },
    );
    assistant.content = result.content || assistant.content;
    assistant.reasoning = result.reasoning || assistant.reasoning;
    if (result.usage) assistant.usage = result.usage;
    assistant.model = getModelLabel(result.usage?.modelSlug || selectedModel);
    if (result.activities.length)
      assistant.activities = result.activities.slice();
    if (result.resumedFreshThread) {
      if (isActivePane()) {
        showAgentStatus(
          body,
          "Previous Codex thread failed; continued in a fresh thread from hidden context.",
        );
      }
    }
    if (result.threadId) {
      chatStore.updateCodexThreadId(
        itemId,
        result.threadId,
        session?.sessionId,
      );
    }
    assistant.memoryUpdated = result.memoryUpdated;
    assistant.relationshipUpdates = result.relationshipUpdates;
    assistant.quality = result.quality;
    assistant.keywordSuggestions = result.keywordSuggestions;
    assistant.tierSuggestion = result.tierSuggestion;
    assistant.committed = result.committed;
  } catch (e: any) {
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId);
  sink.onRunning?.(false);
  if (isActivePane()) renderMessages(body, itemId);
  maybeGenerateSessionTitleLocal(body, itemId, request.text, session.sessionId);
}

function maybeGenerateSessionTitleLocal(
  body: HTMLElement,
  itemId: number,
  question: string,
  sessionId?: string,
) {
  if (!chatStore.needsAutoTitle(itemId, sessionId)) return;
  const title = question
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .replace(/[。！？,.，；;:：\s]+$/g, "");
  if (!title) return;
  chatStore.renameSession(itemId, title, sessionId);
  if (
    isSafeBody(body) &&
    Number(body.dataset.itemID) === itemId &&
    (!sessionId || chatStore.getActiveSessionId(itemId) === sessionId)
  )
    syncSessionHeader(body, itemId);
}

// ===================== Rendering =====================

function getModelLabel(modelSlug?: string): string {
  return String(modelSlug || "").trim() || "Codex";
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
    if (isGenerating) return;
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
  btn.disabled = isGenerating;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isGenerating) return;
    const wrapper = btn.closest(".zoteroagent-message") as HTMLElement | null;
    if (!wrapper) return;
    const idx = Number(wrapper.dataset.msgIndex);
    if (Number.isNaN(idx) || idx < 0) return;
    const receipt = chatStore.deleteMessage(itemId, idx);
    if (!receipt) return;
    renderMessages(body, itemId);
    syncLayoutState(body, itemId);
    const undo = showUndoToast(body, "Message deleted", () => {
      const result = chatStore.restoreMessage(receipt);
      if (!result.restored) return false;
      renderMessages(body, itemId);
      syncLayoutState(body, itemId);
      return true;
    });
    undo.focus();
  });
  return btn;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function formatUsageLine(usage: TokenUsage): string {
  return formatCodexUsageLine(usage);
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
  if (msg.role === "assistant" && msg.usage) {
    usageEl.title = buildCodexUsageTitle(msg.usage);
  }
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
  const discardedCount = messages.length - msgIndex - 1;
  if (discardedCount > 0) {
    const warning = doc.createElementNS(XHTML_NS, "p") as HTMLElement;
    warning.className = "zoteroagent-edit-warning";
    warning.textContent = `Resending will discard ${discardedCount} later message${
      discardedCount === 1 ? "" : "s"
    }.`;
    editContainer.appendChild(warning);
  }
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
  state: { content: string; reasoning: string; usage?: TokenUsage },
) {
  try {
    if (!isSafeBody(body)) return;
    hideQuotePopup(body);
    const container = body.querySelector(
      "#zoteroagent-chat-messages",
    ) as HTMLElement | null;
    if (!container) return;
    const shouldStayPinned = isNearBottom(container);

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

    const contentEl = mainEl.querySelector(
      ".zoteroagent-message-content",
    ) as HTMLElement;
    if (contentEl) {
      try {
        contentEl.innerHTML = renderMarkdown(state.content);
      } catch (_e) {
        contentEl.textContent = state.content;
      }
      enhancePageEvidenceChips(contentEl, body);
    }
    msgWrapper.dataset.rawContent = state.content || "";
    const usageEl = msgWrapper.querySelector(
      ".zoteroagent-msg-usage",
    ) as HTMLElement | null;
    if (usageEl && state.usage) {
      usageEl.textContent = formatUsageLine(state.usage);
      usageEl.title = buildCodexUsageTitle(state.usage);
    }

    scrollToBottomIfPinned(container, shouldStayPinned);
  } catch (e) {
    ztoolkit.log("[Agent] updateStreamingMessage error:", e);
  }
}

function enhancePageEvidenceChips(root: HTMLElement, body: HTMLElement) {
  // Page chips are a cosmetic enhancement layered on top of already-rendered
  // message content. It must never throw: a failure here previously bubbled to
  // renderMessages' outer catch and blanked the whole transcript. Resolve
  // NodeFilter from the document's window (the bare global is not reliably in
  // scope inside the Zotero chrome bundle) and swallow any DOM error.
  try {
    const doc = root.ownerDocument;
    const nodeFilter: typeof NodeFilter =
      (doc.defaultView as any)?.NodeFilter || (globalThis as any).NodeFilter;
    const walker = doc.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = (node as Text).parentElement;
        if (!parent || shouldSkipPageEvidenceNode(parent)) {
          return nodeFilter.FILTER_REJECT;
        }
        return /\[page\s+[0-9]+\]/i.test(node.textContent || "")
          ? nodeFilter.FILTER_ACCEPT
          : nodeFilter.FILTER_SKIP;
      },
    });
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current as Text);
      current = walker.nextNode();
    }
    for (const node of nodes) {
      replacePageEvidenceTextNode(node, body);
    }
  } catch (e) {
    ztoolkit.log("[Agent] enhancePageEvidenceChips skipped:", e);
  }
}

function shouldSkipPageEvidenceNode(el: Element): boolean {
  return Boolean(
    el.closest("pre, code, a, script, style, button, .zoteroagent-page-chip"),
  );
}

function replacePageEvidenceTextNode(node: Text, body: HTMLElement) {
  const segments = parsePageEvidenceText(node.textContent || "");
  if (
    segments.length === 1 &&
    segments[0].type === "text" &&
    segments[0].text === (node.textContent || "")
  ) {
    return;
  }
  const doc = node.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const segment of segments) {
    if (segment.type === "text") {
      fragment.appendChild(doc.createTextNode(segment.text));
    } else {
      fragment.appendChild(createPageEvidenceChip(doc, body, segment));
    }
  }
  node.parentNode?.replaceChild(fragment, node);
}

function createPageEvidenceChip(
  doc: Document,
  body: HTMLElement,
  ref: PageEvidenceRef,
): HTMLButtonElement {
  const chip = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  chip.type = "button";
  chip.className = "zoteroagent-page-chip";
  chip.dataset.pageNumber = String(ref.pageNumber);
  chip.dataset.pageIndex = String(ref.pageIndex);
  chip.textContent = `p.${ref.pageNumber}`;
  applyPageChipState(chip, canJumpToPage(getActiveReader(), ref.pageIndex));
  chip.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void jumpToReaderPage(getActiveReader(), ref.pageIndex).then((result) => {
      applyPageChipState(chip, result);
      if (!result.ok) {
        showAgentStatus(
          body,
          pageJumpFailureText(result, ref.pageNumber),
          "notice",
        );
      }
    });
  });
  return chip;
}

function applyPageChipState(chip: HTMLButtonElement, state: PageJumpState) {
  // Keep the button clickable even when unavailable: the reader may open
  // later, and a click re-evaluates via jumpToReaderPage.
  chip.classList.toggle("is-disabled", !state.ok);
  chip.setAttribute("aria-disabled", String(!state.ok));
  const pageNumber = Number(chip.dataset.pageNumber || "0");
  chip.title = state.ok
    ? `Jump to PDF page ${pageNumber}`
    : pageJumpFailureText(state, pageNumber);
}

function pageJumpFailureText(
  state: Extract<PageJumpState, { ok: false }>,
  pageNumber: number,
): string {
  if (state.reason === "no-reader") return "No active PDF reader.";
  if (state.reason === "out-of-range") {
    return state.pageCount
      ? `Page ${pageNumber} is outside this PDF (${state.pageCount} pages).`
      : `Page ${pageNumber} is outside this PDF.`;
  }
  return `Could not jump to page ${pageNumber}.`;
}

function buildKeywordSuggestionBlock(
  doc: Document,
  body: HTMLElement,
  itemId: number,
  messageIndex: number,
  suggestions: string[],
): HTMLElement {
  const block = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  block.className = "zoteroagent-keyword-review";
  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-keyword-review-label";
  label.textContent = "Suggested keywords";
  block.appendChild(label);
  for (const keyword of suggestions) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-keyword-review-row";
    const text = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    text.textContent = keyword;
    const accept = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    accept.type = "button";
    accept.textContent = "Accept";
    accept.addEventListener("click", () => {
      const paper = getPaperMeta(itemId);
      void acceptPaperKeyword(paper, keyword).then(() => {
        const message = chatStore.getMessages(itemId)[messageIndex];
        if (!message) return;
        message.keywordSuggestions = (message.keywordSuggestions || []).filter(
          (entry) => entry !== keyword,
        );
        chatStore.touchSession(itemId);
        if (isSafeBody(body)) renderMessages(body, itemId);
      });
    });
    const reject = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    reject.type = "button";
    reject.textContent = "Dismiss";
    reject.addEventListener("click", () => {
      const message = chatStore.getMessages(itemId)[messageIndex];
      if (!message) return;
      message.keywordSuggestions = (message.keywordSuggestions || []).filter(
        (entry) => entry !== keyword,
      );
      chatStore.touchSession(itemId);
      renderMessages(body, itemId);
    });
    row.appendChild(text);
    row.appendChild(accept);
    row.appendChild(reject);
    block.appendChild(row);
  }
  return block;
}

function buildTierSuggestionBlock(
  doc: Document,
  body: HTMLElement,
  itemId: number,
  messageIndex: number,
  suggestion: NonNullable<ChatMessage["tierSuggestion"]>,
): HTMLElement {
  const block = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  block.className = "zoteroagent-keyword-review";
  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-keyword-review-label";
  label.textContent = `Close reading suggested (${suggestion})`;
  const accept = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  accept.type = "button";
  accept.textContent = "Upgrade";
  accept.addEventListener("click", () => {
    const paper = getPaperMeta(itemId);
    const reader = getActiveReader() || addon.data.popup.currentReader;
    const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
    const session = chatStore.getSession(itemId);
    if (pdfItemId <= 0) return;
    setGenerating(body, true);
    void transitionPaperTier({
      paper,
      pdfItemId,
      targetTier: "L2",
      model: session?.modelSlug,
      reasoningEffort: session?.reasoningEffort,
      onProcess: (process) => {
        activeCodexProcess = process;
      },
    })
      .then(() => {
        const message = chatStore.getMessages(itemId)[messageIndex];
        if (message) message.tierSuggestion = undefined;
        chatStore.touchSession(itemId);
      })
      .catch((error) => {
        showAgentStatus(
          body,
          `Tier upgrade failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "notice",
        );
      })
      .finally(() => {
        setGenerating(body, false);
        if (isSafeBody(body)) renderMessages(body, itemId);
      });
  });
  const dismiss = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => {
    const message = chatStore.getMessages(itemId)[messageIndex];
    if (!message) return;
    message.tierSuggestion = undefined;
    chatStore.touchSession(itemId);
    renderMessages(body, itemId);
  });
  block.appendChild(label);
  block.appendChild(accept);
  block.appendChild(dismiss);
  return block;
}

function renderMessages(body: HTMLElement, itemId: number) {
  try {
    if (!isSafeBody(body)) return;
    hideQuotePopup(body);
    renderMessageList({
      body,
      itemId,
      messages: chatStore.getMessages(itemId),
      paperTitle: getItemTitle(itemId),
      renderUserMessage: (container, message, messageBody) =>
        renderUserMessageView(container, message, messageBody, {
          parseQuotedPageContext,
          createPageEvidenceChip,
        }),
      enhancePageEvidence: (root) => enhancePageEvidenceChips(root, body),
      buildKeywordSuggestions: buildKeywordSuggestionBlock,
      buildTierSuggestion: buildTierSuggestionBlock,
      createMetaRow: createMessageMetaRow,
      onSuggestion: (suggestion) => {
        const input = body.querySelector(
          "#zoteroagent-chat-input",
        ) as HTMLTextAreaElement | null;
        if (!input) return;
        input.value = suggestion;
        autoResizeTextarea(input);
        input.focus();
      },
      onActionCommand: (actionId, command) =>
        handleActionCardCommand(body, itemId, actionId, command),
      syncSessionHeader: () => syncSessionHeader(body, itemId),
    });
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
      autoResizeTextarea(input);
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

type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

function getMentionTrigger(input: HTMLTextAreaElement): MentionTrigger | null {
  const cursor = input.selectionStart ?? input.value.length;
  if ((input.selectionEnd ?? cursor) !== cursor) return null;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return {
    start: beforeCursor.length - String(match[2] || "").length - 1,
    end: cursor,
    query: String(match[2] || "").toLowerCase(),
  };
}

function getChatSendFlow(body: HTMLElement): DefaultChatSendFlow {
  const existing = chatSendFlowMap.get(body);
  if (existing) return existing;
  const flow = new DefaultChatSendFlow({
    store: chatStore,
    organizeNote: organizePaperNote,
    appendConversationTurn,
    runResearch: (request, sink) =>
      executeResearchSubmission(body, request, sink),
  });
  chatSendFlowMap.set(body, flow);
  return flow;
}

function createChatFlowSink(
  body: HTMLElement,
  expectedItemId: number,
  expectedSessionId: string,
): ChatFlowSink {
  const isExpectedContext = () =>
    isSafeBody(body) &&
    Number(body.dataset.itemID) === expectedItemId &&
    chatStore.getActiveSessionId(expectedItemId) === expectedSessionId;
  return {
    onChanged: (itemId) => {
      if (isExpectedContext() && itemId === expectedItemId) {
        renderMessages(body, itemId);
        syncLayoutState(body, itemId);
      }
    },
    onRunning: (running) => {
      if (running) {
        activeCodexOwner = {
          itemId: expectedItemId,
          sessionId: expectedSessionId,
        };
      }
      if (isExpectedContext() || !running) {
        setGenerating(body, running);
      } else {
        isGenerating = running;
        if (!running) activeCodexProcess = null;
      }
    },
    onStatus: (text) => {
      if (isExpectedContext()) showAgentStatus(body, text);
    },
    onProcess: (process) => {
      if (process) {
        activeCodexProcess = process;
        activeCodexOwner = {
          itemId: expectedItemId,
          sessionId: expectedSessionId,
        };
      } else if (
        activeCodexOwner?.itemId === expectedItemId &&
        activeCodexOwner.sessionId === expectedSessionId
      ) {
        activeCodexProcess = null;
        activeCodexOwner = null;
      }
    },
  };
}

function handleActionCardCommand(
  body: HTMLElement,
  itemId: number,
  actionId: string,
  command: ActionCardCommand,
) {
  const found = chatStore.findAction(actionId);
  if (!found) return;
  if (command === "view") {
    void openActionTarget(body, found.action);
    return;
  }
  if (command === "cancel") {
    getChatSendFlow(body).cancel(itemId, found.sessionId);
    if (getChatSendFlow(body).isActive(itemId, found.sessionId)) {
      renderMessages(body, itemId);
      return;
    }
    setGenerating(body, false);
    renderMessages(body, itemId);
    return;
  }
  if (command === "undo") {
    void getChatSendFlow(body).undo(
      actionId,
      createChatFlowSink(body, found.itemId, found.sessionId),
    );
    return;
  }
  void getChatSendFlow(body).decide(
    actionId,
    command,
    createChatFlowSink(body, found.itemId, found.sessionId),
  );
}

async function openActionTarget(
  body: HTMLElement,
  action: NonNullable<ChatMessage["action"]>,
) {
  switchChatView(body, "memory", false);
  await renderMemoryDetail(
    body,
    action.target?.itemKey || action.request.itemKey,
    action.request.paperTitle,
  );
  if (action.target?.section === "Thinking") {
    body
      .querySelector("#zoteroagent-memory-reader-thinking")
      ?.scrollIntoView({ block: "start" });
  }
}

function getCommandPanel(body: HTMLElement): HTMLElement | null {
  return body.querySelector("#zoteroagent-command-panel") as HTMLElement | null;
}

function hideCommandMenu(body: HTMLElement) {
  const panel = getCommandPanel(body);
  if (!panel) return;
  panel.style.display = "none";
  panel.dataset.activeIndex = "0";
  panel.replaceChildren();
}

function updateCommandMenu(body: HTMLElement) {
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  const panel = getCommandPanel(body);
  if (!input || !panel) return;
  const items = getCommandMenuItems(input.value);
  panel.replaceChildren();
  if (!items.length) {
    hideCommandMenu(body);
    return;
  }
  const doc = body.ownerDocument;
  items.forEach((item, index) => {
    const row = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    row.type = "button";
    row.className = `zoteroagent-command-item${index === 0 ? " is-active" : ""}`;
    row.dataset.index = String(index);
    const command = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    command.className = "zoteroagent-command-name";
    command.textContent = item.command;
    const description = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    description.className = "zoteroagent-command-description";
    description.textContent = item.description;
    row.appendChild(command);
    row.appendChild(description);
    row.addEventListener("mousedown", (event) => event.preventDefault());
    row.addEventListener("click", () => {
      applyCommandTemplate(input, item.template);
      hideCommandMenu(body);
    });
    panel.appendChild(row);
  });
  panel.dataset.activeIndex = "0";
  panel.style.display = "flex";
}

function handleCommandMenuKeyDown(
  body: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const panel = getCommandPanel(body);
  if (!panel || panel.style.display === "none") return false;
  const items = Array.from(
    panel.querySelectorAll(".zoteroagent-command-item"),
  ) as HTMLButtonElement[];
  if (!items.length) return false;
  let active = Number(panel.dataset.activeIndex || 0);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    active = (active + delta + items.length) % items.length;
    panel.dataset.activeIndex = String(active);
    items.forEach((item, index) =>
      item.classList.toggle("is-active", index === active),
    );
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideCommandMenu(body);
    return true;
  }
  if (event.key !== "Enter") return false;
  event.preventDefault();
  items[active]?.click();
  return true;
}

function applyCommandTemplate(input: HTMLTextAreaElement, template: string) {
  const result = insertCommandTemplate(
    input.value,
    0,
    input.value.length,
    template,
  );
  input.value = result.value;
  input.setSelectionRange(result.cursor, result.cursor);
  autoResizeTextarea(input);
  input.focus();
}

function getMentionPanel(body: HTMLElement): HTMLElement | null {
  return body.querySelector("#zoteroagent-mention-panel") as HTMLElement | null;
}

function hideMentionAutocomplete(body: HTMLElement) {
  const panel = getMentionPanel(body);
  if (!panel) return;
  panel.style.display = "none";
  panel.dataset.activeIndex = "0";
  while (panel.firstChild) panel.firstChild.remove();
}

async function updateMentionAutocomplete(body: HTMLElement) {
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  const panel = getMentionPanel(body);
  if (!input || !panel) return;
  const trigger = getMentionTrigger(input);
  if (!trigger) {
    hideMentionAutocomplete(body);
    return;
  }

  const requestId = ++mentionRequestSeq;
  const currentItemId = Number(body.dataset.itemID) || 0;
  const currentKey =
    currentItemId > 0 ? getPaperMeta(currentItemId).itemKey : "";
  const selected = new Set(
    normalizePaperContexts(addon.data.chat.mentionedPapers, currentKey).map(
      (paper) => paper.itemKey,
    ),
  );

  let papers: PaperVaultMeta[] = [];
  try {
    papers = await listVaultPapers();
  } catch (error) {
    ztoolkit.log("[Agent] Failed to list vault papers for mentions:", error);
  }
  if (requestId !== mentionRequestSeq) return;

  const filtered = papers
    .filter(
      (paper) => paper.itemKey !== currentKey && !selected.has(paper.itemKey),
    )
    .filter((paper) => {
      if (!trigger.query) return true;
      const haystack = [
        paper.itemKey,
        paper.title,
        paper.creators || "",
        paper.year || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trigger.query);
    })
    .slice(0, 8);

  while (panel.firstChild) panel.firstChild.remove();
  if (!filtered.length) {
    hideMentionAutocomplete(body);
    return;
  }

  const doc = body.ownerDocument;
  filtered.forEach((paper, index) => {
    const row = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
    row.type = "button";
    row.className = `zoteroagent-mention-item${index === 0 ? " is-active" : ""}`;
    row.dataset.index = String(index);
    row.dataset.itemKey = paper.itemKey;

    const title = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    title.className = "zoteroagent-mention-title";
    title.textContent = paper.title || paper.itemKey;
    const meta = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    meta.className = "zoteroagent-mention-meta";
    meta.textContent = [paper.creators, paper.year, paper.itemKey]
      .filter(Boolean)
      .join(" · ");
    row.appendChild(title);
    row.appendChild(meta);
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectMentionPaper(body, paper, trigger);
    });
    panel.appendChild(row);
  });
  panel.dataset.activeIndex = "0";
  panel.style.display = "flex";
}

function handleMentionKeyDown(
  body: HTMLElement,
  event: KeyboardEvent,
): boolean {
  const panel = getMentionPanel(body);
  if (!panel || panel.style.display === "none") return false;
  const rows = Array.from(
    panel.querySelectorAll(".zoteroagent-mention-item"),
  ) as HTMLButtonElement[];
  if (!rows.length) return false;
  const current = Number(panel.dataset.activeIndex || "0") || 0;
  if (event.key === "Escape") {
    event.preventDefault();
    hideMentionAutocomplete(body);
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + rows.length) % rows.length;
    setActiveMentionRow(panel, rows, next);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    rows[current]?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    return true;
  }
  return false;
}

function setActiveMentionRow(
  panel: HTMLElement,
  rows: HTMLButtonElement[],
  index: number,
) {
  rows.forEach((row, idx) => row.classList.toggle("is-active", idx === index));
  panel.dataset.activeIndex = String(index);
}

function selectMentionPaper(
  body: HTMLElement,
  paper: PaperContext,
  trigger: MentionTrigger,
) {
  const input = body.querySelector(
    "#zoteroagent-chat-input",
  ) as HTMLTextAreaElement | null;
  const currentItemId = Number(body.dataset.itemID) || 0;
  const currentKey =
    currentItemId > 0 ? getPaperMeta(currentItemId).itemKey : "";
  addon.data.chat.mentionedPapers = normalizePaperContexts(
    [...addon.data.chat.mentionedPapers, paper],
    currentKey,
  );
  if (input) {
    input.setRangeText("", trigger.start, trigger.end, "end");
    input.focus();
  }
  syncContextChips(body);
  hideMentionAutocomplete(body);
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
  const preview = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  preview.type = "button";
  preview.className = "zoteroagent-context-chip-preview";

  const icon = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  icon.className = "zoteroagent-context-chip-icon";
  insertSvgMarkup(icon, getIconSvg(kind === "text" ? "attachPdf" : "quote"));

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
      preview.appendChild(icon);
      preview.appendChild(label);
      preview.appendChild(meta);
    } else {
      preview.appendChild(icon);
      preview.appendChild(label);
    }
  } else {
    label.textContent = "Response Quote";
    preview.appendChild(icon);
    preview.appendChild(label);
  }
  chip.appendChild(preview);

  const dismiss = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  dismiss.type = "button";
  dismiss.className = "zoteroagent-context-chip-dismiss";
  setIconButton(
    dismiss,
    "clear",
    kind === "text" ? "Remove text context" : "Remove response quote",
  );
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
  bindContextChipPreview(chip, preview);

  return chip;
}

function createPaperContextChip(
  body: HTMLElement,
  paper: PaperContext,
): HTMLElement {
  const doc = body.ownerDocument;
  const chip = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  chip.className = "zoteroagent-context-chip paper-context";
  const preview = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  preview.type = "button";
  preview.className = "zoteroagent-context-chip-preview";

  const icon = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  icon.className = "zoteroagent-context-chip-icon";
  insertSvgMarkup(icon, getIconSvg("attachPdf"));

  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-context-chip-label";
  label.textContent = paper.title || paper.itemKey;

  const metaText = [paper.creators, paper.year, paper.itemKey]
    .filter(Boolean)
    .join(" · ");
  if (metaText) {
    const meta = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    meta.className = "zoteroagent-context-chip-meta";
    meta.textContent = paper.itemKey;
    preview.appendChild(icon);
    preview.appendChild(label);
    preview.appendChild(meta);
  } else {
    preview.appendChild(icon);
    preview.appendChild(label);
  }
  chip.appendChild(preview);

  const dismiss = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  dismiss.type = "button";
  dismiss.className = "zoteroagent-context-chip-dismiss";
  setIconButton(dismiss, "clear", "Remove paper context");
  dismiss.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addon.data.chat.mentionedPapers = addon.data.chat.mentionedPapers.filter(
      (entry) => entry.itemKey !== paper.itemKey,
    );
    syncContextChips(body);
    void updateMentionAutocomplete(body);
  });
  chip.appendChild(dismiss);

  const content = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  content.className = "zoteroagent-context-chip-content";
  content.textContent = metaText || paper.itemKey;
  chip.appendChild(content);
  bindContextChipPreview(chip, preview);

  return chip;
}

function createLocalImageChip(
  body: HTMLElement,
  image: LocalImageRef,
): HTMLElement {
  const doc = body.ownerDocument;
  const chip = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  chip.className = "zoteroagent-context-chip image-context";
  if (image.previewUrl) {
    const preview = doc.createElementNS(XHTML_NS, "img") as HTMLImageElement;
    preview.className = "zoteroagent-context-image-preview";
    preview.src = image.previewUrl;
    preview.alt = "";
    chip.appendChild(preview);
  }
  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-context-chip-label";
  label.textContent = "Screenshot";
  chip.appendChild(label);
  const dismiss = doc.createElementNS(XHTML_NS, "button") as HTMLButtonElement;
  dismiss.type = "button";
  dismiss.className = "zoteroagent-context-chip-dismiss";
  setIconButton(dismiss, "clear", "Remove screenshot");
  dismiss.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    addon.data.chat.pendingImages = addon.data.chat.pendingImages.filter(
      (entry) => entry.id !== image.id,
    );
    void deleteLocalImage(image);
    syncContextChips(body);
  });
  chip.appendChild(dismiss);
  return chip;
}

function bindContextChipPreview(
  chip: HTMLElement,
  preview: HTMLButtonElement,
): void {
  preview.setAttribute("aria-expanded", "false");
  preview.setAttribute("aria-label", "Show context preview");
  const setOpen = (open: boolean) => {
    chip.classList.toggle("is-preview-open", open);
    preview.setAttribute("aria-expanded", String(open));
  };
  preview.addEventListener("click", () => {
    setOpen(!chip.classList.contains("is-preview-open"));
  });
  preview.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      preview.focus();
    }
  });
  preview.addEventListener("blur", () => setOpen(false));
}

async function handleClipboardImages(body: HTMLElement, event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean) as File[];
  if (!files.length) return;
  event.preventDefault();
  const itemId = Number(body.dataset.itemID) || 0;
  if (itemId <= 0) return;
  const itemKey = getPaperMeta(itemId).itemKey;
  const session =
    chatStore.getSession(itemId) || chatStore.createSession(itemId);
  if (!session) return;
  for (const file of files) {
    const previewUrl =
      body.ownerDocument.defaultView?.URL?.createObjectURL?.(file) || undefined;
    try {
      const image = await saveLocalClipboardImage({
        itemKey,
        file,
        previewUrl,
        sessionId: session.sessionId,
      });
      addon.data.chat.pendingImages.push(image);
    } catch (error) {
      ztoolkit.log("[Agent] Failed to save pasted image:", error);
    }
  }
  if (isSafeBody(body)) syncContextChips(body);
}

async function attachCurrentPdfPage(
  body: HTMLElement,
  button: HTMLButtonElement,
) {
  if (isGenerating || button.disabled) return;
  const itemId = Number(body.dataset.itemID) || 0;
  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pageNumber = getCurrentReaderPageNumber(reader);
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  const pdfItem = pdfItemId > 0 ? (Zotero.Items.get(pdfItemId) as any) : null;
  const pdfPath = String(pdfItem?.getFilePath?.() || "");
  if (!pageNumber || !pdfPath) {
    button.title = "Could not resolve the current PDF page";
    return;
  }
  const paper = getPaperMeta(itemId);
  const session =
    chatStore.getSession(itemId) || chatStore.createSession(itemId);
  if (!session) return;
  button.disabled = true;
  button.title = `Rendering page ${pageNumber}...`;
  try {
    const absolutePath = await renderPdfPage({
      itemKey: paper.itemKey,
      pdfPath,
      pageNumber,
    });
    const image: LocalImageRef = {
      id: `page-${pageNumber}-${Date.now()}`,
      sessionId: session.sessionId,
      relativePath: `${paper.itemKey}/figures/generated/page-${pageNumber}.png`,
      name: `page-${pageNumber}.png`,
      mimeType: "image/png",
      pageNumber,
      previewUrl: toLocalFileUri(absolutePath),
    };
    addon.data.chat.pendingImages = addon.data.chat.pendingImages.filter(
      (entry) =>
        !(
          entry.sessionId === session.sessionId &&
          entry.relativePath === image.relativePath
        ),
    );
    addon.data.chat.pendingImages.push(image);
    syncContextChips(body);
  } catch (error) {
    button.title = `Page rendering failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    button.disabled = false;
    if (!button.title.startsWith("Page rendering failed")) {
      button.title = "Attach current PDF page";
    }
  }
}

function getCurrentReaderPageNumber(
  reader: _ZoteroTypes.ReaderInstance | null,
): number | undefined {
  const raw = reader as any;
  const zeroBased = [
    raw?.state?.pageIndex,
    raw?._internalReader?._state?.pageIndex,
  ].find((value) => Number.isInteger(Number(value)));
  if (zeroBased !== undefined) return Number(zeroBased) + 1;
  const oneBased = [
    raw?._internalReader?._primaryView?._pdfViewer?.currentPageNumber,
    raw?._internalReader?._iframeWindow?.PDFViewerApplication?.page,
  ].find((value) => Number.isInteger(Number(value)) && Number(value) > 0);
  return oneBased === undefined ? undefined : Number(oneBased);
}

function toLocalFileUri(path: string): string | undefined {
  try {
    return (globalThis as any).PathUtils?.toFileURI?.(path) || undefined;
  } catch {
    return undefined;
  }
}

function syncContextChips(body: HTMLElement) {
  const wrap = body.querySelector(
    "#zoteroagent-context-chips",
  ) as HTMLElement | null;
  if (!wrap) return;
  while (wrap.firstChild) wrap.firstChild.remove();

  const refText = String(addon.data.chat.referenceText || "").trim();
  const responseQuote = String(addon.data.chat.responseQuote || "").trim();
  const itemId = Number(body.dataset.itemID) || 0;
  const currentKey = itemId > 0 ? getPaperMeta(itemId).itemKey : "";
  const mentionedPapers = normalizePaperContexts(
    addon.data.chat.mentionedPapers,
    currentKey,
  );
  const images = addon.data.chat.pendingImages.filter(
    (ref) =>
      ref.relativePath.startsWith(`${currentKey}/`) &&
      ref.sessionId === chatStore.getActiveSessionId(itemId),
  );
  addon.data.chat.mentionedPapers = mentionedPapers;
  if (!refText && !responseQuote && !mentionedPapers.length && !images.length) {
    wrap.style.display = "none";
    return;
  }

  if (refText) wrap.appendChild(createContextChip(body, "text", refText));
  if (responseQuote)
    wrap.appendChild(createContextChip(body, "response", responseQuote));
  for (const paper of mentionedPapers) {
    wrap.appendChild(createPaperContextChip(body, paper));
  }
  for (const image of images) {
    wrap.appendChild(createLocalImageChip(body, image));
  }
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
  // Require at least two non-whitespace characters: a single stray character
  // is almost always an accidental sub-pixel drag (e.g. while clicking a
  // page-citation chip or Send), not an intentional quote.
  if (text.length < 2) return null;
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
  // A genuinely tiny rect (e.g. from a 1px accidental drag) is structurally
  // "non-degenerate" but not something a human would call a selection.
  if (!rect || rect.width + rect.height < 4) return null;
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

function syncSessionHeader(body: HTMLElement, itemId: number): void {
  syncSessionTitle(body, itemId);
  renderDigestStatus(body, itemId, isGenerating);
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
      "button",
    ) as HTMLButtonElement;
    row.type = "button";
    row.className = "zoteroagent-history-item";
    if (chatStore.getActiveSessionId(itemId) === s.sessionId) {
      row.classList.add("active");
    }
    row.dataset.sessionId = s.sessionId;

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
    title.className = "zoteroagent-history-item-title";
    title.textContent = s.title;

    const meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
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
      syncSessionHeader(body, itemId);
      syncLayoutState(body, itemId);
    });

    panel.appendChild(row);
  }
}

function syncLayoutState(body: HTMLElement, itemId: number) {
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
  if (itemId > 0) renderDigestStatus(body, itemId, isGenerating);
  if (itemId > 0)
    void syncModelControls(body, itemId, {
      isGenerating: () => isGenerating,
      isSafeBody,
    });
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
  body: HTMLElement,
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
      const pageNumber = Number(parsed.pageLabel);
      if (Number.isInteger(pageNumber) && pageNumber > 0) {
        const chip = createPageEvidenceChip(doc, body, {
          type: "page",
          raw: `[page ${pageNumber}]`,
          pageNumber,
          pageIndex: pageNumber - 1,
        });
        chip.classList.add("zoteroagent-msg-ref-page");
        label.appendChild(chip);
      } else {
        const pageMeta = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
        pageMeta.className = "zoteroagent-msg-ref-page";
        pageMeta.textContent = `page ${parsed.pageLabel}`;
        label.appendChild(pageMeta);
      }
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

function renderUserPaperContextCard(
  doc: Document,
  papers: PaperContext[] | undefined,
): HTMLElement | null {
  const list = (papers || []).filter((paper) => paper.itemKey);
  if (!list.length) return null;
  const card = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  card.className = "zoteroagent-msg-paper-context";

  const label = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  label.className = "zoteroagent-msg-paper-label";
  label.textContent = "Mentioned Papers";
  card.appendChild(label);

  const body = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  body.className = "zoteroagent-msg-paper-list";
  for (const paper of list) {
    const pill = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    pill.className = "zoteroagent-msg-paper-pill";
    pill.textContent = `@${paper.title || paper.itemKey}`;
    pill.title = [paper.creators, paper.year, paper.itemKey]
      .filter(Boolean)
      .join(" · ");
    body.appendChild(pill);
  }
  card.appendChild(body);
  return card;
}

function renderUserMessage(
  container: HTMLElement,
  msg: ChatMessage,
  body: HTMLElement,
) {
  const doc = container.ownerDocument;
  const parsed = parseUserContent(msg.content);
  const paperContext = renderUserPaperContextCard(doc, msg.contextPapers);
  if (paperContext) container.appendChild(paperContext);
  const imageContext = renderUserImageContext(doc, msg.imageRefs);
  if (imageContext) container.appendChild(imageContext);

  if (parsed.textContext || parsed.responseQuote) {
    const textCard = renderUserContextCard(
      doc,
      body,
      "text",
      parsed.textContext,
    );
    if (textCard) container.appendChild(textCard);
    const responseCard = renderUserContextCard(
      doc,
      body,
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

function renderUserImageContext(
  doc: Document,
  images: LocalImageRef[] | undefined,
): HTMLElement | null {
  if (!images?.length) return null;
  const wrap = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrap.className = "zoteroagent-msg-images";
  for (const image of images) {
    const figure = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    figure.className = "zoteroagent-msg-image";
    if (image.previewUrl) {
      const preview = doc.createElementNS(XHTML_NS, "img") as HTMLImageElement;
      preview.src = image.previewUrl;
      preview.alt = image.name;
      figure.appendChild(preview);
    } else {
      const missing = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
      missing.className = "zoteroagent-msg-image-missing";
      missing.textContent = "Local screenshot";
      figure.appendChild(missing);
    }
    const name = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    name.className = "zoteroagent-msg-image-name";
    name.textContent = image.name;
    figure.appendChild(name);
    wrap.appendChild(figure);
  }
  return wrap;
}
