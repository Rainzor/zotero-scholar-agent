import type { ChatMessage } from "../../addon";
import { renderMarkdown } from "../../utils/markdown";
import { buildEmptyChatState } from "./empty-state";
import {
  buildMessageScrollAnchor,
  captureMessageScrollAnchor,
  restoreMessageScrollAnchor,
} from "./scroll";
import {
  buildTurnDetailsBlock,
  buildTurnFooter,
  openTurnDetail,
} from "./turn-details-view";
import { buildAgentActionCard, type ActionCardCommand } from "./action-card";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export type MessageListRenderOptions = {
  body: HTMLElement;
  itemId: number;
  messages: ChatMessage[];
  paperTitle: string;
  renderUserMessage: (
    container: HTMLElement,
    message: ChatMessage,
    body: HTMLElement,
  ) => void;
  enhancePageEvidence: (root: HTMLElement) => void;
  buildKeywordSuggestions: (
    doc: Document,
    body: HTMLElement,
    itemId: number,
    messageIndex: number,
    suggestions: string[],
  ) => HTMLElement;
  buildTierSuggestion: (
    doc: Document,
    body: HTMLElement,
    itemId: number,
    messageIndex: number,
    suggestion: NonNullable<ChatMessage["tierSuggestion"]>,
  ) => HTMLElement;
  createMetaRow: (
    doc: Document,
    message: ChatMessage,
    body: HTMLElement,
    itemId: number,
  ) => HTMLElement;
  onSuggestion: (suggestion: string) => void;
  onActionCommand: (actionId: string, command: ActionCardCommand) => void;
  syncSessionHeader: () => void;
};

export function renderMessageList(options: MessageListRenderOptions): void {
  const { body, itemId, messages } = options;
  const container = body.querySelector(
    "#zoteroagent-chat-messages",
  ) as HTMLElement | null;
  if (!container) return;
  const scrollAnchor = captureMessageScrollAnchor(container);
  container.replaceChildren();

  const doc = body.ownerDocument;
  if (!messages.length) {
    container.appendChild(
      buildEmptyChatState(doc, options.paperTitle, options.onSuggestion),
    );
  }
  for (let index = 0; index < messages.length; index += 1) {
    try {
      container.appendChild(buildMessage(options, messages[index], index));
    } catch (error) {
      ztoolkit.log("[Agent] renderMessages: skipped message", index, error);
    }
  }
  options.syncSessionHeader();
  restoreMessageScrollAnchor(container, scrollAnchor);
}

function buildMessage(
  options: MessageListRenderOptions,
  message: ChatMessage,
  index: number,
): HTMLElement {
  const { body, itemId } = options;
  const doc = body.ownerDocument;
  const wrapper = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  wrapper.className = `zoteroagent-message ${
    message.role === "user" ? "user" : "assistant"
  }`;
  wrapper.dataset.msgIndex = String(index);
  wrapper.dataset.messageAnchor = buildMessageScrollAnchor(message, index);

  const row = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  row.className = "zoteroagent-message-row";
  const main = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  main.className = "zoteroagent-message-main";
  main.appendChild(createMessageHeader(doc, message));

  if (message.role === "assistant") {
    wrapper.dataset.rawContent = message.content || "";
  }
  const content = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  content.className = "zoteroagent-message-content";
  if (message.role === "assistant") {
    try {
      content.innerHTML = renderMarkdown(message.content);
    } catch {
      content.textContent = message.content;
    }
    main.appendChild(content);
    options.enhancePageEvidence(content);
  } else {
    options.renderUserMessage(content, message, body);
    main.appendChild(content);
  }

  if (message.role === "assistant" && message.action) {
    main.appendChild(
      buildAgentActionCard(doc, message.action, (command) =>
        options.onActionCommand(message.action!.id, command),
      ),
    );
  }

  if (message.role === "assistant" && message.keywordSuggestions?.length) {
    main.appendChild(
      options.buildKeywordSuggestions(
        doc,
        body,
        itemId,
        index,
        message.keywordSuggestions,
      ),
    );
  }
  if (message.role === "assistant" && message.tierSuggestion) {
    main.appendChild(
      options.buildTierSuggestion(
        doc,
        body,
        itemId,
        index,
        message.tierSuggestion,
      ),
    );
  }
  if (message.role === "assistant") {
    const footer = buildTurnFooter(doc, message, (kind) => {
      openTurnDetail(main, kind);
    });
    if (footer.childNodes.length) main.appendChild(footer);
    const details = buildTurnDetailsBlock(doc, message, {
      enhancePageEvidence: options.enhancePageEvidence,
    });
    if (details) main.appendChild(details);
  }
  if (message.timestamp) {
    main.appendChild(options.createMetaRow(doc, message, body, itemId));
  }

  row.appendChild(createMessageAvatar(doc, message));
  row.appendChild(main);
  wrapper.appendChild(row);
  return wrapper;
}

export function createMessageAvatar(
  doc: Document,
  message: Pick<ChatMessage, "role" | "model">,
): HTMLElement {
  const avatar = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  avatar.className = `zoteroagent-msg-avatar ${
    message.role === "user" ? "user" : "assistant"
  }`;
  avatar.setAttribute("aria-hidden", "true");
  const inner = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
  inner.className = "zoteroagent-msg-avatar-inner";
  inner.textContent = avatarInitial(message);
  avatar.appendChild(inner);
  return avatar;
}

export function createMessageHeader(
  doc: Document,
  message: Pick<ChatMessage, "role" | "model"> & { timestamp?: number },
): HTMLElement {
  const header = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  header.className = "zoteroagent-msg-header";
  const title = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  title.className = "zoteroagent-msg-title";
  title.textContent =
    message.role === "user" ? "You" : message.model || "Codex";
  header.appendChild(title);
  if (message.timestamp) {
    const timestamp = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
    timestamp.className = "zoteroagent-msg-subtime";
    timestamp.textContent = formatTimestamp(message.timestamp);
    header.appendChild(timestamp);
  }
  return header;
}

function avatarInitial(message: Pick<ChatMessage, "role" | "model">): string {
  if (message.role === "user") return "Y";
  const match = (message.model || "AI").trim().match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "A";
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}
