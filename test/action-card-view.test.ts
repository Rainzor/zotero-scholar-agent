import { describe, expect, it } from "vitest";
import { getActionCardViewModel } from "../src/modules/sidebar/action-card";
import type { AgentActionCard } from "../src/services/chat-actions/types";

function action(state: AgentActionCard["state"]): AgentActionCard {
  return {
    version: 1,
    id: "action-1",
    kind: "note.organize",
    state,
    trigger: { source: "slash-command", text: "/note observation" },
    capabilities: ["codex.read", "vault.write"],
    request: {
      itemId: 7,
      itemKey: "KEY7",
      sessionId: "chat-1",
      paperTitle: "Paper",
      text: "/note observation",
      content: "observation",
      contentSource: "command",
      modelSlug: "",
    },
    target: { itemKey: "KEY7", path: "KEY7/notes.md", section: "Thinking" },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("getActionCardViewModel", () => {
  it("offers cancel while a Note action is running", () => {
    expect(getActionCardViewModel(action("running"))).toMatchObject({
      title: "Organize note",
      tone: "progress",
      actions: [{ id: "cancel", label: "Cancel" }],
    });
  });

  it("offers retry after an interrupted action", () => {
    const failed = {
      ...action("failed"),
      error: {
        code: "interrupted",
        message: "Interrupted when Zotero closed.",
        retryable: true,
      },
    } satisfies AgentActionCard;
    expect(getActionCardViewModel(failed)).toMatchObject({
      tone: "error",
      actions: [{ id: "retry", label: "Retry" }],
    });
  });

  it("offers Undo for a completed persistent action", () => {
    const completed = {
      ...action("completed"),
      result: {
        summary: "Rating updated.",
        committed: true,
        commitReceipt: {
          commitSha: "abc",
          parentSha: "def",
          changedPaths: ["KEY7/memory.md"],
        },
      },
    } satisfies AgentActionCard;

    expect(getActionCardViewModel(completed).actions).toEqual([
      { id: "view", label: "View" },
      { id: "undo", label: "Undo" },
    ]);
  });

  it("uses action-specific titles for rating and depth", () => {
    expect(
      getActionCardViewModel({
        ...action("running"),
        kind: "paper.rating.set",
      }).title,
    ).toBe("Set rating");
    expect(
      getActionCardViewModel({
        ...action("running"),
        kind: "paper.depth.set",
      }).title,
    ).toBe("Change depth");
  });

  it("does not offer Undo for excluded action kinds", () => {
    const completed = {
      ...action("completed"),
      kind: "paper.record.build",
      result: {
        summary: "Built.",
        commitReceipt: {
          commitSha: "abcdef1",
          parentSha: "abcdef0",
          changedPaths: ["KEY7/memory.md"],
        },
      },
    } satisfies AgentActionCard;

    expect(getActionCardViewModel(completed).actions).toEqual([
      { id: "view", label: "View" },
    ]);
  });
});
