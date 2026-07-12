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
      content: string;
      contentSource: NoteContentSource;
      trigger: AgentActionTriggerSource;
    };

const COMMAND_HELP = [
  "Available commands:",
  "- `/note [content]` organizes Reader Thinking for this paper.",
  "",
  "With an empty `/note`, the current PDF selection or quoted reply is used.",
].join("\n");

export function parseChatIntent(input: ChatIntentInput): ParsedChatIntent {
  const text = String(input.text || "").trim();
  const slash = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (slash) {
    const command = String(slash[1] || "").toLowerCase();
    if (command !== "note") {
      return { type: "help", message: COMMAND_HELP };
    }
    const resolved = resolveNoteContent(
      String(slash[2] || ""),
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
