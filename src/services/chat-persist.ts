import type { ChatMessage } from "../addon";
import type { ContextDigestSource } from "./context-digest";

export type PersistedSession = {
  sessionId: string;
  codexThreadId?: string;
  modelSlug?: string;
  contextDigest?: string;
  contextDigestUpToMessageIndex?: number;
  contextDigestUpdatedAt?: number;
  contextDigestTokenEstimate?: number;
  contextDigestSource?: ContextDigestSource;
  title: string;
  /** Always "agent" in current architecture; kept for on-disk compatibility. */
  contextMode: "agent";
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

export type PersistedItemStateV2 = {
  version: 2;
  itemId?: number;
  itemKey: string;
  paperTitle: string;
  activeSessionId?: string;
  sessions: PersistedSession[];
};

export function newSessionId(now = Date.now()): string {
  return `chat-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize a raw JSON blob into PersistedItemStateV2.
 * Drops legacy summary fields and old contextMode values; always coerces to "agent".
 */
export function normalizePersistedItem(
  parsed: Partial<PersistedItemStateV2> & {
    sessions?: Array<Partial<PersistedSession> & Record<string, unknown>>;
  },
  options?: { now?: number; newId?: () => string },
): PersistedItemStateV2 {
  const now = options?.now ?? Date.now();
  const makeId = options?.newId ?? (() => newSessionId(now));
  const sessions = (parsed.sessions || []).map((s) =>
    normalizePersistedSession(s, { now, newId: makeId }),
  );
  return {
    version: 2,
    itemId: Number(parsed.itemId) || undefined,
    itemKey: String(parsed.itemKey || ""),
    paperTitle: String(parsed.paperTitle || "Untitled"),
    activeSessionId: String(
      parsed.activeSessionId || sessions[0]?.sessionId || "",
    ),
    sessions,
  };
}

export function normalizePersistedSession(
  raw: Partial<PersistedSession> & Record<string, unknown>,
  options?: { now?: number; newId?: () => string },
): PersistedSession {
  const now = options?.now ?? Date.now();
  const makeId = options?.newId ?? (() => newSessionId(now));
  const digest = String(raw?.contextDigest || "").trim();
  const digestUpTo = Number(raw?.contextDigestUpToMessageIndex);
  const digestUpdatedAt = Number(raw?.contextDigestUpdatedAt);
  const digestTokenEstimate = Number(raw?.contextDigestTokenEstimate);
  const digestSource = normalizeDigestSource(raw?.contextDigestSource);
  return {
    sessionId: String(raw?.sessionId || makeId()),
    codexThreadId: String(raw?.codexThreadId || ""),
    modelSlug: String(raw?.modelSlug || "").trim() || undefined,
    contextDigest: digest || undefined,
    contextDigestUpToMessageIndex:
      digest && Number.isFinite(digestUpTo) && digestUpTo >= 0
        ? Math.floor(digestUpTo)
        : undefined,
    contextDigestUpdatedAt:
      digest && Number.isFinite(digestUpdatedAt) && digestUpdatedAt > 0
        ? digestUpdatedAt
        : undefined,
    contextDigestTokenEstimate:
      digest && Number.isFinite(digestTokenEstimate) && digestTokenEstimate > 0
        ? Math.floor(digestTokenEstimate)
        : undefined,
    contextDigestSource: digest ? digestSource : undefined,
    title: String(raw?.title || "Chat"),
    contextMode: "agent",
    messages: Array.isArray(raw?.messages)
      ? (raw.messages as ChatMessage[])
      : [],
    createdAt: Number(raw?.createdAt) || now,
    updatedAt: Number(raw?.updatedAt) || now,
  };
}

export function serializeItemState(state: {
  itemId: number;
  itemKey: string;
  paperTitle: string;
  activeSessionId: string | null;
  sessions: Array<{
    sessionId: string;
    codexThreadId?: string;
    modelSlug?: string;
    contextDigest?: string;
    contextDigestUpToMessageIndex?: number;
    contextDigestUpdatedAt?: number;
    contextDigestTokenEstimate?: number;
    contextDigestSource?: ContextDigestSource;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
  }>;
}): PersistedItemStateV2 {
  return {
    version: 2,
    itemId: state.itemId,
    itemKey: state.itemKey,
    paperTitle: state.paperTitle,
    activeSessionId: state.activeSessionId || undefined,
    sessions: state.sessions.map((s) => ({
      sessionId: s.sessionId,
      codexThreadId: s.codexThreadId || undefined,
      modelSlug: s.modelSlug?.trim() || undefined,
      contextDigest: s.contextDigest?.trim() || undefined,
      contextDigestUpToMessageIndex:
        typeof s.contextDigestUpToMessageIndex === "number"
          ? s.contextDigestUpToMessageIndex
          : undefined,
      contextDigestUpdatedAt:
        typeof s.contextDigestUpdatedAt === "number"
          ? s.contextDigestUpdatedAt
          : undefined,
      contextDigestTokenEstimate:
        typeof s.contextDigestTokenEstimate === "number"
          ? s.contextDigestTokenEstimate
          : undefined,
      contextDigestSource: s.contextDigestSource,
      title: s.title,
      contextMode: "agent",
      messages: s.messages.map((m) => ({ ...m })),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  };
}

export function isValidPersistedItem(
  parsed: unknown,
): parsed is PersistedItemStateV2 {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Partial<PersistedItemStateV2>;
  return (
    p.version === 2 &&
    typeof p.itemKey === "string" &&
    p.itemKey.length > 0 &&
    Array.isArray(p.sessions)
  );
}

function normalizeDigestSource(
  value: unknown,
): ContextDigestSource | undefined {
  const source = String(value || "");
  return source === "codex-cheap" ||
    source === "codex-default" ||
    source === "deterministic"
    ? source
    : undefined;
}
