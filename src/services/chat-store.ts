import type { ChatMessage, ChatSession } from "../addon";
import type { ContextDigestState } from "./context-digest";
import {
  isValidPersistedItem,
  normalizePersistedItem,
  serializeItemState,
  type PersistedItemStateV2,
} from "./chat-persist";

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

export class ChatStore {
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
        const parsed = JSON.parse(raw);
        if (!isValidPersistedItem(parsed)) continue;
        const migrated = normalizePersistedItem(parsed);
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

  createSession(itemId: number, title?: string): ChatSession | null {
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

  addMessage(itemId: number, message: ChatMessage) {
    if (itemId <= 0) return;
    let session = this.getSession(itemId);
    if (!session) {
      session = this.createSession(itemId);
      if (!session) return;
    }
    if (!message.timestamp) message.timestamp = Date.now();
    session.messages.push(message);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  clearSession(itemId: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    session.messages = [];
    this.clearSessionDigest(session);
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
    this.clearSessionDigest(session);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  truncateMessagesFrom(itemId: number, fromIndex: number) {
    const session = this.getSession(itemId);
    if (!session) return;
    if (fromIndex < 0 || fromIndex >= session.messages.length) return;
    session.messages.splice(fromIndex);
    this.clearSessionDigest(session);
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  touchSession(itemId: number) {
    const session = this.getSession(itemId);
    if (!session) return;
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

  updateContextDigest(
    itemId: number,
    digest: ContextDigestState,
    sessionId?: string,
  ) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const targetId = sessionId || state.activeSessionId || "";
    const session = state.sessions.find((s) => s.sessionId === targetId);
    if (!session) return;
    session.contextDigest = String(digest.contextDigest || "").trim();
    session.contextDigestUpToMessageIndex =
      typeof digest.contextDigestUpToMessageIndex === "number"
        ? digest.contextDigestUpToMessageIndex
        : undefined;
    session.contextDigestUpdatedAt =
      typeof digest.contextDigestUpdatedAt === "number"
        ? digest.contextDigestUpdatedAt
        : undefined;
    session.contextDigestTokenEstimate =
      typeof digest.contextDigestTokenEstimate === "number"
        ? digest.contextDigestTokenEstimate
        : undefined;
    session.contextDigestSource = digest.contextDigestSource;
    session.codexThreadId = "";
    session.updatedAt = Date.now();
    this.markDirty(itemId);
  }

  clearContextDigest(itemId: number, sessionId?: string) {
    const state = this.getItemState(itemId);
    if (!state) return;
    const targetId = sessionId || state.activeSessionId || "";
    const session = state.sessions.find((s) => s.sessionId === targetId);
    if (!session) return;
    this.clearSessionDigest(session);
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
        contextDigest: s.contextDigest || "",
        contextDigestUpToMessageIndex: s.contextDigestUpToMessageIndex,
        contextDigestUpdatedAt: s.contextDigestUpdatedAt,
        contextDigestTokenEstimate: s.contextDigestTokenEstimate,
        contextDigestSource: s.contextDigestSource,
        title: s.title,
        messages: s.messages.map((m) => ({ ...m })),
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

  private clearSessionDigest(session: ChatSession) {
    delete session.contextDigest;
    delete session.contextDigestUpToMessageIndex;
    delete session.contextDigestUpdatedAt;
    delete session.contextDigestTokenEstimate;
    delete session.contextDigestSource;
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
        const persisted = serializeItemState(state);
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
