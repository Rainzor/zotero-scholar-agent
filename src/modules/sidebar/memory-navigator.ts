import type { PaperVaultMeta } from "../../services/codex/vault-format";
import type { TopicNoteSummary } from "../../services/topic-notes";
import type { TopicSelectionController } from "./topic-selection";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Context passed into the Memory navigator. Keeps this module decoupled from
 * sidebar.ts internals: the caller supplies data plus bound callbacks.
 */
export interface MemoryNavigatorContext {
  host: HTMLElement;
  papers: PaperVaultMeta[];
  topics: TopicNoteSummary[];
  currentKey: string;
  /** Current paper metadata, used to pin its row even when not yet in the vault. */
  currentPaper?: PaperVaultMeta;
  /** Topic-creation selection state (drives checkboxes + sticky bar). */
  selection: TopicSelectionController;
  onToggleSelect(key: string, checked: boolean): void;
  onOpenPaper(itemKey: string, title: string): void;
  onOpenTopic(slug: string): void;
  /** Enter selection mode ("+ New topic"). */
  onNewTopic(): void;
  /** Optional notice builder (reuses sidebar's memoryNotice styling). */
  buildNotice(text: string): HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(XHTML_NS, tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  return node;
}

function sectionTitle(doc: Document, text: string): HTMLElement {
  const title = el(doc, "div", "zoteroagent-memory-section-title");
  title.textContent = text;
  return title;
}

function paperSubline(paper: PaperVaultMeta): string {
  return [paper.rating ? `${paper.rating}/5` : "", paper.creators, paper.year]
    .filter(Boolean)
    .join(" · ");
}

function buildPaperRow(
  ctx: MemoryNavigatorContext,
  paper: PaperVaultMeta,
  opts: { isCurrent?: boolean } = {},
): HTMLElement {
  const doc = ctx.host.ownerDocument;
  const selecting = ctx.selection.isActive();
  const wrapper = el(doc, "div", "zoteroagent-memory-list-row");
  if (!selecting) wrapper.classList.add("no-select");

  if (selecting) {
    const select = el(doc, "input", "zoteroagent-topic-paper-select");
    select.type = "checkbox";
    select.checked = ctx.selection.has(paper.itemKey);
    select.title = `Include ${paper.title || paper.itemKey} in Topic Note`;
    select.setAttribute("aria-label", select.title);
    select.addEventListener("change", () => {
      ctx.onToggleSelect(paper.itemKey, select.checked);
    });
    wrapper.appendChild(select);
  }

  const row = el(doc, "button", "zoteroagent-memory-list-item");
  row.type = "button";
  if (opts.isCurrent) row.classList.add("is-current");
  const title = el(doc, "span", "zoteroagent-memory-list-title");
  title.textContent = paper.title || paper.itemKey;
  row.appendChild(title);
  const sub = paperSubline(paper);
  if (sub) {
    const subEl = el(doc, "span", "zoteroagent-memory-list-sub");
    subEl.textContent = sub;
    row.appendChild(subEl);
  }
  row.addEventListener("click", () => {
    ctx.onOpenPaper(paper.itemKey, paper.title || paper.itemKey);
  });

  wrapper.appendChild(row);
  return wrapper;
}

function buildTopicRow(
  ctx: MemoryNavigatorContext,
  topic: TopicNoteSummary,
): HTMLElement {
  const doc = ctx.host.ownerDocument;
  const row = el(doc, "button", "zoteroagent-memory-list-item");
  row.type = "button";
  const title = el(doc, "span", "zoteroagent-memory-list-title");
  title.textContent = topic.title;
  const sub = el(doc, "span", "zoteroagent-memory-list-sub");
  sub.textContent = `${topic.paperItemKeys.length} papers`;
  row.appendChild(title);
  row.appendChild(sub);
  row.addEventListener("click", () => ctx.onOpenTopic(topic.slug));
  return row;
}

/** Header row for "All papers (N)" with an optional "+ New topic" trigger. */
function buildAllPapersHeader(ctx: MemoryNavigatorContext): HTMLElement {
  const doc = ctx.host.ownerDocument;
  const header = el(doc, "div", "zoteroagent-memory-list-header");
  header.appendChild(sectionTitle(doc, `All papers (${ctx.papers.length})`));
  if (!ctx.selection.isActive() && ctx.papers.length) {
    const newTopic = el(doc, "button", "zoteroagent-topic-new");
    newTopic.type = "button";
    newTopic.textContent = "+ New topic";
    newTopic.title = "Select papers to group into a Topic Note";
    newTopic.addEventListener("click", () => ctx.onNewTopic());
    header.appendChild(newTopic);
  }
  return header;
}

/**
 * Render the compact, list-first Memory navigator: a pinned current-paper row,
 * a topics group, and the all-papers list. The full record is NOT rendered
 * here — clicking a row opens the detail view via ctx.onOpenPaper.
 */
export function renderMemoryNavigator(ctx: MemoryNavigatorContext): void {
  const { host } = ctx;
  const doc = host.ownerDocument;
  host.textContent = "";

  // Current paper — pinned as a single compact row (not the full card).
  const pinned =
    ctx.papers.find((p) => p.itemKey === ctx.currentKey) || ctx.currentPaper;
  if (ctx.currentKey && pinned) {
    host.appendChild(sectionTitle(doc, "Current paper"));
    const current = el(doc, "div", "zoteroagent-memory-current");
    current.appendChild(buildPaperRow(ctx, pinned, { isCurrent: true }));
    host.appendChild(current);
  }

  // Topics group.
  if (ctx.topics.length) {
    host.appendChild(sectionTitle(doc, `Topics (${ctx.topics.length})`));
    const topicList = el(doc, "div", "zoteroagent-memory-list");
    for (const topic of ctx.topics)
      topicList.appendChild(buildTopicRow(ctx, topic));
    host.appendChild(topicList);
  }

  // All papers — current paper excluded to avoid a double render.
  const rest = ctx.papers.filter((p) => p.itemKey !== ctx.currentKey);
  host.appendChild(buildAllPapersHeader(ctx));
  if (!ctx.papers.length) {
    host.appendChild(
      ctx.buildNotice(
        "No papers in the vault yet. Ask a question in Chat to let Codex build memory.",
      ),
    );
    return;
  }
  const list = el(doc, "div", "zoteroagent-memory-list");
  for (const paper of rest) list.appendChild(buildPaperRow(ctx, paper));
  host.appendChild(list);
}
