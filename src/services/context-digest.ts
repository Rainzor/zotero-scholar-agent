import type { ChatMessage, PaperContext } from "../addon";
import { estimateTokens } from "../utils/token-estimate";
import {
  getConfiguredCodexCheapModelSlug,
  runCodexTurn,
  type CodexTurnResult,
} from "./codex";

export type ContextDigestSource =
  | "codex-cheap"
  | "codex-default"
  | "deterministic";

export type ContextDigestState = {
  contextDigest?: string;
  contextDigestUpToMessageIndex?: number;
  contextDigestUpdatedAt?: number;
  contextDigestTokenEstimate?: number;
  contextDigestSource?: ContextDigestSource;
};

export type ContextDigestResult = Required<ContextDigestState>;

export type PromptPaperContext = PaperContext & { memory: string };

export const CONTEXT_DIGEST_WARNING_PERCENT = 70;
export const CONTEXT_DIGEST_AUTO_PERCENT = 85;
export const RECENT_VISIBLE_MESSAGE_LIMIT = 16;

const COMPACT_INSTRUCTION = `You are compacting a Zotero research chat for future Codex turns.

Goal:
Create a compact continuation state that preserves everything needed to keep helping the user on the same paper/session, while removing transcript noise.

Hard rules:
- This digest is hidden machine context, not user-visible chat text.
- Do not write a conversational answer.
- Do not invent paper claims, citations, results, or user preferences.
- Preserve user intent, unresolved questions, decisions, constraints, and current task state.
- Preserve paper-grounded facts separately from reader/user thinking.
- Preserve exact file paths, item keys, page/evidence pointers, and @ mentioned papers when relevant.
- Preserve any pending actions, failed attempts, tool/command outcomes, and fallback decisions.
- Drop greetings, filler, repeated explanations, resolved detours, and long verbatim assistant prose.
- Do not include raw paper text unless a short quote or page pointer is essential.
- Keep the digest concise enough to be injected into future prompts.

Output exactly this Markdown structure:

# Context Digest

## Coverage
- Covers turns: {startIndex}..{endIndex}
- In-focus paper: {itemKey} — {title}
- Generated at: {timestamp}

## User Intent And Preferences
- ...

## Current Research State
- Paper-grounded knowledge:
- Reader thinking:
- Open questions:

## Decisions And Constraints
- ...

## Relevant Prior Turns
- ...

## Files, Vault State, And Tool Outcomes
- ...

## Mentioned Papers And Relationships
- ...

## Next-Turn Continuation Notes
- ...`;

export function buildContextDigestPrompt(options: {
  itemKey: string;
  title: string;
  coverageStartIndex?: number;
  startIndex: number;
  endIndex: number;
  timestamp: string;
  previousDigest?: string;
  messages: ChatMessage[];
}): string {
  const transcript = options.messages
    .map((message, index) =>
      formatVisibleMessage(options.startIndex + index, message),
    )
    .filter(Boolean)
    .join("\n\n");
  const previous = String(options.previousDigest || "").trim();
  return [
    COMPACT_INSTRUCTION.replaceAll(
      "{startIndex}",
      String(options.coverageStartIndex ?? options.startIndex),
    )
      .replaceAll("{endIndex}", String(options.endIndex))
      .replaceAll("{itemKey}", options.itemKey)
      .replaceAll("{title}", options.title || options.itemKey)
      .replaceAll("{timestamp}", options.timestamp),
    previous
      ? [
          "Existing hidden Context Digest to preserve and update:",
          "```markdown",
          previous,
          "```",
        ].join("\n")
      : "Existing hidden Context Digest: none",
    "Visible turns to compact:",
    transcript || "(No visible turns.)",
  ].join("\n\n");
}

