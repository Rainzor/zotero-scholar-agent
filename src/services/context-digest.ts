import type { ChatMessage } from "../addon";
import { estimateTokens } from "../utils/token-estimate";
import { formatVisibleMessage, summarizeText } from "./message-format";
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

export const CONTEXT_DIGEST_WARNING_PERCENT = 70;
export const CONTEXT_DIGEST_AUTO_PERCENT = 85;

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
