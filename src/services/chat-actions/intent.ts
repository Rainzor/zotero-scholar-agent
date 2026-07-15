import type {
  AgentActionKind,
  AgentActionTriggerSource,
  NoteContentSource,
} from "./types";

export type ChatIntentInput = {
  text: string;
  selectedText?: string;
  responseQuote?: string;
};

export type ParsedChatIntent =
  | { type: "research" }
  | { type: "help"; message: string }
  | {
      type: "action";
      execution: "direct" | "confirm";
      kind: AgentActionKind;
      content?: string;
      contentSource?: NoteContentSource;
      rating?: number;
      targetTier?: "L0" | "L1" | "L2";
      trigger: AgentActionTriggerSource;
    };

const COMMAND_HELP = [
  "Available commands:",
  "- `/note [content]` organizes Reader Thinking for this paper.",
  "",
  "With an empty `/note`, the current PDF selection or quoted reply is used.",
  "Set the rating or reading depth from the composer's paper controls.",
].join("\n");

export function parseChatIntent(input: ChatIntentInput): ParsedChatIntent {
  const text = String(input.text || "").trim();
  const slash = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (slash) {
    const command = String(slash[1] || "").toLowerCase();
    const argument = String(slash[2] || "").trim();
    if (command !== "note") {
      return { type: "help", message: COMMAND_HELP };
    }
    const resolved = resolveNoteContent(
      argument,
      input.selectedText,
      input.responseQuote,
    );
    if (!resolved.content) {
      return {
        type: "help",
        message:
          "Add content after `/note`, select PDF text, or quote a previous reply.",
      };
    }
    return {
      type: "action",
      execution: "direct",
      kind: "note.organize",
      content: resolved.content,
      contentSource: resolved.source,
      trigger: "slash-command",
    };
  }

  const explicitRating = extractExplicitRating(text);
  if (explicitRating) {
    return {
      type: "action",
      execution: "direct",
      kind: "paper.rating.set",
      rating: explicitRating,
      trigger: "explicit-instruction",
    };
  }
  const explicitTier = extractExplicitDepth(text);
  if (explicitTier) {
    return {
      type: "action",
      execution: "direct",
      kind: "paper.depth.set",
      targetTier: explicitTier,
      trigger: "explicit-instruction",
    };
  }

  if (isExplicitNoteInstruction(text)) {
    const inlineContent = extractExplicitNoteBody(text);
    const resolved = resolveNoteContent(
      inlineContent,
      input.selectedText,
      input.responseQuote,
    );
    if (resolved.content) {
      return {
        type: "action",
        execution: "direct",
        kind: "note.organize",
        content: resolved.content,
        contentSource: resolved.source,
        trigger: "explicit-instruction",
      };
    }
  }

  return { type: "research" };
}

function extractExplicitRating(text: string): number | undefined {
  const match =
    text.match(
      /^(?:请)?(?:给这篇论文|给论文|论文)\s*(?:打|评为?)\s*([1-5])\s*(?:星|分)[。.!！]?$/,
    ) ||
    text.match(
      /^(?:please\s+)?(?:rate\s+(?:this\s+)?paper|set\s+rating\s+to)\s+([1-5])[.!]?$/i,
    );
  const rating = Number(match?.[1]);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? rating
    : undefined;
}

function extractExplicitDepth(text: string): "L0" | "L1" | "L2" | undefined {
  const match =
    text.match(
      /^(?:请)?(?:把|将)?(?:阅读)?深度\s*(?:设为|设置为|改为|到)\s*(L[0-2])[。.!！]?$/i,
    ) ||
    text.match(
      /^(?:please\s+)?(?:set|change)\s+(?:the\s+)?depth\s+to\s+(L[0-2])[.!]?$/i,
    );
  const tier = String(match?.[1] || "").toUpperCase();
  return tier === "L0" || tier === "L1" || tier === "L2" ? tier : undefined;
}

function resolveNoteContent(
  commandBody?: string,
  selectedText?: string,
  responseQuote?: string,
): { content: string; source: NoteContentSource } {
  const candidates: Array<[string | undefined, NoteContentSource]> = [
    [commandBody, "command"],
    [selectedText, "selection"],
    [responseQuote, "response-quote"],
  ];
  for (const [candidate, source] of candidates) {
    const content = String(candidate || "").trim();
    if (content) return { content, source };
  }
  return { content: "", source: "message" };
}

function isExplicitNoteInstruction(text: string): boolean {
  return (
    /^(?:please\s+)?(?:organize|turn|save)\b[\s\S]*\b(?:note|notes)\b/i.test(
      text,
    ) ||
    /^(?:请)?(?:把|将)?(?:这段|这些|以下|上面|这个)?[\s\S]{0,12}(?:整理|记|保存)(?:成|到|为)?(?:读书)?笔记/.test(
      text,
    )
  );
}

function extractExplicitNoteBody(text: string): string {
  const colon = text.match(/[:：]\s*([\s\S]+)$/);
  return String(colon?.[1] || "").trim();
}
