import { afterEach, describe, expect, it } from "vitest";
import { ChatStore } from "../src/services/chat-store";

const originalZotero = (globalThis as any).Zotero;

afterEach(() => {
  (globalThis as any).Zotero = originalZotero;
});

function installZoteroStub() {
  (globalThis as any).Zotero = {
    Items: {
      get: (itemId: number) => ({
        key: `KEY${itemId}`,
        getField: (field: string) =>
          field === "title" ? `Paper ${itemId}` : "",
        getDisplayTitle: () => `Paper ${itemId}`,
      }),
    },
    DataDirectory: { dir: "/tmp/zotero" },
  };
}

describe("ChatStore context digest", () => {
  it("stores a per-session model without breaking Codex thread continuity", () => {
    installZoteroStub();
    const store = new ChatStore();
    const session = store.createSession(7, "Main");
    store.updateCodexThreadId(7, "thread-existing", session?.sessionId);

    store.updateSessionModel(7, "gpt-5.6-terra", session?.sessionId);

    const updated = store.getSession(7);
    expect(updated?.modelSlug).toBe("gpt-5.6-terra");
    expect(updated?.codexThreadId).toBe("thread-existing");
  });

  it("clears codexThreadId when storing a context digest", () => {
    installZoteroStub();
    const store = new ChatStore();
    const session = store.createSession(7, "Main");
    expect(session).not.toBeNull();
    store.updateCodexThreadId(7, "thread-old", session?.sessionId);

    store.updateContextDigest(
      7,
      {
        contextDigest: "# Context Digest",
        contextDigestUpToMessageIndex: 2,
        contextDigestUpdatedAt: 123,
        contextDigestTokenEstimate: 4,
        contextDigestSource: "deterministic",
      },
      session?.sessionId,
    );

    const updated = store.getSession(7);
    expect(updated?.codexThreadId).toBe("");
    expect(updated?.contextDigest).toBe("# Context Digest");
  });

  it("clears digest metadata when truncating messages", () => {
    installZoteroStub();
    const store = new ChatStore();
    const session = store.createSession(7, "Main");
    store.addMessage(7, { role: "user", content: "one" });
    store.addMessage(7, { role: "assistant", content: "two" });
    store.updateContextDigest(
      7,
      {
        contextDigest: "# Context Digest",
        contextDigestUpToMessageIndex: 1,
        contextDigestUpdatedAt: 123,
        contextDigestTokenEstimate: 4,
        contextDigestSource: "deterministic",
      },
      session?.sessionId,
    );

    store.truncateMessagesFrom(7, 1);

    const updated = store.getSession(7);
    expect(updated?.contextDigest).toBeUndefined();
    expect(updated?.contextDigestUpToMessageIndex).toBeUndefined();
  });

  it("restores a deleted message at its original position", () => {
    installZoteroStub();
    const store = new ChatStore();
    store.createSession(7, "Main");
    store.addMessage(7, { role: "user", content: "first" });
    store.addMessage(7, { role: "assistant", content: "second" });
    store.updateContextDigest(7, {
      contextDigest: "# Context Digest",
      contextDigestUpToMessageIndex: 1,
      contextDigestUpdatedAt: 123,
      contextDigestTokenEstimate: 4,
      contextDigestSource: "deterministic",
    });

    const receipt = store.deleteMessage(7, 0);
    expect(store.getMessages(7).map((message) => message.content)).toEqual([
      "second",
    ]);

    expect(store.restoreMessage(receipt)).toEqual({ restored: true });
    expect(store.getMessages(7).map((message) => message.content)).toEqual([
      "first",
      "second",
    ]);
    expect(store.getSession(7)?.contextDigest).toBe("# Context Digest");
  });

  it("does not restore a message after a newer session change", () => {
    installZoteroStub();
    const store = new ChatStore();
    store.createSession(7, "Main");
    store.addMessage(7, { role: "user", content: "first" });
    store.addMessage(7, { role: "assistant", content: "second" });

    const receipt = store.deleteMessage(7, 0);
    store.addMessage(7, { role: "user", content: "newer" });

    expect(store.restoreMessage(receipt)).toEqual({
      restored: false,
      reason: "stale",
    });
    expect(store.getMessages(7).map((message) => message.content)).toEqual([
      "second",
      "newer",
    ]);
  });

  it("restores a deleted active session and selects it again", () => {
    installZoteroStub();
    const store = new ChatStore();
    const first = store.createSession(7, "First");
    const second = store.createSession(7, "Second");
    expect(second?.sessionId).toBe(store.getActiveSessionId(7));

    const receipt = store.deleteSession(7, second?.sessionId);
    expect(store.getSession(7)?.title).toBe("First");

    expect(store.restoreSession(receipt)).toEqual({ restored: true });
    expect(store.getSession(7)?.sessionId).toBe(second?.sessionId);
    expect(store.listSessions(7).map((session) => session.title)).toContain(
      first?.title,
    );
  });
});
