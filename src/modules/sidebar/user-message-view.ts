import type { ChatMessage, PaperContext } from "../../addon";
import type { LocalImageRef } from "../../services/local-images";
import type { PageEvidenceRef } from "../../services/page-evidence";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SELECTED_TEXT_PREFIX = "Selected Text: ";
const RESPONSE_QUOTE_PREFIX = "Response Quote: ";

export type UserMessageRenderOptions = {
  parseQuotedPageContext: (raw: string) => {
    pageLabel: string;
    text: string;
  };
  createPageEvidenceChip: (
    doc: Document,
    body: HTMLElement,
    reference: PageEvidenceRef,
  ) => HTMLButtonElement;
};

export function renderUserMessage(
  container: HTMLElement,
  message: ChatMessage,
  body: HTMLElement,
  options: UserMessageRenderOptions,
): void {
  const doc = container.ownerDocument;
  const parsed = parseUserContent(message.content);
  const paperContext = renderPaperContext(doc, message.contextPapers);
  if (paperContext) container.appendChild(paperContext);
  const imageContext = renderImageContext(doc, message.imageRefs);
  if (imageContext) container.appendChild(imageContext);

  if (parsed.textContext || parsed.responseQuote) {
    const textCard = renderContextCard(
      doc,
      body,
      "text",
      parsed.textContext,
      options,
    );
    if (textCard) container.appendChild(textCard);
    const responseCard = renderContextCard(
      doc,
      body,
      "response",
      parsed.responseQuote,
      options,
    );
    if (responseCard) container.appendChild(responseCard);
    if (parsed.questionText) {
      const question = doc.createElementNS(XHTML_NS, "div");
      question.className = "zoteroagent-msg-question";
      question.textContent = parsed.questionText;
      container.appendChild(question);
    }
    return;
  }

  const quoteLines: string[] = [];
  const bodyLines: string[] = [];
  for (const line of message.content.split("\n")) {
    if (line.trimStart().startsWith(">")) {
      quoteLines.push(line.replace(/^\s*>\s?/, ""));
    } else {
      bodyLines.push(line);
    }
  }
  if (quoteLines.length) {
    const quote = doc.createElementNS(
      XHTML_NS,
      "blockquote",
    ) as HTMLQuoteElement;
    quote.className = "zoteroagent-user-quote";
    quote.textContent = quoteLines.join("\n");
    container.appendChild(quote);
  }
  const bodyText = bodyLines.join("\n").trim();
  if (bodyText) {
    const text = doc.createElementNS(XHTML_NS, "div");
    text.textContent = bodyText;
    container.appendChild(text);
  }
}

export function extractRawUserText(content: string): string {
  return parseUserContent(content).questionText || content;
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

function renderContextCard(
  doc: Document,
  body: HTMLElement,
  kind: "text" | "response",
  rawText: string,
  options: UserMessageRenderOptions,
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
    const parsed = options.parseQuotedPageContext(text);
    textEl.textContent = parsed.text || text;
    if (parsed.pageLabel) {
      const pageNumber = Number(parsed.pageLabel);
      if (Number.isInteger(pageNumber) && pageNumber > 0) {
        const chip = options.createPageEvidenceChip(doc, body, {
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
  card.addEventListener("click", () => card.classList.toggle("is-expanded"));
  return card;
}

function renderPaperContext(
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
  const content = doc.createElementNS(XHTML_NS, "div") as HTMLElement;
  content.className = "zoteroagent-msg-paper-list";
  for (const paper of list) {
    const pill = doc.createElementNS(XHTML_NS, "span") as HTMLElement;
    pill.className = "zoteroagent-msg-paper-pill";
    pill.textContent = `@${paper.title || paper.itemKey}`;
    pill.title = [paper.creators, paper.year, paper.itemKey]
      .filter(Boolean)
      .join(" · ");
    content.appendChild(pill);
  }
  card.appendChild(content);
  return card;
}

function renderImageContext(
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
