import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../src/addon";
import {
  DefaultChatSendFlow,
  type ChatFlowStore,
  type ChatSubmission,
} from "../src/services/chat-actions/flow";

function submission(
  text: string,
  options: { itemId?: number; sessionId?: string } = {},
): ChatSubmission {
  const itemId = options.itemId || 7;
  const sessionId = options.sessionId || "chat-1";
  return {
    itemId,
    paper: {
      itemId,
      itemKey: `KEY${itemId}`,
      title: "Paper",
      creators: "A. Researcher",
      year: "2026",
    },
    pdfItemId: 70,
    session: {
      sessionId,
      codexThreadId: "",
      modelSlug: "",
    },
    text,
    selectedText: "",
    responseQuote: "",
    mentionedPapers: [],
    imageRefs: [],
    imagePaths: [],
    priorVisibleMessages: [],
    displayContent: text,
    conversationDisplayContent: text,
  };
}

class MemoryStore implements ChatFlowStore {
  messages: ChatMessage[] = [];

  constructor(
    private readonly itemId = 7,
    private readonly itemKey = "KEY7",
    private readonly sessionId = "chat-1",
  ) {}

  addMessage(_itemId: number, message: ChatMessage): void {
    this.messages.push(message);
  }

  updateAction(
    _itemId: number,
    actionId: string,
    update: (
      action: NonNullable<ChatMessage["action"]>,
    ) => NonNullable<ChatMessage["action"]>,
  ): boolean {
    const message = this.messages.find(
      (entry) => entry.action?.id === actionId,
    );
    if (!message?.action) return false;
    message.action = update(message.action);
    return true;
  }

  findAction(actionId: string) {
    const message = this.messages.find(
      (entry) => entry.action?.id === actionId,
    );
    return message?.action
      ? {
          itemId: this.itemId,
          itemKey: this.itemKey,
          sessionId: this.sessionId,
          message,
          action: message.action,
        }
      : null;
  }

  touchSession(): void {}
}

function createFlow(
  deps: ConstructorParameters<typeof DefaultChatSendFlow>[0],
) {
  return new DefaultChatSendFlow({
    getVaultHeadSha: async () => "abcdef1",
    verifyVaultCommitReceipt: async () => undefined,
    restoreVaultPathsFromHead: async () => undefined,
    ...deps,
  });
}

