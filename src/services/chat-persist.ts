import type { ChatMessage } from "../addon";

export type PersistedSession = {
  sessionId: string;
  codexThreadId?: string;
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
  return {
    sessionId: String(raw?.sessionId || makeId()),
    codexThreadId: String(raw?.codexThreadId || ""),
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
