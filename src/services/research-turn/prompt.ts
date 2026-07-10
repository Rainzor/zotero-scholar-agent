import type { ChatMessage, ChatSession, PaperContext } from "../../addon";
import { formatVisibleMessage } from "../message-format";

export type PromptPaperContext = PaperContext & { memory: string };
export type ResearchPromptMode = "resume" | "fresh-thread";

export const RECENT_VISIBLE_MESSAGE_LIMIT = 16;

export function buildQuotedQuestion(options: {
  question: string;
  selectedText?: string;
  responseQuote?: string;
}): string {
  const quotedBlocks: string[] = [];
  const selectedText = String(options.selectedText || "").trim();
  const responseQuote = String(options.responseQuote || "").trim();
  if (selectedText) {
    quotedBlocks.push(`[PDF Text]\n> ${selectedText.replace(/\n/g, "\n> ")}`);
  }
  if (responseQuote) {
    quotedBlocks.push(
      `[Previous Response]\n> ${responseQuote.replace(/\n/g, "\n> ")}`,
    );
  }
  const question = String(options.question || "").trim();
  return quotedBlocks.length ? `${quotedBlocks.join("\n\n")}\n\n${question}` : question;
}

export function getRecentMessagesForPrompt(
  session: Pick<ChatSession, "contextDigestUpToMessageIndex"> | null,
  messages: ChatMessage[],
): ChatMessage[] {
  const digestUpTo =
    typeof session?.contextDigestUpToMessageIndex === "number"
      ? session.contextDigestUpToMessageIndex
      : -1;
  return messages.slice(Math.max(0, digestUpTo + 1));
}

export function buildCodexResearchPrompt(options: {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  question: string;
  mode: ResearchPromptMode;
  mentionedPapers?: PromptPaperContext[];
  contextDigest?: string;
  recentMessages?: ChatMessage[];
}): string {
  const meta = [
    `In-focus paper: ${options.itemKey}`,
    `Title: ${options.title || options.itemKey}`,
    options.creators ? `Authors: ${options.creators}` : "",
    options.year ? `Year: ${options.year}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const mentioned = options.mentionedPapers || [];
  const mentionedBlock = mentioned.length
    ? [
        "Explicitly mentioned Vault papers (@):",
        "",
        ...mentioned.map((paper, index) =>
          [
            `### ${index + 1}. ${paper.title || paper.itemKey}`,
            `itemKey: ${paper.itemKey}`,
            paper.creators ? `authors: ${paper.creators}` : "",
            paper.year ? `year: ${paper.year}` : "",
            "",
            "Compact Paper Knowledge Record:",
            "```markdown",
            paper.memory,
            "```",
          ]
            .filter((line) => line !== "")
            .join("\n"),
        ),
      ].join("\n")
    : "Explicitly mentioned Vault papers (@): none";
  const contextBlock =
    options.mode === "fresh-thread"
      ? buildFreshThreadContextBlock(options.contextDigest, options.recentMessages)
      : [
          "Thread context mode: resume existing Codex thread.",
          "Hidden Context Digest: omitted because Codex is resuming this thread.",
          "Recent visible chat turns: omitted because Codex is resuming this thread.",
        ].join("\n");
  const relationshipRules = [
    "Cross-paper relationship rules:",
    "- The @ papers above are user-authorized context for this turn.",
    "- In a normal turn, update only the in-focus paper's memory.md.",
    "- If the answer establishes a durable relationship, add it under the in-focus paper's `## Library Connections` / `### Semantic Relationships` section.",
    "- Use this exact format so the plugin can index it:",
    "  `- [extends] [Paper title](../OTHERKEY/memory.md): rationale. Evidence: [page 4]`",
    "- Allowed relationship types: cites, extends, contradicts, supports, uses_same_method, uses_same_dataset, uses_same_metric, solves_limitation_of, can_combine_with, inspired_question.",
    "- Do not modify mentioned papers unless the user explicitly asks for a cross-paper/library reconciliation.",
  ].join("\n");
  return `${meta}\n\n${mentionedBlock}\n\n${contextBlock}\n\n${relationshipRules}\n\nUser question:\n${options.question.trim()}`;
}

function buildFreshThreadContextBlock(
  contextDigest?: string,
  recentMessages?: ChatMessage[],
): string {
  const digest = String(contextDigest || "").trim();
  const digestBlock = digest
    ? [
        "Hidden Context Digest (machine context; do not show this as chat text):",
        "```markdown",
        digest,
        "```",
      ].join("\n")
    : "Hidden Context Digest: none";
  const recent = (recentMessages || [])
    .slice(-RECENT_VISIBLE_MESSAGE_LIMIT)
    .map((message, index) => formatVisibleMessage(index, message))
    .filter(Boolean)
    .join("\n\n");
  const recentBlock = [
    `Recent visible chat turns (last ${RECENT_VISIBLE_MESSAGE_LIMIT} messages, full transcript remains user-visible in Zotero):`,
    recent || "(No prior visible turns.)",
  ].join("\n");
  return `${digestBlock}\n\n${recentBlock}`;
}
