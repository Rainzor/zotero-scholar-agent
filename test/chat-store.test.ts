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
        getField: (field: string) => (field === "title" ? `Paper ${itemId}` : ""),
        getDisplayTitle: () => `Paper ${itemId}`,
      }),
    },
    DataDirectory: { dir: "/tmp/zotero" },
  };
}

describe("ChatStore context digest", () => {
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
});
