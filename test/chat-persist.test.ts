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
    expect(
      isValidPersistedItem({ version: 1, itemKey: "x", sessions: [] }),
    ).toBe(false);
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
            modelSlug: "gpt-5.6-sol",
            title: "Chat 1",
            contextMode: "currentPage" as any,
            summaryText: "old summary",
            summaryUpToIndex: 3,
            contextDigest: "# Context Digest\n\n## Coverage",
            contextDigestUpToMessageIndex: 4,
            contextDigestUpdatedAt: 12345,
            contextDigestTokenEstimate: 12,
            contextDigestSource: "codex-default",
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
          modelSlug: "gpt-5.6-sol",
          contextDigest: "# Context Digest\n\n## Coverage",
          contextDigestUpToMessageIndex: 4,
          contextDigestUpdatedAt: 12345,
          contextDigestTokenEstimate: 12,
          contextDigestSource: "codex-default",
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
          modelSlug: "gpt-5.6-terra",
          contextDigest: "# Context Digest\n\n## Coverage",
          contextDigestUpToMessageIndex: 0,
          contextDigestUpdatedAt: 123,
          contextDigestTokenEstimate: 8,
          contextDigestSource: "deterministic",
          title: "Main",
          messages: [
            {
              role: "assistant",
              content: "ok",
              contextPapers: [{ itemKey: "P2", title: "Paper 2" }],
              relationshipUpdates: [
                {
                  sourceItemKey: "KEY7",
                  targetItemKey: "P2",
                  type: "extends",
                  rationale: "builds on the same problem framing.",
                  updatedAt: "2026-07-09T00:00:00.000Z",
                },
              ],
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(serialized.sessions[0].contextMode).toBe("agent");
    expect(serialized.sessions[0].codexThreadId).toBe("thread_x");
    expect(serialized.sessions[0].modelSlug).toBe("gpt-5.6-terra");
    expect(serialized.sessions[0].contextDigest).toContain("# Context Digest");

    const again = normalizePersistedItem(serialized, { now: 3 });
    expect(again.sessions[0]).toMatchObject({
      contextDigest: "# Context Digest\n\n## Coverage",
      modelSlug: "gpt-5.6-terra",
      contextDigestUpToMessageIndex: 0,
      contextDigestUpdatedAt: 123,
      contextDigestTokenEstimate: 8,
      contextDigestSource: "deterministic",
    });
    expect(again.sessions[0].messages).toEqual([
      {
        role: "assistant",
        content: "ok",
        contextPapers: [{ itemKey: "P2", title: "Paper 2" }],
        relationshipUpdates: [
          {
            sourceItemKey: "KEY7",
            targetItemKey: "P2",
            type: "extends",
            rationale: "builds on the same problem framing.",
            updatedAt: "2026-07-09T00:00:00.000Z",
          },
        ],
      },
    ]);
  });
});
