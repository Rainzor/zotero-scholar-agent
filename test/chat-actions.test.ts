import { describe, expect, it } from "vitest";
import {
  normalizeAgentAction,
  transitionAgentAction,
  type AgentActionCard,
} from "../src/services/chat-actions/types";

function proposedAction(): AgentActionCard {
  return {
    version: 1,
    id: "action-1",
    kind: "note.organize",
    state: "proposed",
    trigger: {
      source: "slash-command",
      text: "/note useful observation",
    },
    capabilities: ["codex.read", "vault.write"],
    request: {
      itemId: 7,
      itemKey: "KEY7",
      sessionId: "chat-1",
      paperTitle: "Paper",
      text: "/note useful observation",
      content: "useful observation",
      contentSource: "command",
      modelSlug: "",
    },
    target: {
      itemKey: "KEY7",
      path: "KEY7/notes.md",
      section: "Thinking",
    },
    createdAt: 10,
    updatedAt: 10,
  };
}

describe("AgentAction state", () => {
  it("allows the documented Note lifecycle", () => {
    const running = transitionAgentAction(proposedAction(), "running", {
      now: 20,
      statusText: "Organizing note...",
    });
    const completed = transitionAgentAction(running, "completed", {
      now: 30,
      result: {
        summary: "Saved to Reader Thinking.",
        targetPath: "KEY7/notes.md",
        section: "Thoughts and Critique",
      },
    });

    expect(completed.state).toBe("completed");
    expect(completed.result?.section).toBe("Thoughts and Critique");
    expect(completed.updatedAt).toBe(30);
  });

  it("rejects invalid state transitions", () => {
    expect(() =>
      transitionAgentAction(proposedAction(), "completed", { now: 20 }),
    ).toThrow(/proposed.*completed/i);
  });

  it("normalizes a persisted running action to an interrupted failure", () => {
    const normalized = normalizeAgentAction({
      ...proposedAction(),
      state: "running",
      statusText: "Calling Codex...",
    });

    expect(normalized).toMatchObject({
      state: "failed",
      error: {
        code: "interrupted",
        retryable: true,
      },
    });
  });
});
