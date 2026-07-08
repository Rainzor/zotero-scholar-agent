import type {
  ChatMessage,
  ChatSession,
  ContextMode,
  SessionContextPdfRef,
} from "../addon";
import { estimateTokens } from "../utils/token-estimate";

type PersistedSession = {
  sessionId: string;
  codexThreadId?: string;
  title: string;
  contextMode: ContextMode;
  messages: ChatMessage[];
  contextPdf?: SessionContextPdfRef;
  summaryText?: string;
  summaryUpToIndex?: number;
  summaryUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type PersistedItemStateV2 = {
  version: 2;
  itemId?: number;
  itemKey: string;
  paperTitle: string;
  activeSessionId?: string;
  sessions: PersistedSession[];
};

type ItemSessionState = {
  itemId: number;
  itemKey: string;
  paperTitle: string;
  activeSessionId: string | null;
  sessions: ChatSession[];
};

export type ChatSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
};

const MAX_MESSAGES = 100;
const MAX_TOKENS_APPROX = 50000;
const SUMMARY_MARKER = "[Session Summary]";

class ChatStore {
  private readonly cacheByItemId = new Map<number, ItemSessionState>();
  private readonly diskByItemKey = new Map<string, PersistedItemStateV2>();
  private readonly diskItemIdToKey = new Map<number, string>();
  private readonly dirtyItemIds = new Set<number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const ioUtils = (globalThis as any).IOUtils;
      if (!ioUtils) return;
      await this.ensureStorageDir();
      const children: string[] = await ioUtils.getChildren(
        this.getStorageDir(),
      );
      for (const filePath of children) {
        if (!String(filePath).endsWith(".json")) continue;
        const raw = await ioUtils.readUTF8(filePath);
        const parsed = JSON.parse(raw) as Partial<PersistedItemStateV2>;
        if (
          !parsed ||
          parsed.version !== 2 ||
          !parsed.itemKey ||
          !Array.isArray(parsed.sessions)
        ) {
          continue;
        }
        const migrated = this.normalizePersisted(parsed);
        this.diskByItemKey.set(migrated.itemKey, migrated);
        if (migrated.itemId && migrated.itemId > 0) {
          this.diskItemIdToKey.set(migrated.itemId, migrated.itemKey);
        }
      }
    } catch (e) {
      ztoolkit.log("[Agent] ChatStore init error:", e);
    }
  }

  listRecentSessions(limit = 12): ChatSessionSummary[] {
    const summaries: ChatSessionSummary[] = [];
    for (const state of this.diskByItemKey.values()) {
      for (const s of state.sessions) {
        summaries.push({
          sessionId: s.sessionId,
          title: s.title,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
        });
      }
    }
    for (const state of this.cacheByItemId.values()) {
      for (const s of state.sessions) {
        summaries.push({
          sessionId: s.sessionId,
          title: s.title,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
        });
      }
    }
    return summaries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, limit));
  }

  listSessions(itemId: number): ChatSessionSummary[] {
    const state = this.getItemState(itemId);
    if (!state) return [];
    return state.sessions
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createSession(
    itemId: number,
    title?: string,
    contextMode: ContextMode = "agent",
  ): ChatSession | null {
    if (itemId <= 0) return null;
    const state = this.getOrCreateItemState(itemId);
    const now = Date.now();
    const index = state.sessions.length + 1;
    const session: ChatSession = {
      sessionId: this.newSessionId(),
      itemId,
      itemKey: state.itemKey,
      codexThreadId: "",
      title: title?.trim() || this.buildDefaultSessionTitle(index),
      messages: [],
      summaryText: "",
      summaryUpToIndex: 0,
      summaryUpdatedAt: 0,
      contextMode: this.normalizeContextMode(contextMode),
      contextPdf: undefined,
      createdAt: now,
      updatedAt: now,
    };
    state.sessions.unshift(session);
    state.activeSessionId = session.sessionId;
    this.markDirty(itemId);
    return session;
  }

  setActiveSession(itemId: number, sessionId: string) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const exists = state.sessions.some((s) => s.sessionId === sessionId);
    if (!exists) return;
    state.activeSessionId = sessionId;
    this.markDirty(itemId);
  }

  getActiveSessionId(itemId: number): string {
    const state = this.getItemState(itemId);
    return state?.activeSessionId || "";
  }

  getSession(itemId: number): ChatSession | null {
    const state = this.getItemState(itemId);
    if (!state) return null;
    if (!state.activeSessionId && state.sessions.length > 0) {
      state.activeSessionId = state.sessions[0].sessionId;
    }
    if (!state.activeSessionId) return null;
    return (
      state.sessions.find((s) => s.sessionId === state.activeSessionId) || null
    );
  }

  getMessages(itemId: number): ChatMessage[] {
    const session = this.getSession(itemId);
    return session ? session.messages : [];
  }

  addMessage(
    itemId: number,
    message: ChatMessage,
    contextMode: ContextMode = "agent",
  ) {
    if (itemId <= 0) return;
    let session = this.getSession(itemId);
    if (!session) {
      session = this.createSession(itemId, undefined, contextMode);
      if (!session) return;
    }
    if (!message.timestamp) message.timestamp = Date.now();
    session.messages.push(message);
    this.maybeAutoTitleSession(session, message);
    session.contextMode = this.normalizeContextMode(contextMode);
    session.updatedAt = Date.now();
    this.applyCompaction(session);
    this.markDirty(itemId);
  }

  clearSession(itemId: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    session.messages = [];
    session.summaryText = "";
    session.summaryUpToIndex = 0;
    session.summaryUpdatedAt = Date.now();
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  renameSession(itemId: number, title: string, sessionId?: string) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const targetId = sessionId || state.activeSessionId || "";
    const session = state.sessions.find((s) => s.sessionId === targetId);
    if (!session) return;
    session.title = trimmed;
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  async deleteSession(itemId: number, sessionId?: string) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const targetId = sessionId || state.activeSessionId || "";
    const idx = state.sessions.findIndex((s) => s.sessionId === targetId);
    if (idx < 0) return;
    state.sessions.splice(idx, 1);
    state.activeSessionId = state.sessions[0]?.sessionId || null;
    if (state.sessions.length === 0) {
      this.cacheByItemId.set(itemId, state);
    }
    this.markDirty(itemId);
  }

  deleteMessage(itemId: number, msgIndex: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    if (msgIndex < 0 || msgIndex >= session.messages.length) return;
    session.messages.splice(msgIndex, 1);
    session.summaryText = "";
    session.summaryUpToIndex = 0;
    session.summaryUpdatedAt = Date.now();
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  truncateMessagesFrom(itemId: number, fromIndex: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    if (fromIndex < 0 || fromIndex >= session.messages.length) return;
    session.messages.splice(fromIndex);
    session.summaryText = "";
    session.summaryUpToIndex = 0;
    session.summaryUpdatedAt = Date.now();
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  updateSessionSummary(itemId: number, summaryText: string, upToIndex: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    session.summaryText = summaryText;
    session.summaryUpToIndex = Math.max(0, upToIndex);
    session.summaryUpdatedAt = Date.now();
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  updateContextMode(itemId: number, contextMode: ContextMode) {
    const session = this.getSession(itemId);
    if (!session) return;
    session.contextMode = this.normalizeContextMode(contextMode);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  setSessionContextPdf(
    itemId: number,
    contextPdf: SessionContextPdfRef | null | undefined,
  ) {
    const session = this.getSession(itemId);
    if (!session) return;
    session.contextPdf = this.normalizeContextPdfRef(contextPdf);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  clearSessionContextPdf(itemId: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    if (!session.contextPdf) return;
    session.contextPdf = undefined;
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  touchSession(itemId: number, contextMode?: ContextMode) {
    const session = this.getSession(itemId);
    if (!session) return;
    if (contextMode)
      session.contextMode = this.normalizeContextMode(contextMode);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  updateCodexThreadId(itemId: number, threadId: string, sessionId?: string) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const targetId = sessionId || state.activeSessionId || "";
    const session = state.sessions.find((s) => s.sessionId === targetId);
    if (!session) return;
    session.codexThreadId = String(threadId || "").trim();
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  async flushAll() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushDirty();
  }

  private getItemState(itemId: number): ItemSessionState | null {
    if (itemId <= 0) return null;
    const cached = this.cacheByItemId.get(itemId);
    if (cached) return cached;
    const meta = this.getItemMeta(itemId);
    let persisted = this.diskByItemKey.get(meta.itemKey);
    if (!persisted) {
      const knownKey = this.diskItemIdToKey.get(itemId);
      if (knownKey) {
        persisted = this.diskByItemKey.get(knownKey);
      }
    }
    if (!persisted) return null;
    const state: ItemSessionState = {
      itemId,
      itemKey: persisted.itemKey,
      paperTitle: persisted.paperTitle || meta.title,
      activeSessionId:
        persisted.activeSessionId || persisted.sessions[0]?.sessionId || null,
      sessions: persisted.sessions.map((s) => ({
        sessionId: s.sessionId,
        itemId,
        itemKey: persisted.itemKey,
        codexThreadId: s.codexThreadId || "",
        title: s.title,
        messages: s.messages.map((m) => ({ ...m })),
        contextPdf: this.normalizeContextPdfRef((s as any).contextPdf),
        summaryText: s.summaryText || "",
        summaryUpToIndex: Math.max(0, Number(s.summaryUpToIndex) || 0),
        summaryUpdatedAt: Number(s.summaryUpdatedAt) || 0,
        contextMode: this.normalizeContextMode(s.contextMode),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
    this.cacheByItemId.set(itemId, state);
    return state;
  }

  private getOrCreateItemState(itemId: number): ItemSessionState {
    const existing = this.getItemState(itemId);
    if (existing) return existing;
    const meta = this.getItemMeta(itemId);
    const state: ItemSessionState = {
      itemId,
      itemKey: meta.itemKey,
      paperTitle: meta.title,
      activeSessionId: null,
      sessions: [],
    };
    this.cacheByItemId.set(itemId, state);
    return state;
  }

  private normalizePersisted(
    parsed: Partial<PersistedItemStateV2>,
  ): PersistedItemStateV2 {
    return {
      version: 2,
      itemId: Number(parsed.itemId) || undefined,
      itemKey: String(parsed.itemKey || ""),
      paperTitle: String(parsed.paperTitle || "Untitled"),
      activeSessionId: String(
        parsed.activeSessionId || parsed.sessions?.[0]?.sessionId || "",
      ),
      sessions: (parsed.sessions || []).map((s: any) => ({
        sessionId: String(s?.sessionId || this.newSessionId()),
        codexThreadId: String(s?.codexThreadId || ""),
        title: String(s?.title || "Chat"),
        contextMode: this.normalizeContextMode(s?.contextMode),
        messages: Array.isArray(s?.messages) ? s.messages : [],
        contextPdf: this.normalizeContextPdfRef(s?.contextPdf),
        summaryText: String(s?.summaryText || ""),
        summaryUpToIndex: Math.max(0, Number(s?.summaryUpToIndex) || 0),
        summaryUpdatedAt: Number(s?.summaryUpdatedAt) || 0,
        createdAt: Number(s?.createdAt) || Date.now(),
        updatedAt: Number(s?.updatedAt) || Date.now(),
      })),
    };
  }

  private applyCompaction(session: ChatSession) {
    const overMessageLimit = session.messages.length > MAX_MESSAGES;
    const overTokenLimit =
      this.approxTokens(session.messages) > MAX_TOKENS_APPROX;
    if (!overMessageLimit && !overTokenLimit) return;
    const keepTailCount = 20;
    const tail = session.messages.slice(-keepTailCount).map((m) => {
      if (!m.images?.length) return m;
      return { ...m, images: [] };
    });
    const head = session.messages.slice(
      0,
      Math.max(0, session.messages.length - keepTailCount),
    );
    if (head.length === 0) return;
    const previousSummary = session.messages.find(
      (m) => m.role === "assistant" && m.content.startsWith(SUMMARY_MARKER),
    )?.content;
    const summaryMessage: ChatMessage = {
      role: "assistant",
      content: this.buildSummary(head, previousSummary),
      timestamp: Date.now(),
      images: [],
    };
    session.messages = [summaryMessage, ...tail];
    while (
      session.messages.length > 10 &&
      this.approxTokens(session.messages) > MAX_TOKENS_APPROX
    ) {
      session.messages.splice(1, 2);
    }
  }

  private approxTokens(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => {
      return (
        sum +
        estimateTokens(m.content || "") +
        estimateTokens(m.reasoning || "")
      );
    }, 0);
  }

  private buildSummary(
    messages: ChatMessage[],
    previousSummary?: string,
  ): string {
    const lines: string[] = [];
    if (previousSummary) {
      lines.push(previousSummary.replace(/\s+$/g, ""));
      lines.push("");
      lines.push("Latest condensed history:");
    } else {
      lines.push(`${SUMMARY_MARKER} Earlier conversation has been compacted.`);
    }
    for (const msg of messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      const content = (msg.content || "").replace(/\s+/g, " ").trim();
      if (!content) continue;
      lines.push(
        `- ${role}: ${content.length > 180 ? `${content.slice(0, 180)}...` : content}`,
      );
    }
    return lines.join("\n");
  }

  private markDirty(itemId: number) {
    this.dirtyItemIds.add(itemId);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushDirty();
    }, 500);
  }

  private async flushDirty() {
    if (this.dirtyItemIds.size === 0) return;
    const ioUtils = (globalThis as any).IOUtils;
    if (!ioUtils) return;
    try {
      await this.ensureStorageDir();
      const pending = Array.from(this.dirtyItemIds);
      this.dirtyItemIds.clear();
      for (const itemId of pending) {
        const state = this.cacheByItemId.get(itemId);
        if (!state) continue;
        const persisted: PersistedItemStateV2 = {
          version: 2,
          itemId: state.itemId,
          itemKey: state.itemKey,
          paperTitle: state.paperTitle,
          activeSessionId: state.activeSessionId || undefined,
          sessions: state.sessions.map((s) => ({
            sessionId: s.sessionId,
            codexThreadId: s.codexThreadId || undefined,
            title: s.title,
            contextMode: s.contextMode,
            messages: s.messages.map((m) => ({ ...m })),
            contextPdf: this.normalizeContextPdfRef(s.contextPdf),
            summaryText: s.summaryText || "",
            summaryUpToIndex: Math.max(0, Number(s.summaryUpToIndex) || 0),
            summaryUpdatedAt: Number(s.summaryUpdatedAt) || 0,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        };
        this.diskByItemKey.set(persisted.itemKey, persisted);
        if (persisted.itemId && persisted.itemId > 0) {
          this.diskItemIdToKey.set(persisted.itemId, persisted.itemKey);
        }
        await ioUtils.writeUTF8(
          this.getStorageFilePath(persisted.itemKey),
          JSON.stringify(persisted, null, 2),
        );
      }
    } catch (e) {
      ztoolkit.log("[Agent] ChatStore flush error:", e);
    }
  }

  private newSessionId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildDefaultSessionTitle(index: number): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `Chat ${index} · ${hh}:${mm}`;
  }

  private isAutoGeneratedTitle(title: string): boolean {
    return (
      /^Chat\s+\d+\s+·\s+\d{2}:\d{2}$/.test(title) || /^Chat \d+$/.test(title)
    );
  }

  private maybeAutoTitleSession(_session: ChatSession, _message: ChatMessage) {
    // Title generation is now handled asynchronously via LLM after the first assistant reply.
  }

  needsAutoTitle(itemId: number): boolean {
    const session = this.getSession(itemId);
    if (!session) return false;
    if (!this.isAutoGeneratedTitle(session.title)) return false;
    const userMsgs = session.messages.filter((m) => m.role === "user");
    const assistantMsgs = session.messages.filter(
      (m) =>
        m.role === "assistant" && m.content && !m.content.startsWith("[Error]"),
    );
    return userMsgs.length === 1 && assistantMsgs.length === 1;
  }

  getFirstExchange(
    itemId: number,
  ): { userMsg: string; assistantMsg: string } | null {
    const session = this.getSession(itemId);
    if (!session) return null;
    const userMsg = session.messages.find((m) => m.role === "user");
    const assistantMsg = session.messages.find(
      (m) =>
        m.role === "assistant" && m.content && !m.content.startsWith("[Error]"),
    );
    if (!userMsg || !assistantMsg) return null;
    return { userMsg: userMsg.content, assistantMsg: assistantMsg.content };
  }

  private getItemMeta(itemId: number): { itemKey: string; title: string } {
    try {
      const item = Zotero.Items.get(itemId) as any;
      return {
        itemKey: String(item?.key || itemId),
        title: String(
          item?.getField?.("title") ||
            item?.getDisplayTitle?.() ||
            `Item ${itemId}`,
        ),
      };
    } catch (_e) {
      return { itemKey: String(itemId), title: `Item ${itemId}` };
    }
  }

  private normalizeContextMode(raw: any): ContextMode {
    if (raw === "agent") return "agent";
    // Backward compatibility for old chat/current-page sessions.
    if (raw === "currentPage" || raw === "none" || raw === "fullPdf")
      return "agent";
    return "agent";
  }

  private normalizeContextPdfRef(raw: any): SessionContextPdfRef | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const fileName = String(raw.fileName || "").trim();
    const fileSize = Math.max(0, Number(raw.fileSize) || 0);
    const addedAt = Math.max(0, Number(raw.addedAt) || 0) || Date.now();
    const itemKey = String(raw.itemKey || "").trim().toUpperCase();
    const hashRaw = String(raw.hash || "").trim();
    const explicitSource = raw.source === "library" ? "library" : raw.source === "upload" ? "upload" : null;

    let source: SessionContextPdfRef["source"];
    if (explicitSource) {
      source = explicitSource;
    } else if (/^[A-Z0-9]{8}$/.test(itemKey)) {
      source = "library";
    } else {
      source = "upload";
    }

    if (source === "library") {
      if (!/^[A-Z0-9]{8}$/.test(itemKey) || !fileName) return undefined;
      const itemId =
        typeof raw.itemId === "number" && Number.isFinite(raw.itemId)
          ? Number(raw.itemId)
          : undefined;
      return {
        source: "library",
        hash: hashRaw || `lib-${itemKey}`,
        fileName,
        fileSize,
        addedAt,
        itemKey,
        itemId,
      };
    }
    if (!hashRaw || !fileName) return undefined;
    return {
      source: "upload",
      hash: hashRaw.toLowerCase(),
      fileName,
      fileSize,
      addedAt,
    };
  }

  private getStorageDir(): string {
    const pathUtils = (globalThis as any).PathUtils;
    if (pathUtils?.join)
      return pathUtils.join(Zotero.DataDirectory.dir, "zoteroagent", "chats");
    return `${Zotero.DataDirectory.dir}/zoteroagent/chats`;
  }

  private getStorageFilePath(itemKey: string): string {
    const pathUtils = (globalThis as any).PathUtils;
    if (pathUtils?.join)
      return pathUtils.join(this.getStorageDir(), `${itemKey}.json`);
    return `${this.getStorageDir()}/${itemKey}.json`;
  }

  private async ensureStorageDir() {
    const ioUtils = (globalThis as any).IOUtils;
    if (!ioUtils) return;
    await ioUtils.makeDirectory(this.getStorageDir(), {
      createAncestors: true,
      ignoreExisting: true,
    });
  }
}

export const chatStore = new ChatStore();