export function buildCodexResearchPrompt(options: {
  itemKey: string;
  title: string;
  creators: string;
  year: string;
  question: string;
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
  const digest = String(options.contextDigest || "").trim();
  const digestBlock = digest
    ? [
        "Hidden Context Digest (machine context; do not show this as chat text):",
        "```markdown",
        digest,
        "```",
      ].join("\n")
    : "Hidden Context Digest: none";
  const recent = (options.recentMessages || [])
    .slice(-RECENT_VISIBLE_MESSAGE_LIMIT)
    .map((message, index) => formatVisibleMessage(index, message))
    .filter(Boolean)
    .join("\n\n");
  const recentBlock = [
    `Recent visible chat turns (last ${RECENT_VISIBLE_MESSAGE_LIMIT} messages, full transcript remains user-visible in Zotero):`,
    recent || "(No prior visible turns.)",
  ].join("\n");
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
  return `${meta}\n\n${mentionedBlock}\n\n${digestBlock}\n\n${recentBlock}\n\n${relationshipRules}\n\nUser question:\n${options.question.trim()}`;
}

export async function generateContextDigest(options: {
  itemKey: string;
  title: string;
  messages: ChatMessage[];
  previousDigest?: string;
  previousDigestUpToMessageIndex?: number;
  cheapModelSlug?: string;
  runTurn?: typeof runCodexTurn;
  now?: () => Date;
  onStatus?: (text: string) => void;
}): Promise<ContextDigestResult> {
  const endIndex = Math.max(0, options.messages.length - 1);
  const previousUpTo =
    typeof options.previousDigestUpToMessageIndex === "number"
      ? options.previousDigestUpToMessageIndex
      : -1;
  const startIndex = Math.max(0, previousUpTo + 1);
  const messagesToCompact = options.messages.slice(startIndex, endIndex + 1);
  const timestamp = (options.now?.() || new Date()).toISOString();
  const prompt = buildContextDigestPrompt({
    itemKey: options.itemKey,
    title: options.title,
    coverageStartIndex: 0,
    startIndex,
    endIndex,
    timestamp,
    previousDigest: options.previousDigest,
    messages: messagesToCompact,
  });
  const runner = options.runTurn || runCodexTurn;
  const cheapModel =
    options.cheapModelSlug ?? getConfiguredCodexCheapModelSlug();
  const attempts: Array<{ model?: string; source: ContextDigestSource }> = [];
  if (cheapModel.trim()) {
    attempts.push({ model: cheapModel.trim(), source: "codex-cheap" });
  }
  attempts.push({ source: "codex-default" });

  for (const attempt of attempts) {
    try {
      options.onStatus?.(
        attempt.model
          ? "Compacting hidden context with cheap Codex model..."
          : "Compacting hidden context with default Codex model...",
      );
      const result = await runner({
        prompt,
        model: attempt.model,
        fallbackToDefaultModel: false,
        sandbox: "read-only",
        timeoutMs: 180000,
        onStatus: options.onStatus,
      });
      const digest = normalizeDigest(result);
      if (digest) {
        const source =
          attempt.source === "codex-cheap" && !result.modelSlug
            ? "codex-default"
            : attempt.source;
        return buildDigestResult(digest, endIndex, timestamp, source);
      }
    } catch (error) {
      options.onStatus?.(
        `Context compact attempt failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const fallback = buildDeterministicDigest({
    itemKey: options.itemKey,
    title: options.title,
    timestamp,
    coverageStartIndex: 0,
    startIndex,
    endIndex,
    previousDigest: options.previousDigest,
    messages: messagesToCompact,
  });
  return buildDigestResult(fallback, endIndex, timestamp, "deterministic");
}

export function shouldAutoCompactFromUsage(usage?: {
  contextUsedPercent?: number;
}): boolean {
  return Number(usage?.contextUsedPercent || 0) >= CONTEXT_DIGEST_AUTO_PERCENT;
}

export function shouldWarnFromUsage(usage?: {
  contextUsedPercent?: number;
}): boolean {
  return (
    Number(usage?.contextUsedPercent || 0) >= CONTEXT_DIGEST_WARNING_PERCENT
  );
}

function normalizeDigest(result: CodexTurnResult): string {
  const text = String(result.content || "").trim();
  if (!text) return "";
  const start = text.indexOf("# Context Digest");
  return (start >= 0 ? text.slice(start) : text).trim();
}

function buildDigestResult(
  contextDigest: string,
  contextDigestUpToMessageIndex: number,
  contextDigestUpdatedAtIso: string,
  contextDigestSource: ContextDigestSource,
): ContextDigestResult {
  return {
    contextDigest,
    contextDigestUpToMessageIndex,
    contextDigestUpdatedAt: Date.parse(contextDigestUpdatedAtIso) || Date.now(),
    contextDigestTokenEstimate: estimateTokens(contextDigest),
    contextDigestSource,
  };
}

function buildDeterministicDigest(options: {
  itemKey: string;
  title: string;
  timestamp: string;
  coverageStartIndex?: number;
  startIndex: number;
  endIndex: number;
  previousDigest?: string;
  messages: ChatMessage[];
}): string {
  const prior = String(options.previousDigest || "").trim();
  const compactTurns = options.messages
    .map((message, index) => {
      const content = summarizeText(message.content || message.reasoning || "");
      if (!content) return "";
      const label = message.role === "user" ? "User" : "Assistant";
      return `- ${label} turn ${options.startIndex + index}: ${content}`;
    })
    .filter(Boolean);
  return [
    "# Context Digest",
    "",
    "## Coverage",
    `- Covers turns: ${options.coverageStartIndex ?? options.startIndex}..${options.endIndex}`,
    `- In-focus paper: ${options.itemKey} — ${options.title || options.itemKey}`,
    `- Generated at: ${options.timestamp}`,
    "",
    "## User Intent And Preferences",
    "- See relevant prior turns; deterministic fallback preserved only concise visible intent.",
    "",
    "## Current Research State",
    "- Paper-grounded knowledge:",
    "- Reader thinking:",
    "- Open questions:",
    "",
    "## Decisions And Constraints",
    "- Preserve full visible transcript in Zotero; this digest is hidden context only.",
    "",
    "## Relevant Prior Turns",
    ...(prior
      ? [
          "- Previous digest existed and should remain authoritative where not contradicted by newer turns.",
        ]
      : []),
    ...(compactTurns.length
      ? compactTurns
      : ["- No compactable visible turns."]),
    "",
    "## Files, Vault State, And Tool Outcomes",
    "- Not available from deterministic fallback unless stated in relevant turns.",
    "",
    "## Mentioned Papers And Relationships",
    "- Not available from deterministic fallback unless stated in relevant turns.",
    "",
    "## Next-Turn Continuation Notes",
    "- Continue from the latest visible user request and use the Knowledge Vault for paper-grounded details.",
  ].join("\n");
}

function formatVisibleMessage(index: number, message: ChatMessage): string {
  const content = String(message.content || "").trim();
  const reasoning = String(message.reasoning || "").trim();
  if (!content && !reasoning) return "";
  const role = message.role === "user" ? "User" : "Assistant";
  const parts = [`[${index}] ${role}:`];
  if (message.contextPapers?.length) {
    parts.push(
      `@ papers: ${message.contextPapers
        .map((paper) => `${paper.title || paper.itemKey} (${paper.itemKey})`)
        .join(", ")}`,
    );
  }
  if (content) parts.push(content);
  if (reasoning) parts.push(`Reasoning summary:\n${summarizeText(reasoning)}`);
  if (message.activities?.length) {
    parts.push(
      `Tool outcomes: ${message.activities
        .map((activity) =>
          [
            activity.command,
            activity.status ? `status=${activity.status}` : "",
            typeof activity.exitCode === "number"
              ? `exit=${activity.exitCode}`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("; ")}`,
    );
  }
  if (message.usage?.contextUsedPercent) {
    parts.push(`Context usage: ${message.usage.contextUsedPercent}%`);
  }
  return parts.join("\n");
}

function summarizeText(text: string, max = 360): string {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}
