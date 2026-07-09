import { describe, expect, it } from "vitest";
import {
  isValidPersistedItem,
  normalizePersistedItem,
  serializeItemState,
} from "../src/services/chat-persist";

describe("isValidPersistedItem", () => {
  it("accepts version-2 blobs with itemKey + sessions", () => {
    expect(
      isValidPersistedItem({
        version: 2,
        itemKey: "PXW99EKT",
        sessions: [],
      }),
    ).toBe(true);
  });

  it("rejects legacy or incomplete blobs", () => {
    expect(isValidPersistedItem(null)).toBe(false);
    expect(isValidPersistedItem({ version: 1, itemKey: "x", sessions: [] })).toBe(
      false,
    );
    expect(isValidPersistedItem({ version: 2, sessions: [] })).toBe(false);
  });
});

describe("normalizePersistedItem", () => {
  it("drops legacy summary fields and coerces contextMode to agent", () => {
    const normalized = normalizePersistedItem(
      {
        version: 2,
        itemId: 42,
        itemKey: "PXW99EKT",
        paperTitle: "Attention",
        activeSessionId: "chat-1",
        sessions: [
          {
            sessionId: "chat-1",
            title: "Chat 1",
            contextMode: "currentPage" as any,
            summaryText: "old summary",
            summaryUpToIndex: 3,
            messages: [{ role: "user", content: "hi" }],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      },
      { now: 999 },
    );

    expect(normalized).toEqual({
      version: 2,
      itemId: 42,
      itemKey: "PXW99EKT",
      paperTitle: "Attention",
      activeSessionId: "chat-1",
      sessions: [
        {
          sessionId: "chat-1",
          codexThreadId: "",
          title: "Chat 1",
          contextMode: "agent",
          messages: [{ role: "user", content: "hi" }],
          createdAt: 100,
          updatedAt: 200,
        },
      ],
    });
    expect(JSON.stringify(normalized)).not.toContain("summaryText");
  });

  it("fills missing session ids", () => {
    let n = 0;
    const normalized = normalizePersistedItem(
      {
        version: 2,
        itemKey: "KEY",
        sessions: [{ title: "Untitled", messages: [] }],
      },
      { now: 1, newId: () => `id-${++n}` },
    );
    expect(normalized.sessions[0].sessionId).toBe("id-1");
    expect(normalized.activeSessionId).toBe("id-1");
  });
});

describe("serializeItemState", () => {
  it("round-trips through normalize without summary fields", () => {
    const serialized = serializeItemState({
      itemId: 7,
      itemKey: "KEY7",
      paperTitle: "Paper",
      activeSessionId: "s1",
      sessions: [
        {
          sessionId: "s1",
          codexThreadId: "thread_x",
          title: "Main",
          messages: [{ role: "assistant", content: "ok" }],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(serialized.sessions[0].contextMode).toBe("agent");
    expect(serialized.sessions[0].codexThreadId).toBe("thread_x");

    const again = normalizePersistedItem(serialized, { now: 3 });
    expect(again.sessions[0].messages).toEqual([
      { role: "assistant", content: "ok" },
    ]);
  });
});
