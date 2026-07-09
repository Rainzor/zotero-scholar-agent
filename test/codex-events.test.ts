import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyCodexEvent,
  createCodexStreamState,
  isAgentMessageItem,
  isCommandItem,
  parseCodexEventLine,
} from "../src/services/codex/events";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const sampleJsonl = readFileSync(
  join(fixtureDir, "fixtures/codex-turn.jsonl"),
  "utf8",
);

describe("parseCodexEventLine", () => {
  it("returns null for blank lines", () => {
    expect(parseCodexEventLine("")).toBeNull();
    expect(parseCodexEventLine("   \n")).toBeNull();
  });

  it("parses a valid JSON object", () => {
    const event = parseCodexEventLine(
      '{"type":"thread.started","thread_id":"abc"}',
    );
    expect(event).toEqual({ type: "thread.started", thread_id: "abc" });
  });

  it("returns an error event for invalid JSON", () => {
    const event = parseCodexEventLine("not-json");
    expect(event?.type).toBe("error");
    expect(String((event as { message?: string }).message)).toContain(
      "Invalid Codex JSONL",
    );
  });

  it("returns null for non-object JSON", () => {
    expect(parseCodexEventLine("42")).toBeNull();
    expect(parseCodexEventLine('"hello"')).toBeNull();
  });
});

describe("applyCodexEvent — phase0-shaped JSONL fixture", () => {
  it("replays the recorded turn into the expected stream state", () => {
    let state = createCodexStreamState();
    const lines = sampleJsonl.split(/\r?\n/).filter(Boolean);
    const statuses: string[] = [];

    for (const line of lines) {
      const event = parseCodexEventLine(line);
      expect(event).not.toBeNull();
      state = applyCodexEvent(state, event!);
      if (state.latestStatus) statuses.push(state.latestStatus);
    }

    expect(state).toMatchSnapshot();
    expect(state.threadId).toBe("thread_phase0_aaaa1111");
    expect(state.content).toContain("self-attention");
    expect(state.content).toContain("scaled dot-product");
    expect(state.usage).toEqual({
      promptTokens: 51234,
      completionTokens: 256,
      totalTokens: 51490,
      reasoningTokens: 80,
      cachedInputTokens: 1200,
    });
    expect(statuses).toContain("Codex is thinking...");
    expect(statuses.some((s) => s.startsWith("Running:"))).toBe(true);
    expect(statuses).toContain("Command completed.");
    expect(statuses).toContain("Codex turn completed.");
  });

  it("surfaces turn.failed / error into content when empty", () => {
    let state = createCodexStreamState();
    state = applyCodexEvent(state, {
      type: "turn.failed",
      error: "sandbox denied write",
    });
    expect(state.content).toBe("[Error] sandbox denied write");
    expect(state.latestStatus).toBe("sandbox denied write");
  });

  it("appends agent messages with a blank line separator", () => {
    let state = createCodexStreamState();
    state = applyCodexEvent(state, {
      type: "item.completed",
      item: { type: "agent_message", text: "First" },
    });
    state = applyCodexEvent(state, {
      type: "item.completed",
      item: { type: "agent_message", text: "Second" },
    });
    expect(state.content).toBe("First\n\nSecond");
  });

  it("maps alternate Codex usage field names into context usage", () => {
    let state = createCodexStreamState();
    state = applyCodexEvent(state, {
      type: "turn.completed",
      usage: {
        inputTokens: 1000,
        cachedInputTokens: 750,
        outputTokens: 120,
        reasoningOutputTokens: 30,
        totalTokens: 1120,
      },
    });
    expect(state.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 120,
      totalTokens: 1120,
      reasoningTokens: 30,
      cachedInputTokens: 750,
    });
  });
});

describe("item type guards", () => {
  it("detects agent_message and command_execution", () => {
    expect(isAgentMessageItem({ type: "agent_message", text: "hi" })).toBe(
      true,
    );
    expect(isCommandItem({ type: "command_execution", command: "ls" })).toBe(
      true,
    );
    expect(isAgentMessageItem({ type: "command_execution" })).toBe(false);
    expect(isCommandItem(null)).toBe(false);
  });
});
