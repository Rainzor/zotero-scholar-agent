import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { renderMarkdown } from "../utils/markdown";
import { estimateTokens } from "../utils/token-estimate";
import type {
  ChatMessage,
  ChatSession,
  CodexActivity,
  TokenUsage,
} from "../addon";
import { chatStore } from "../services/chat-store";
import {
  appendConversationTurn,
  appendVaultLog,
  commitVaultChanges,
  ensurePaperVault,
  listVaultPapers,
  readPaperMemory,
  runCodexTurn,
  searchVaultMemory,
  type CodexEvent,
  type PaperVaultMeta,
  type RunningLineProcess,
  type VaultSearchHit,
} from "../services/codex";

let sectionPaneID: string | null = null;
let activeBody: HTMLElement | null = null;
let activeCodexProcess: RunningLineProcess | null = null;
let isGenerating = false;
const resizeObserverMap = new WeakMap<HTMLElement, ResizeObserver>();
const pollTimerMap = new WeakMap<HTMLElement, number>();
const lastWidthMap = new WeakMap<HTMLElement, number>();
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
  refresh.title = "Refresh";
  refresh.textContent = "\u21bb";

  toolbar.appendChild(search);
  toolbar.appendChild(refresh);

  const bodyDiv = doc.createElementNS(XHTML, "div") as HTMLElement;
  bodyDiv.id = "zoteroagent-memory-body";
  bodyDiv.className = "zoteroagent-memory-body";

  panel.appendChild(toolbar);
  panel.appendChild(bodyDiv);
  return panel;
}

function switchChatView(body: HTMLElement, mode: "chat" | "memory") {
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
  if (isMemory) void renderMemoryBrowse(body);
}

function getMemoryBodyEl(body: HTMLElement): HTMLElement | null {
  return body.querySelector("#zoteroagent-memory-body") as HTMLElement | null;
}

async function renderMemoryBrowse(body: HTMLElement) {
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
  } catch (error) {
    host.appendChild(memoryNotice(doc, `Failed to read vault: ${String(error)}`));
    return;
  }

  if (currentItemId > 0) {
    const currentMeta = getPaperMeta(currentItemId);
    const header = doc.createElementNS(XHTML, "div") as HTMLElement;
    header.className = "zoteroagent-memory-section-title";
    header.textContent = "Current paper";
    host.appendChild(header);
    await appendPaperMemoryCard(host, currentKey, currentMeta.title);
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
    const row = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
    row.className = "zoteroagent-memory-list-item";
    if (paper.itemKey === currentKey) row.classList.add("is-current");
    const title = doc.createElementNS(XHTML, "span") as HTMLElement;
    title.className = "zoteroagent-memory-list-title";
    title.textContent = paper.title || paper.itemKey;
    const sub = doc.createElementNS(XHTML, "span") as HTMLElement;
    sub.className = "zoteroagent-memory-list-sub";
    sub.textContent = [paper.creators, paper.year].filter(Boolean).join(" · ");
    row.appendChild(title);
    if (sub.textContent) row.appendChild(sub);
    row.addEventListener("click", () => {
      void renderMemoryDetail(body, paper.itemKey, paper.title || paper.itemKey);
    });
    list.appendChild(row);
  }
  host.appendChild(list);
}

