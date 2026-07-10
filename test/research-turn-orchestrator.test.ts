import { describe, expect, it } from "vitest";
import { CodexTurnError, type SemanticRelationship } from "../src/services/codex";
import {
  runResearchTurn,
  type ResearchTurnDeps,
  type ResearchTurnRequest,
} from "../src/services/research-turn/orchestrator";

const paper = {
  itemId: 1,
  itemKey: "ITEM1",
  title: "Paper",
  creators: "A. Researcher",
  year: "2024",
};

function request(overrides: Partial<ResearchTurnRequest> = {}): ResearchTurnRequest {
  return {
    paper,
    pdfItemId: 10,
    question: "Compare.",
    mentionedPapers: [],
    session: { sessionId: "chat-1", codexThreadId: "" },
    priorVisibleMessages: [],
    userDisplayContent: "Compare.",
    ...overrides,
  };
}

function relationship(targetItemKey: string): SemanticRelationship {
  return {
    sourceItemKey: "ITEM1",
    targetItemKey,
    type: "extends",
    rationale: "same method family.",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function deps(overrides: Partial<ResearchTurnDeps> = {}): ResearchTurnDeps {
  const defaults: ResearchTurnDeps = {
    ensurePaperVault: async () => ({
      vaultDir: "/vault",
      paperDir: "/vault/ITEM1",
      textPath: "/vault/ITEM1/text.txt",
      memoryPath: "/vault/ITEM1/memory.md",
      recordPath: "/vault/ITEM1/record.json",
      conversationsDir: "/vault/ITEM1/conversations",
    }),
    readPaperMemory: async () => "memory",
    refreshPaperRecordProjection: async () => [],
    readPaperCompactContext: async (mentioned) =>
      `# ${mentioned.title}\n\n## Contribution\n- Related.`,
    runCodexTurn: async () => ({
      content: "answer",
      reasoning: "thought",
      threadId: "thread-new",
      usage: { promptTokens: 10 },
    }),
    appendConversationTurn: async () => undefined,
    commitVaultChanges: async () => true,
    appendVaultLog: async () => undefined,
  };
  return { ...defaults, ...overrides };
}

describe("runResearchTurn", () => {
  it("runs the happy path and reports memory / relationship / commit state", async () => {
    const calls: string[] = [];
    const relationshipsBefore = [relationship("OLD")];
    const relationshipsAfter = [...relationshipsBefore, relationship("NEW")];
    let memoryRead = 0;
    let projectionRead = 0;
    const outcome = await runResearchTurn(
      request({
        mentionedPapers: [{ itemKey: "OTHER", title: "Other Paper" }],
      }),
      {},
      deps({
        ensurePaperVault: async () => {
          calls.push("ensure");
          return {} as any;
        },
        readPaperMemory: async () => {
          calls.push("memory");
          return memoryRead++ === 0 ? "before" : "after";
        },
        refreshPaperRecordProjection: async () => {
          calls.push("projection");
          return projectionRead++ === 0 ? relationshipsBefore : relationshipsAfter;
        },
        runCodexTurn: async (input) => {
          calls.push("run");
          expect(input.threadId).toBe("");
          expect(input.prompt).toContain("Hidden Context Digest");
          expect(input.prompt).toContain("Other Paper");
          return {
            content: "answer",
            reasoning: "",
            threadId: "thread-1",
          };
        },
        appendConversationTurn: async () => {
          calls.push("append");
        },
        commitVaultChanges: async () => {
          calls.push("commit");
          return true;
        },
      }),
    );

    expect(calls).toEqual([
      "ensure",
      "memory",
      "projection",
      "run",
      "append",
      "memory",
      "projection",
      "commit",
    ]);
    expect(outcome.memoryUpdated).toBe(true);
    expect(outcome.relationshipUpdates).toEqual([relationship("NEW")]);
    expect(outcome.committed).toBe(true);
    expect(outcome.resumedFreshThread).toBe(false);
  });

  it("uses resume mode when a Codex thread exists", async () => {
    const outcome = await runResearchTurn(
      request({
        session: {
          sessionId: "chat-1",
          codexThreadId: "thread-existing",
          contextDigest: "# Context Digest",
        },
        priorVisibleMessages: [{ role: "user", content: "prior" }],
      }),
      {},
      deps({
        runCodexTurn: async (input) => {
          expect(input.threadId).toBe("thread-existing");
          expect(input.prompt).toContain("Thread context mode: resume");
          expect(input.prompt).not.toContain("# Context Digest");
          expect(input.prompt).not.toContain("prior");
          return { content: "answer", reasoning: "", threadId: "thread-existing" };
        },
      }),
    );
    expect(outcome.threadId).toBe("thread-existing");
  });

  it("retries once as a fresh thread when resume fails", async () => {
    const threadIds: string[] = [];
    const prompts: string[] = [];
    const logs: string[] = [];
    const outcome = await runResearchTurn(
      request({
        session: {
          sessionId: "chat-1",
          codexThreadId: "thread-bad",
          contextDigest: "# Context Digest",
          contextDigestUpToMessageIndex: 0,
        },
        priorVisibleMessages: [
          { role: "user", content: "covered" },
          { role: "user", content: "recent" },
        ],
      }),
      {},
      deps({
        runCodexTurn: async (input) => {
          threadIds.push(input.threadId || "");
          prompts.push(input.prompt);
          if (threadIds.length === 1) {
            throw new CodexTurnError({
              message: "resume failed",
              exitCode: 1,
            });
          }
          return { content: "answer", reasoning: "", threadId: "thread-fresh" };
        },
        appendVaultLog: async (kind) => {
          logs.push(kind);
        },
      }),
    );

    expect(threadIds).toEqual(["thread-bad", ""]);
    expect(prompts[0]).toContain("Thread context mode: resume");
    expect(prompts[1]).toContain("# Context Digest");
    expect(prompts[1]).toContain("recent");
    expect(prompts[1]).not.toContain("covered");
    expect(logs).toContain("codex-resume-fallback");
    expect(outcome.resumedFreshThread).toBe(true);
    expect(outcome.threadId).toBe("thread-fresh");
  });

  it("does not retry timed out resume turns", async () => {
    const logs: string[] = [];
    await expect(
      runResearchTurn(
        request({
          session: { sessionId: "chat-1", codexThreadId: "thread-bad" },
        }),
        {},
        deps({
          runCodexTurn: async () => {
            throw new CodexTurnError({
              message: "timeout",
              timedOut: true,
            });
          },
          appendVaultLog: async (kind) => {
            logs.push(kind);
          },
        }),
      ),
    ).rejects.toThrow("timeout");
    expect(logs).not.toContain("codex-resume-fallback");
    expect(logs).toContain("chat-turn-error");
  });

  it("does not retry non-Codex failures even when resuming", async () => {
    let attempts = 0;
    const logs: string[] = [];
    await expect(
      runResearchTurn(
        request({
          session: { sessionId: "chat-1", codexThreadId: "thread-existing" },
        }),
        {},
        deps({
          runCodexTurn: async () => {
            attempts++;
            throw new Error("codex binary not found");
          },
          appendVaultLog: async (kind) => {
            logs.push(kind);
          },
        }),
      ),
    ).rejects.toThrow("codex binary not found");
    expect(attempts).toBe(1);
    expect(logs).not.toContain("codex-resume-fallback");
  });
});
