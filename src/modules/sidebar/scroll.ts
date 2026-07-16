export function isNearBottom(element: HTMLElement, threshold = 60): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
  );
}

export function scrollToBottomIfPinned(
  element: HTMLElement,
  wasPinned: boolean,
): void {
  if (wasPinned) element.scrollTop = element.scrollHeight;
}

export type MessageScrollAnchor =
  | { pinned: true }
  | {
      pinned: false;
      scrollTop: number;
      messageAnchor?: string;
      messageOffset?: number;
    };

export function captureMessageScrollAnchor(
  container: HTMLElement,
): MessageScrollAnchor {
  if (isNearBottom(container)) return { pinned: true };
  const viewportTop = container.getBoundingClientRect().top;
  const messages = Array.from(
    container.querySelectorAll(".zoteroagent-message"),
  ) as HTMLElement[];
  const message = messages.find(
    (entry) => entry.getBoundingClientRect().bottom > viewportTop,
  );
  if (!message) {
    return { pinned: false, scrollTop: container.scrollTop };
  }
  return {
    pinned: false,
    scrollTop: container.scrollTop,
    messageAnchor: message.dataset.messageAnchor,
    messageOffset: message.getBoundingClientRect().top - viewportTop,
  };
}

export function restoreMessageScrollAnchor(
  container: HTMLElement,
  anchor: MessageScrollAnchor,
): void {
  if (anchor.pinned) {
    container.scrollTop = container.scrollHeight;
    return;
  }
  const message = anchor.messageAnchor
    ? (container.querySelector(
        `.zoteroagent-message[data-message-anchor="${anchor.messageAnchor}"]`,
      ) as HTMLElement | null)
    : null;
  if (message && typeof anchor.messageOffset === "number") {
    const nextOffset =
      message.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    container.scrollTop = Math.max(
      0,
      anchor.scrollTop + nextOffset - anchor.messageOffset,
    );
    return;
  }
  container.scrollTop = anchor.scrollTop;
}

export function buildMessageScrollAnchor(
  message: {
    role: string;
    timestamp?: number;
    content?: string;
    model?: string;
  },
  _fallbackIndex: number,
): string {
  return message.timestamp
    ? `${message.role}-${message.timestamp}`
    : `${message.role}-content-${hashAnchorText(
        `${message.model || ""}\u0000${message.content || ""}`,
      )}`;
}

function hashAnchorText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