async function appendPaperMemoryCard(
  host: HTMLElement,
  itemKey: string,
  title: string,
) {
  const doc = host.ownerDocument;
  const card = doc.createElementNS(XHTML, "div") as HTMLElement;
  card.className = "zoteroagent-memory-card";
  const content = await readPaperMemory(itemKey);
  const inner = doc.createElementNS(XHTML, "div") as HTMLElement;
  inner.className = "zoteroagent-memory-content markdown-body";
  if (content.trim()) {
    inner.innerHTML = renderMarkdown(content);
  } else {
    inner.appendChild(
      memoryNotice(
        doc,
        `No memory yet for "${title}". Ask about it in Chat and Codex will write one.`,
      ),
    );
  }
  card.appendChild(inner);
  host.appendChild(card);
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

  await appendPaperMemoryCard(host, itemKey, title);
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

/**
 * Accumulate Codex command-execution steps from the raw event stream so the
 * turn can show what Codex actually did (grep/cat/apply_patch/git...).
 * Returns true when the activity list changed.
 */
function collectCodexActivity(
  list: CodexActivity[],
  byId: Map<string, CodexActivity>,
  event: CodexEvent,
): boolean {
  const item = (event as any).item;
  if (!item || item.type !== "command_execution") return false;
  const id = String(item.id || "");
  const command = String(item.command || "").trim();
  if (event.type === "item.started") {
    const entry: CodexActivity = {
      command: command || "command",
      status: "in_progress",
    };
    list.push(entry);
    if (id) byId.set(id, entry);
    return true;
  }
  if (event.type === "item.completed") {
    let entry = id ? byId.get(id) : undefined;
    if (!entry) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].status === "in_progress") {
          entry = list[i];
          break;
        }
      }
    }
    if (!entry) {
      entry = { command: command || "command" };
      list.push(entry);
    }
    const code = item.exit_code;
    entry.exitCode = typeof code === "number" ? code : null;
    entry.status =
      String(item.status || "") ||
      (typeof code === "number" && code !== 0 ? "failed" : "completed");
    if (command) entry.command = command;
    return true;
  }
  return false;
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
  textarea.placeholder = "Ask about this paper...";

  const actionsRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  actionsRow.id = "zoteroagent-actions-row";
  actionsRow.className = "zoteroagent-actions-row";

  const actionsRight = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  actionsRight.className = "zoteroagent-actions-right";

  const sendBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
  sendBtn.id = "zoteroagent-chat-send";
  sendBtn.className = "zoteroagent-send-button";
  sendBtn.textContent = "Send";

  actionsRight.appendChild(sendBtn);
  actionsRow.appendChild(actionsRight);

  composeArea.appendChild(textarea);
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
  headerWrap.appendChild(sessionRow);
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
  quotePopup.textContent = "❞ Quote";
  container.appendChild(quotePopup);
  body.appendChild(container);

  bindChatEvents(body);
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
    .querySelector("#zoteroagent-memory-refresh")
    ?.addEventListener("click", () => {
      void renderMemoryBrowse(body);
    });
  body
    .querySelector("#zoteroagent-chat-send")
    ?.addEventListener("click", () => {
      void submitQuestion(body);
    });
  body
    .querySelector("#zoteroagent-chat-input")
    ?.addEventListener("keydown", (event) => {
      const ke = event as KeyboardEvent;
      if (ke.key === "Enter" && !ke.shiftKey) {
        event.preventDefault();
        void submitQuestion(body);
      }
    });
  body
    .querySelector("#zoteroagent-session-select")
    ?.addEventListener("change", (event) => {
      const sessionId = (event.target as HTMLSelectElement).value;
      const itemId = Number(body.dataset.itemID);
      if (itemId > 0 && sessionId) {
        chatStore.setActiveSession(itemId, sessionId);
        renderMessages(body, itemId);
        syncLayoutState(body, itemId);
      }
    });
  body
    .querySelector("#zoteroagent-session-new")
    ?.addEventListener("click", () => {
      const itemId = Number(body.dataset.itemID);
      if (itemId <= 0) return;
      const session = chatStore.createSession(itemId);
      if (!session) return;
      body.dataset.chatMode = "chat";
      syncSessionSelector(body, itemId);
      renderMessages(body, itemId);
      syncLayoutState(body, itemId);
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
        renderMessages(body, itemId);
        syncSessionSelector(body, itemId);
        syncLayoutState(body, itemId);
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
  bindAssistantSelectionEvents(body);
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
      activeCodexProcess = null;
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
  if (activeCodexProcess) {
    try {
      activeCodexProcess.kill();
    } catch (_e) {
      /* ignore */
    }
    activeCodexProcess = null;
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

function getPaperMeta(itemId: number): {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
} {
  try {
    const item = Zotero.Items.get(itemId) as any;
    const creators = (item?.getCreators?.() || [])
      .map((creator: any) =>
        [creator?.firstName, creator?.lastName].filter(Boolean).join(" ").trim(),
      )
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const date = String(item?.getField?.("date") || "");
    return {
      itemKey: String(item?.key || itemId),
      title: String(
        item?.getField?.("title") ||
          item?.getDisplayTitle?.() ||
          `Item ${itemId}`,
      ),
      creators,
      year: (date.match(/\b(18|19|20)\d{2}\b/) || [""])[0],
    };
  } catch (_e) {
    return {
      itemKey: String(itemId),
      title: `Item ${itemId}`,
      creators: "",
      year: "",
    };
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

  // The item pane body is shared across papers in the window. This generation
  // runs asynchronously, so the user may switch papers while it streams. Data
  // is always persisted to the chatStore under `itemId`, but DOM updates must
  // only touch the pane while it is still showing this same paper, otherwise
  // streamed tokens and the final render would bleed into (and overwrite) the
  // conversation the user has since switched to.
  const isActivePane = () =>
    isSafeBody(body) && Number(body.dataset.itemID) === itemId;

  const refText = addon.data.chat.referenceText;
  const responseQuote = addon.data.chat.responseQuote;
  const contextBlocks: string[] = [];
  if (refText) contextBlocks.push(`${SELECTED_TEXT_PREFIX}${refText}`);
  if (responseQuote)
    contextBlocks.push(`${RESPONSE_QUOTE_PREFIX}${responseQuote}`);
  const displayContent = contextBlocks.length
    ? `${contextBlocks.join("\n\n")}\n\n${question}`
    : question;

  chatStore.addMessage(itemId, {
    role: "user",
    content: displayContent,
  });
  input.value = "";
  addon.data.chat.referenceText = "";
  addon.data.chat.responseQuote = "";
  syncContextChips(body);
  body.dataset.chatMode = "chat";
  syncLayoutState(body, itemId);

  const assistant: ChatMessage = {
    role: "assistant",
    content: "",
    reasoning: "",
    model: getModelLabel(),
  };
  chatStore.addMessage(itemId, assistant);
  renderMessages(body, itemId);
  setGenerating(body, true);
  showAgentStatus(body, "Preparing Codex...");

  const reader = getActiveReader() || addon.data.popup.currentReader;
  const pdfItemId = resolvePdfAttachmentItemId(itemId, reader);
  if (pdfItemId <= 0) {
    assistant.content =
      "No valid PDF attachment found. Please confirm the item has an accessible PDF attachment in Zotero.";
    setGenerating(body, false);
    if (isActivePane()) renderMessages(body, itemId);
    return;
  }

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
  const session = chatStore.getSession(itemId);
  const paperMeta = getPaperMeta(itemId);

  try {
    let lastRefresh = 0;
    await ensurePaperVault({
      itemId,
      itemKey: paperMeta.itemKey,
      title: paperMeta.title,
      creators: paperMeta.creators,
      year: paperMeta.year,
      pdfItemId,
      reader,
      onStatus: (text) => {
        if (isActivePane()) showAgentStatus(body, text);
      },
    });
    const memoryBefore = await readPaperMemory(paperMeta.itemKey);
    const prompt = buildCodexPrompt({
      itemKey: paperMeta.itemKey,
      title: paperMeta.title,
      creators: paperMeta.creators,
      year: paperMeta.year,
      question: aiQuestion,
    });
    const activities: CodexActivity[] = [];
    const activityById = new Map<string, CodexActivity>();
    const result = await runCodexTurn({
      prompt,
      threadId: session?.codexThreadId || "",
      sandbox: "workspace-write",
      onStatus: (text) => {
        if (isActivePane()) showAgentStatus(body, text);
      },
      onProcess: (proc) => {
        activeCodexProcess = proc;
      },
      onEvent: (event) => {
        if (collectCodexActivity(activities, activityById, event)) {
          assistant.activities = activities.slice();
        }
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
    });
    assistant.content = result.content || assistant.content;
    assistant.reasoning = result.reasoning || assistant.reasoning;
    if (result.usage) assistant.usage = result.usage;
    if (activities.length) assistant.activities = activities.slice();
    if (result.threadId) {
      chatStore.updateCodexThreadId(itemId, result.threadId, session?.sessionId);
    }
    await appendConversationTurn({
      itemKey: paperMeta.itemKey,
      sessionId: session?.sessionId || chatStore.getActiveSessionId(itemId),
      userMessage: displayContent,
      assistantMessage: assistant.content,
      codexThreadId: result.threadId,
    });
    const memoryAfter = await readPaperMemory(paperMeta.itemKey);
    assistant.memoryUpdated = memoryAfter.trim() !== memoryBefore.trim();
    assistant.committed = await commitVaultChanges(
      `turn: ${paperMeta.itemKey} ${session?.sessionId || ""}`.trim(),
    );
  } catch (e: any) {
    await appendVaultLog("chat-turn-error", e?.message || String(e), {
      itemId,
      itemKey: paperMeta.itemKey,
      title: paperMeta.title,
      sessionId: session?.sessionId,
      codexThreadId: session?.codexThreadId,
    });
    if (!assistant.content && !assistant.reasoning) {
      assistant.content = `[Error] ${e?.message || String(e)}`;
    }
  }
  chatStore.touchSession(itemId);
  setGenerating(body, false);
  if (isActivePane()) renderMessages(body, itemId);
  maybeGenerateSessionTitleLocal(body, itemId, question);
}

function buildCodexPrompt(options: {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  question: string;
}): string {
  const meta = [
    `In-focus paper: ${options.itemKey}`,
    `Title: ${options.title || options.itemKey}`,
    options.creators ? `Authors: ${options.creators}` : "",
    options.year ? `Year: ${options.year}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `${meta}\n\nUser question:\n${options.question.trim()}`;
}

function maybeGenerateSessionTitleLocal(
  body: HTMLElement,
  itemId: number,
  question: string,
) {
  if (!chatStore.needsAutoTitle(itemId)) return;
  const title = question
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .replace(/[。！？,.，；;:：\s]+$/g, "");
  if (!title) return;
  chatStore.renameSession(itemId, title);
  if (isSafeBody(body) && Number(body.dataset.itemID) === itemId)
    syncSessionSelector(body, itemId);
}

// ===================== Rendering =====================

function getModelLabel(): string {
  return "Codex";
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
  return msg.model || "Codex";
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

function buildActivityBlock(
  doc: Document,
  activities: CodexActivity[],
): HTMLElement {
  const details = doc.createElementNS(XHTML_NS, "details") as HTMLElement;
  details.className = "zoteroagent-activity";
  const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
  summary.className = "zoteroagent-activity-summary";
  summary.textContent = `Codex activity · ${activities.length} step${
    activities.length === 1 ? "" : "s"
  }`;
  details.appendChild(summary);
  const list = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  list.className = "zoteroagent-activity-list";
  for (const activity of activities) {
    const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    row.className = "zoteroagent-activity-row";
    const status = String(activity.status || "").toLowerCase();
    const badge = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    badge.className = `zoteroagent-activity-badge ${
      status === "failed" ? "is-failed" : status === "in_progress" ? "is-running" : "is-ok"
    }`;
    badge.textContent =
      status === "failed" ? "fail" : status === "in_progress" ? "run" : "ok";
    const cmd = doc.createElementNS(XHTML_NS, "code") as HTMLElement;
    cmd.className = "zoteroagent-activity-cmd";
    cmd.textContent = truncateMiddle(activity.command || "command", 220);
    row.appendChild(badge);
    row.appendChild(cmd);
    list.appendChild(row);
  }
  details.appendChild(list);
  return details;
}

function buildTurnFooter(doc: Document, msg: ChatMessage): HTMLElement {
  const footer = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  footer.className = "zoteroagent-turn-footer";
  if (msg.memoryUpdated) {
    const chip = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    chip.className = "zoteroagent-turn-chip is-memory";
    chip.textContent = "Memory updated";
    footer.appendChild(chip);
  }
  if (msg.committed) {
    const chip = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    chip.className = "zoteroagent-turn-chip is-commit";
    chip.textContent = "Saved to vault";
    footer.appendChild(chip);
  }
  return footer;
}

function truncateMiddle(text: string, max: number): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${clean.slice(0, head)}...${clean.slice(clean.length - tail)}`;
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
        if (msg.activities?.length) {
          main.appendChild(buildActivityBlock(doc, msg.activities));
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
      } else {
        renderUserMessage(inner, msg);
      }

      main.appendChild(inner);

      if (msg.role === "assistant" && (msg.memoryUpdated || msg.committed)) {
        main.appendChild(buildTurnFooter(doc, msg));
      }

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
      renderMessages(body, itemId);
      syncSessionSelector(body, itemId);
      syncLayoutState(body, itemId);
    });

    panel.appendChild(row);
  }
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

function renderUserMessage(container: HTMLElement, msg: ChatMessage) {
  const doc = container.ownerDocument;
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
