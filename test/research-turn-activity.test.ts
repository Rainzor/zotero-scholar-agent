import { describe, expect, it } from "vitest";
import type { CodexActivity } from "../src/addon";
import { collectCodexActivity } from "../src/services/research-turn/activity";

describe("collectCodexActivity", () => {
  it("tracks command start and completion by item id", () => {
    const activities: CodexActivity[] = [];
    const byId = new Map<string, CodexActivity>();

    expect(
      collectCodexActivity(activities, byId, {
        type: "item.started",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "rg attention",
          status: "in_progress",
        },
      }),
    ).toBe(true);
    expect(activities).toEqual([
      { command: "rg attention", status: "in_progress" },
    ]);

    expect(
      collectCodexActivity(activities, byId, {
        type: "item.completed",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "rg attention",
          exit_code: 0,
          status: "completed",
        },
      }),
    ).toBe(true);
    expect(activities).toEqual([
      { command: "rg attention", status: "completed", exitCode: 0 },
    ]);
  });

  it("ignores non-command events", () => {
    expect(
      collectCodexActivity([], new Map(), {
        type: "item.completed",
        item: { id: "msg-1", type: "agent_message", text: "hello" },
      }),
    ).toBe(false);
  });
});
