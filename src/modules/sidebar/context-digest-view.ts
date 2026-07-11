import { chatStore } from "../../services/chat-store";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function renderContextDigestStatus(
  body: HTMLElement,
  itemId: number,
  isGenerating: boolean,
  transientText?: string,
): void {
  const bar = body.querySelector(
    "#zoteroagent-context-digest-bar",
  ) as HTMLElement | null;
  if (!bar) return;
  while (bar.firstChild) bar.firstChild.remove();
  const session = chatStore.getSession(itemId);
  const hasDigest = Boolean(session?.contextDigest?.trim());
  const busy = body.dataset.contextDigestBusy === "true";
  if (!session || (!hasDigest && !busy && !transientText)) {
    bar.style.display = "none";
    return;
  }

  const doc = bar.ownerDocument;
  bar.style.display = "flex";
  const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  row.className = "zoteroagent-context-digest-row";
  const chip = doc.createElementNS(
    XHTML_NS,
    hasDigest ? "button" : "span",
  ) as HTMLElement;
  chip.className = `zoteroagent-context-digest-chip ${
    hasDigest ? "is-compacted" : ""
  }`;
  if (transientText) {
    chip.textContent = transientText;
  } else {
    const covered = (session.contextDigestUpToMessageIndex ?? -1) + 1;
    chip.textContent = `Context compacted · covers ${Math.max(0, covered)} turns`;
  }
  row.appendChild(chip);
  bar.appendChild(row);

  if (!hasDigest) return;
  const details = doc.createElementNS(
    XHTML_NS,
    "details",
  ) as HTMLDetailsElement;
  details.className = "zoteroagent-context-digest-debug";
  const summary = doc.createElementNS(XHTML_NS, "summary") as HTMLElement;
  summary.textContent = "Hidden Context Digest";
  details.appendChild(summary);
  const pre = doc.createElementNS(XHTML_NS, "pre") as HTMLElement;
  pre.textContent = session.contextDigest || "";
  details.appendChild(pre);
  bar.appendChild(details);

  const button = chip as HTMLButtonElement;
  button.type = "button";
  button.disabled = isGenerating;
  button.setAttribute("aria-expanded", "false");
  button.title = "Show hidden Context Digest";
  button.addEventListener("click", () => {
    details.open = !details.open;
    button.setAttribute("aria-expanded", String(details.open));
    if (details.open) {
      (details.querySelector("summary") as HTMLElement | null)?.focus();
    }
  });
  details.addEventListener("toggle", () => {
    button.setAttribute("aria-expanded", String(details.open));
  });
}
