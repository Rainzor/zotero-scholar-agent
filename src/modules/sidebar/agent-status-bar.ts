import {
  AGENT_STATUS_NOTICE_AUTO_DISMISS_MS,
  getAgentStatusPresentation,
  type AgentStatusKind,
} from "../../services/agent-status";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SLOT_ID = "zoteroagent-agent-status-slot";

export function mountAgentStatusSlot(
  doc: Document,
  headerWrap: HTMLElement,
): HTMLElement {
  const existing = headerWrap.querySelector(
    `#${SLOT_ID}`,
  ) as HTMLElement | null;
  if (existing) return existing;
  const slot = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  slot.id = SLOT_ID;
  headerWrap.appendChild(slot);
  return slot;
}

export function isTokenCurrent(slot: HTMLElement, token: number): boolean {
  return Number(slot.dataset.statusToken) === token;
}

function nextToken(slot: HTMLElement): number {
  const next = (Number(slot.dataset.statusToken) || 0) + 1;
  slot.dataset.statusToken = String(next);
  return next;
}

function buildStatusPill(
  doc: Document,
  kind: AgentStatusKind,
  text: string,
  onCancel?: () => void,
): HTMLElement {
  const presentation = getAgentStatusPresentation(kind);
  const pill = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  pill.className = presentation.className;
  pill.dataset.animated = String(presentation.animated);
  const textEl = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  textEl.className = "zoteroagent-agent-status-text";
  textEl.textContent = text || "Generating...";
  pill.appendChild(textEl);
  if (onCancel) {
    const cancel = doc.createElementNS(
      XHTML_NS,
      "button",
    ) as HTMLButtonElement;
    cancel.type = "button";
    cancel.className = "zoteroagent-agent-status-cancel";
    cancel.textContent = "Stop";
    cancel.addEventListener("click", onCancel);
    pill.appendChild(cancel);
  }
  return pill;
}

// Returns a token the caller can pass to `isTokenCurrent` before writing a
// later update, so a stale in-flight status write can detect it lost a race
// (e.g. to a Cancel) and skip itself instead of clobbering a newer message.
export function showBusyStatus(
  slot: HTMLElement,
  text: string,
  onCancel: () => void,
): number {
  const token = nextToken(slot);
  slot.textContent = "";
  slot.appendChild(
    buildStatusPill(slot.ownerDocument, "progress", text, onCancel),
  );
  return token;
}

export function showNoticeStatus(slot: HTMLElement, text: string): number {
  const token = nextToken(slot);
  slot.textContent = "";
  slot.appendChild(buildStatusPill(slot.ownerDocument, "notice", text));
  slot.ownerDocument.defaultView?.setTimeout(() => {
    if (isTokenCurrent(slot, token)) clearAgentStatus(slot);
  }, AGENT_STATUS_NOTICE_AUTO_DISMISS_MS);
  return token;
}

export function clearAgentStatus(slot: HTMLElement): void {
  slot.textContent = "";
  delete slot.dataset.statusToken;
}