describe("DefaultChatSendFlow", () => {
  it("runs /note as a durable action without using the research turn", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const flow = createFlow({
      store,
      runResearch: async () => {
        calls.push("research");
      },
      organizeNote: async (request) => {
        calls.push("note");
        expect(request.content).toBe("The baseline is under-controlled.");
        return {
          summary: "Captured a baseline critique.",
          targetPath: "KEY7/notes.md",
          section: "Thoughts and Critique",
          markdown: "- The baseline is under-controlled.",
        };
      },
      captureVaultTextFiles: async (paths) => {
        calls.push("capture");
        return paths.map((relativePath) => ({
          relativePath,
          existed: false,
          content: "",
        }));
      },
      assertVaultPathsClean: async () => {
        calls.push("clean");
      },
      appendPaperNote: async (request) => {
        calls.push("append");
        expect(request).toMatchObject({
          itemKey: "KEY7",
          actionId: "action-1",
          commit: false,
        });
        return false;
      },
      restoreVaultTextFiles: async () => {
        calls.push("restore");
      },
      appendConversationTurn: async (request) => {
        calls.push("conversation");
        expect(request.userMessage).toBe(
          "/note The baseline is under-controlled.",
        );
      },
      commitVaultPaths: async (_message, paths) => {
        calls.push("commit");
        expect(paths).toEqual([
          "KEY7/notes.md",
          "KEY7/conversations/chat-1.md",
        ]);
        return {
          commitSha: "abc",
          parentSha: "def",
          changedPaths: paths,
        };
      },
      now: () => 100,
      newActionId: () => "action-1",
    });

    await flow.submit(
      submission("/note The baseline is under-controlled."),
      {},
    );

    expect(calls).toEqual([
      "note",
      "clean",
      "capture",
      "append",
      "conversation",
      "commit",
    ]);
    expect(store.messages[0]).toMatchObject({
      role: "user",
      content: "/note The baseline is under-controlled.",
    });
    expect(store.messages[1].action).toMatchObject({
      id: "action-1",
      kind: "note.organize",
      state: "completed",
      result: {
        summary: "Captured a baseline critique.",
        section: "Thoughts and Critique",
        committed: true,
        commitReceipt: {
          commitSha: "abc",
          parentSha: "def",
        },
      },
      request: {
        pdfItemId: 70,
        selectedText: "",
        responseQuote: "",
        mentionedPapers: [],
        images: [],
      },
    });
  });

  it("returns unknown command help without starting Codex", async () => {
    const store = new MemoryStore();
    let researchRuns = 0;
    const flow = createFlow({
      store,
      runResearch: async () => {
        researchRuns += 1;
      },
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
    });

    await flow.submit(submission("/unknown"), {});

    expect(researchRuns).toBe(0);
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1].content).toContain("/note");
  });

  it("passes ordinary questions directly to the existing research turn", async () => {
    const store = new MemoryStore();
    let received = "";
    const flow = createFlow({
      store,
      runResearch: async (request) => {
        received = request.text;
      },
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
    });

    await flow.submit(submission("What does Figure 3 establish?"), {});

    expect(received).toBe("What does Figure 3 establish?");
    expect(store.messages).toHaveLength(0);
  });

  it("kills a Codex process that starts after the user cancels", async () => {
    const store = new MemoryStore();
    let startProcess: (() => void) | undefined;
    let killed = false;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async (request) =>
        new Promise((_resolve, reject) => {
          startProcess = () => {
            request.onProcess?.({
              wait: async () => ({
                stdout: "",
                stderr: "",
                exitCode: -1,
                timedOut: false,
              }),
              kill: () => {
                killed = true;
              },
            });
            reject(new Error("cancelled"));
          };
        }),
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      newActionId: () => "action-1",
    });

    const pending = flow.submit(submission("/note observation"), {});
    await Promise.resolve();
    flow.cancel(7, "chat-1");
    startProcess?.();
    await pending;

    expect(killed).toBe(true);
    expect(store.messages[1].action?.state).toBe("cancelled");
  });

  it("does not retry until the cancelled execution has fully exited", async () => {
    const store = new MemoryStore();
    let rejectFirst: ((error: Error) => void) | undefined;
    let runs = 0;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        runs += 1;
        if (runs === 1) {
          return new Promise((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return {
          summary: "Captured.",
          targetPath: "KEY7/notes.md",
          section: "Thoughts and Critique",
          markdown: "- Observation.",
        };
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => ({
        commitSha: "commit-2",
        parentSha: "commit-1",
        changedPaths: ["KEY7/notes.md", "KEY7/conversations/chat-1.md"],
      }),
      newActionId: () => "action-1",
    });

    const first = flow.submit(submission("/note observation"), {});
    await Promise.resolve();
    flow.cancel(7, "chat-1");
    await flow.decide("action-1", "retry", {});
    expect(runs).toBe(1);

    rejectFirst?.(new Error("cancelled"));
    await first;
    await flow.decide("action-1", "retry", {});

    expect(runs).toBe(2);
    expect(store.messages[1].action?.state).toBe("completed");
  });

  it("prevents a second action from running concurrently in one session", async () => {
    const store = new MemoryStore();
    let finishFirst: (() => void) | undefined;
    let runs = 0;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        runs += 1;
        if (runs === 1) {
          return new Promise((resolve) => {
            finishFirst = () =>
              resolve({
                summary: "First.",
                targetPath: "KEY7/notes.md",
                section: "Thoughts and Critique",
                markdown: "- First.",
              });
          });
        }
        return {
          summary: "Second.",
          targetPath: "KEY7/notes.md",
          section: "Thoughts and Critique",
          markdown: "- Second.",
        };
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => ({
        commitSha: `commit-${runs}`,
        parentSha: "parent",
        changedPaths: ["KEY7/notes.md", "KEY7/conversations/chat-1.md"],
      }),
      newActionId: (() => {
        let id = 0;
        return () => `action-${++id}`;
      })(),
    });

    const first = flow.submit(submission("/note first"), {});
    await Promise.resolve();
    await flow.submit(submission("/note second"), {});

    expect(runs).toBe(1);
    expect(store.messages).toHaveLength(2);
    expect(flow.canSubmit()).toBe(false);

    finishFirst?.();
    await first;
  });

  it("prevents concurrent actions across separate sidebar flow instances", async () => {
    const firstStore = new MemoryStore();
    const secondStore = new MemoryStore(8, "KEY8", "chat-2");
    let finishFirst: (() => void) | undefined;
    let secondRuns = 0;
    const common = {
      runResearch: async () => undefined,
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
    };
    const firstFlow = createFlow({
      ...common,
      store: firstStore,
      organizeNote: async () =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              summary: "First.",
              targetPath: "KEY7/notes.md",
              section: "Thoughts and Critique",
              markdown: "- First.",
            });
        }),
      newActionId: () => "action-first",
    });
    const secondFlow = createFlow({
      ...common,
      store: secondStore,
      organizeNote: async () => {
        secondRuns += 1;
        throw new Error("not expected");
      },
      newActionId: () => "action-second",
    });

    const first = firstFlow.submit(submission("/note first"), {});
    await Promise.resolve();
    await secondFlow.submit(
      submission("/note second", { itemId: 8, sessionId: "chat-2" }),
      {},
    );

    expect(secondRuns).toBe(0);
    expect(secondStore.messages).toEqual([]);
    expect(secondFlow.canSubmit()).toBe(false);

    finishFirst?.();
    await first;
  });

  it("does not start an action while a research turn is running", async () => {
    const researchStore = new MemoryStore();
    const actionStore = new MemoryStore(8, "KEY8", "chat-2");
    let finishResearch: (() => void) | undefined;
    let actionRuns = 0;
    const common = {
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
    };
    const researchFlow = createFlow({
      ...common,
      store: researchStore,
      runResearch: async () =>
        new Promise<void>((resolve) => {
          finishResearch = resolve;
        }),
      organizeNote: async () => {
        throw new Error("not expected");
      },
    });
    const actionFlow = createFlow({
      ...common,
      store: actionStore,
      runResearch: async () => undefined,
      organizeNote: async () => {
        actionRuns += 1;
        throw new Error("not expected");
      },
      newActionId: () => "action-2",
    });

    const research = researchFlow.submit(
      submission("What is the contribution?"),
      {},
    );
    await Promise.resolve();
    await actionFlow.submit(
      submission("/note observation", {
        itemId: 8,
        sessionId: "chat-2",
      }),
      {},
    );

    expect(actionRuns).toBe(0);
    expect(actionStore.messages).toEqual([]);
    expect(actionFlow.canSubmit()).toBe(false);

    finishResearch?.();
    await research;
  });

  it("cancels a research process that starts after Stop is pressed", async () => {
    const store = new MemoryStore();
    let startProcess: (() => void) | undefined;
    let killed = false;
    const flow = createFlow({
      store,
      runResearch: async (_request, sink) =>
        new Promise<void>((resolve) => {
          startProcess = () => {
            sink.onProcess?.({
              wait: async () => ({
                stdout: "",
                stderr: "",
                exitCode: -1,
                timedOut: false,
              }),
              kill: () => {
                killed = true;
                resolve();
              },
            });
          };
        }),
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
    });

    const pending = flow.submit(submission("What is the contribution?"), {});
    await Promise.resolve();
    flow.cancel(7, "chat-1");
    startProcess?.();
    await pending;

    expect(killed).toBe(true);
    expect(flow.canSubmit()).toBe(true);
  });

  it("writes a cancellation entry to the Conversation Log", async () => {
    const store = new MemoryStore();
    let rejectRun: ((error: Error) => void) | undefined;
    const entries: string[] = [];
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
      appendConversationTurn: async (request) => {
        entries.push(request.assistantMessage);
      },
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => ({
        commitSha: "cancel-log",
        parentSha: "parent",
        changedPaths: ["KEY7/conversations/chat-1.md"],
      }),
      newActionId: () => "action-1",
    });

    const pending = flow.submit(submission("/note observation"), {});
    await Promise.resolve();
    flow.cancel(7, "chat-1");
    rejectRun?.(new Error("cancelled"));
    await pending;

    expect(entries).toEqual(["[Action cancelled] Cancelled by user."]);
    expect(store.messages[1].action?.state).toBe("cancelled");
  });

  it("surfaces a cancelled action when its Conversation Log cannot be saved", async () => {
    const store = new MemoryStore();
    let rejectRun: ((error: Error) => void) | undefined;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => {
        throw new Error("target has uncommitted changes");
      },
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      newActionId: () => "action-1",
    });

    const pending = flow.submit(submission("/note observation"), {});
    await Promise.resolve();
    flow.cancel(7, "chat-1");
    rejectRun?.(new Error("cancelled"));
    await pending;

    expect(store.messages[1].action).toMatchObject({
      state: "cancelled",
      error: {
        code: "cancelled-log-failed",
        retryable: true,
      },
    });
    expect(store.messages[1].action?.error?.message).toContain(
      "target has uncommitted changes",
    );
  });

  it("undoes a completed rating action with a compensating Vault commit", async () => {
    const store = new MemoryStore();
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      revertVaultCommit: async (commitSha) => {
        expect(commitSha).toBe("action-commit");
        return {
          commitSha: "undo-commit",
          parentSha: "action-commit",
          changedPaths: ["KEY7/memory.md"],
        };
      },
    });
    store.addMessage(7, {
      role: "assistant",
      content: "",
      action: {
        version: 1,
        id: "rating-action",
        kind: "paper.rating.set",
        state: "completed",
        trigger: { source: "slash-command", text: "/rate 5" },
        capabilities: ["vault.write"],
        request: {
          itemId: 7,
          itemKey: "KEY7",
          sessionId: "chat-1",
          paperTitle: "Paper",
          text: "/rate 5",
          rating: 5,
        },
        target: {
          itemKey: "KEY7",
          path: "KEY7/memory.md",
          section: "Overview",
        },
        result: {
          summary: "Rating set to 5.",
          committed: true,
          commitReceipt: {
            commitSha: "action-commit",
            parentSha: "before",
            changedPaths: ["KEY7/memory.md"],
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
    });

    await flow.undo("rating-action", {});

    expect(store.messages[0].action).toMatchObject({
      state: "undone",
      result: {
        summary: "Action undone.",
        undoCommitReceipt: { commitSha: "undo-commit" },
      },
    });
  });

  it("keeps an action completed when Vault HEAD has newer updates", async () => {
    const store = new MemoryStore();
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      revertVaultCommit: async () => {
        throw new Error("Vault has newer updates.");
      },
    });
    store.addMessage(7, {
      role: "assistant",
      content: "",
      action: {
        version: 1,
        id: "depth-action",
        kind: "paper.depth.set",
        state: "completed",
        trigger: { source: "slash-command", text: "/depth L2" },
        capabilities: ["codex.read", "vault.write"],
        request: {
          itemId: 7,
          itemKey: "KEY7",
          sessionId: "chat-1",
          paperTitle: "Paper",
          text: "/depth L2",
          targetTier: "L2",
        },
        target: {
          itemKey: "KEY7",
          path: "KEY7/memory.md",
          section: "Overview",
        },
        result: {
          summary: "Depth changed.",
          committed: true,
          commitReceipt: {
            commitSha: "action-commit",
            parentSha: "before",
            changedPaths: ["KEY7/memory.md"],
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
    });

    await flow.undo("depth-action", {});

    expect(store.messages[0].action).toMatchObject({
      state: "completed",
      error: {
        code: "undo-failed",
        message: "Vault has newer updates.",
      },
    });
  });

  it("undoes a Note by appending a retraction instead of deleting text", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async (request) => {
        calls.push("retract");
        expect(request).toMatchObject({
          itemKey: "KEY7",
          section: "Actions",
          actionId: "note-action",
          commit: false,
        });
        expect(request.content).toContain("Retracted action");
        return false;
      },
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [
        {
          relativePath: "KEY7/notes.md",
          existed: true,
          content: "original note",
        },
      ],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async (_message, paths) => {
        calls.push("commit");
        expect(paths).toEqual(["KEY7/notes.md"]);
        return {
          commitSha: "undo-note",
          parentSha: "note-commit",
          changedPaths: paths,
        };
      },
      getVaultHeadSha: async () => "note-commit",
      verifyVaultCommitReceipt: async (receipt) => {
        expect(receipt.commitSha).toBe("note-commit");
      },
    });
    store.addMessage(7, {
      role: "assistant",
      content: "",
      action: {
        version: 1,
        id: "note-action",
        kind: "note.organize",
        state: "completed",
        trigger: { source: "slash-command", text: "/note action" },
        capabilities: ["codex.read", "vault.write"],
        request: {
          itemId: 7,
          itemKey: "KEY7",
          sessionId: "chat-1",
          paperTitle: "Paper",
          text: "/note action",
          content: "action",
        },
        target: {
          itemKey: "KEY7",
          path: "KEY7/notes.md",
          section: "Thinking",
        },
        result: {
          summary: "Saved.",
          section: "Actions",
          committed: true,
          commitReceipt: {
            commitSha: "note-commit",
            parentSha: "before",
            changedPaths: ["KEY7/notes.md"],
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
    });

    await flow.undo("note-action", {});

    expect(calls).toEqual(["retract", "commit"]);
    expect(store.messages[0].action).toMatchObject({
      state: "undone",
      result: { undoCommitReceipt: { commitSha: "undo-note" } },
    });
  });

  it("rejects a persisted action whose request does not match its session", async () => {
    const store = new MemoryStore();
    let runs = 0;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        runs += 1;
        throw new Error("not expected");
      },
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      newActionId: () => "action-1",
    });

    await flow.submit(submission("/note observation"), {});
    const action = store.messages[1].action!;
    store.messages[1].action = {
      ...action,
      state: "failed",
      request: { ...action.request, sessionId: "other-session" },
      error: {
        code: "interrupted",
        message: "Interrupted.",
        retryable: true,
      },
    };

    await flow.decide("action-1", "retry", {});

    expect(runs).toBe(1);
    expect(store.messages[1].action).toMatchObject({
      state: "failed",
      error: { code: "invalid-snapshot", retryable: false },
    });
  });

  it("restores Vault files when the scoped commit fails", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    let commitAttempts = 0;
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => ({
        summary: "Captured.",
        targetPath: "KEY7/notes.md",
        section: "Thoughts and Critique",
        markdown: "- Observation.",
      }),
      appendPaperNote: async () => {
        calls.push("append");
        return false;
      },
      appendConversationTurn: async () => {
        calls.push("conversation");
      },
      assertVaultPathsClean: async () => {
        calls.push("clean");
      },
      captureVaultTextFiles: async (paths) => {
        calls.push("capture");
        return paths.map((relativePath) => ({
          relativePath,
          existed: true,
          content: "before",
        }));
      },
      restoreVaultTextFiles: async () => {
        calls.push("restore");
      },
      commitVaultPaths: async () => {
        calls.push("commit");
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error("commit failed");
        return {
          commitSha: "failure-log",
          parentSha: "before",
          changedPaths: ["KEY7/conversations/chat-1.md"],
        };
      },
      newActionId: () => "action-1",
    });

    await flow.submit(submission("/note observation"), {});

    expect(calls).toEqual([
      "clean",
      "capture",
      "append",
      "conversation",
      "commit",
      "restore",
      "clean",
      "capture",
      "conversation",
      "commit",
    ]);
    expect(store.messages[1].action).toMatchObject({
      state: "failed",
      error: { message: "commit failed", retryable: true },
    });
  });

  it("preserves the original submission in the Conversation Log when Codex fails", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("provider unavailable");
      },
      appendPaperNote: async () => false,
      appendConversationTurn: async (request) => {
        calls.push("conversation");
        expect(request.userMessage).toBe("/note observation");
        expect(request.assistantMessage).toContain("provider unavailable");
      },
      assertVaultPathsClean: async () => {
        calls.push("clean");
      },
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async (_message, paths) => {
        calls.push("commit");
        expect(paths).toEqual(["KEY7/conversations/chat-1.md"]);
        return {
          commitSha: "failed-log",
          parentSha: "before",
          changedPaths: paths,
        };
      },
      newActionId: () => "action-1",
    });

    await flow.submit(submission("/note observation"), {});

    expect(calls).toEqual(["clean", "conversation", "commit"]);
    expect(store.messages[1].action).toMatchObject({
      state: "failed",
      error: { message: "provider unavailable" },
    });
  });

  it("runs a rating command through the local knowledge transaction", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      prepareLocalKnowledgeAction: async (action) => {
        calls.push("prepare");
        expect(action.request.rating).toBe(4);
        expect(action.capabilities).toEqual(["vault.write"]);
        return {
          paths: ["KEY7/memory.md", "KEY7/record.json", "README.md"],
          commitMessage: "action: rating KEY7 4",
          expectedHeadSha: "head-before",
          apply: async () => {
            calls.push("apply");
            return {
              summary: "Rating set to 4.",
              targetPath: "KEY7/memory.md",
              section: "Overview",
              changed: true,
            };
          },
        };
      },
      appendConversationTurn: async () => {
        calls.push("conversation");
      },
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async (paths) =>
        paths.map((relativePath) => ({
          relativePath,
          existed: true,
          content: "before",
        })),
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async (_message, paths, expectedParentSha) => {
        calls.push("commit");
        expect(expectedParentSha).toBe("head-before");
        return {
          commitSha: "rating-commit",
          parentSha: "before",
          changedPaths: paths,
        };
      },
      getVaultHeadSha: async () => "head-before",
      newActionId: () => "rating-action",
    });

    await flow.submitAction(
      submission("Set rating to 4"),
      { kind: "paper.rating.set", rating: 4 },
      {},
    );

    expect(calls).toEqual(["prepare", "apply", "conversation", "commit"]);
    expect(store.messages[1].action).toMatchObject({
      kind: "paper.rating.set",
      state: "completed",
      request: { rating: 4 },
      target: { path: "KEY7/memory.md", section: "Overview" },
      result: { commitReceipt: { commitSha: "rating-commit" } },
    });
  });

  it("fails a no-op action when its Conversation Log cannot be saved", async () => {
    const store = new MemoryStore();
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      prepareLocalKnowledgeAction: async () => ({
        paths: [],
        commitMessage: "",
        apply: async () => ({
          summary: "Rating is already 4.",
          targetPath: "KEY7/memory.md",
          section: "Overview",
          changed: false,
        }),
      }),
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => {
        throw new Error("target has uncommitted changes");
      },
      captureVaultTextFiles: async () => [],
      restoreVaultTextFiles: async () => undefined,
      commitVaultPaths: async () => null,
      getVaultHeadSha: async () => "head-before",
      newActionId: () => "rating-action",
    });

    await flow.submitAction(
      submission("Set rating to 4"),
      { kind: "paper.rating.set", rating: 4 },
      {},
    );

    expect(store.messages[1].action).toMatchObject({
      state: "failed",
      error: {
        code: "execution-failed",
      },
    });
    expect(store.messages[1].action?.error?.message).toContain(
      "Conversation Log was not saved",
    );
  });

  it("does not apply a stale depth draft after Vault HEAD changes", async () => {
    const store = new MemoryStore();
    let applies = 0;
    let headReads = 0;
    const restoredFromHead: string[][] = [];
    const flow = createFlow({
      store,
      runResearch: async () => undefined,
      organizeNote: async () => {
        throw new Error("not expected");
      },
      prepareLocalKnowledgeAction: async () => ({
        paths: ["KEY7/memory.md", "KEY7/record.json"],
        commitMessage: "action: depth KEY7 L2",
        expectedHeadSha: "head-before",
        apply: async () => {
          applies += 1;
          return {
            summary: "Depth updated.",
            targetPath: "KEY7/memory.md",
            section: "Overview",
            changed: true,
          };
        },
      }),
      appendConversationTurn: async () => undefined,
      appendPaperNote: async () => false,
      assertVaultPathsClean: async () => undefined,
      captureVaultTextFiles: async (paths) =>
        paths.map((relativePath) => ({
          relativePath,
          existed: true,
          content: "before",
        })),
      restoreVaultTextFiles: async () => undefined,
      restoreVaultPathsFromHead: async (paths) => {
        restoredFromHead.push(paths);
      },
      commitVaultPaths: async () => null,
      getVaultHeadSha: async () =>
        ++headReads === 1 ? "head-before" : "head-newer",
      newActionId: () => "depth-action",
    });

    await flow.submitAction(
      submission("Change reading depth to L2"),
      { kind: "paper.depth.set", targetTier: "L2" },
      {},
    );

    expect(applies).toBe(0);
    expect(restoredFromHead).toEqual([
      ["KEY7/memory.md", "KEY7/record.json", "KEY7/conversations/chat-1.md"],
    ]);
    expect(store.messages[1].action).toMatchObject({
      state: "failed",
      error: { message: expect.stringContaining("Vault has newer updates") },
    });
  });
});
