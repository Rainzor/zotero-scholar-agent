import { describe, expect, it } from "vitest";
import { parseChatIntent } from "../src/services/chat-actions/intent";

describe("parseChatIntent", () => {
  it("executes /note with the command body", () => {
    expect(
      parseChatIntent({
        text: "/note Compare this assumption with the ablation result.",
      }),
    ).toMatchObject({
      type: "action",
      execution: "direct",
      kind: "note.organize",
      content: "Compare this assumption with the ablation result.",
      trigger: "slash-command",
    });
  });

  it("uses selected text when /note has no body", () => {
    expect(
      parseChatIntent({
        text: "/note",
        selectedText: "The decoder is trained independently.",
      }),
    ).toMatchObject({
      type: "action",
      kind: "note.organize",
      content: "The decoder is trained independently.",
      contentSource: "selection",
    });
  });

  it("recognizes an explicit Chinese note instruction", () => {
    expect(
      parseChatIntent({
        text: "把这段整理成笔记",
        responseQuote: "This result depends on the synthetic benchmark.",
      }),
    ).toMatchObject({
      type: "action",
      execution: "direct",
      kind: "note.organize",
      content: "This result depends on the synthetic benchmark.",
      trigger: "explicit-instruction",
      contentSource: "response-quote",
    });
  });

  it("returns command help for an unknown slash command", () => {
    const parsed = parseChatIntent({ text: "/summarize paper" });
    expect(parsed.type).toBe("help");
    if (parsed.type === "help") {
      expect(parsed.message).toContain("/note");
      expect(parsed.message).not.toContain("Codex");
    }
  });

  it("falls back to a normal research turn without classification", () => {
    expect(
      parseChatIntent({ text: "What is the strongest evidence for claim 2?" }),
    ).toEqual({ type: "research" });
  });
});
