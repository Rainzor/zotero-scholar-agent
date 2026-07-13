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

  it("parses rating and depth commands", () => {
    expect(parseChatIntent({ text: "/rate 4" })).toMatchObject({
      type: "action",
      kind: "paper.rating.set",
      rating: 4,
    });
    expect(parseChatIntent({ text: "/depth L2" })).toMatchObject({
      type: "action",
      kind: "paper.depth.set",
      targetTier: "L2",
    });
  });

  it("recognizes explicit Chinese rating and depth instructions", () => {
    expect(parseChatIntent({ text: "给这篇论文打 5 星" })).toMatchObject({
      type: "action",
      kind: "paper.rating.set",
      rating: 5,
      trigger: "explicit-instruction",
    });
    expect(parseChatIntent({ text: "把阅读深度设为 L1" })).toMatchObject({
      type: "action",
      kind: "paper.depth.set",
      targetTier: "L1",
      trigger: "explicit-instruction",
    });
  });

  it("returns local help for invalid rating and depth arguments", () => {
    for (const text of ["/rate 6", "/rate", "/depth L3", "/depth deep"]) {
      const parsed = parseChatIntent({ text });
      expect(parsed.type).toBe("help");
      if (parsed.type === "help") {
        expect(parsed.message).toContain("/rate 1..5");
        expect(parsed.message).toContain("/depth L0|L1|L2");
      }
    }
  });

  it("does not execute rating or depth from questions", () => {
    expect(parseChatIntent({ text: "Should I set rating to 5?" })).toEqual({
      type: "research",
    });
    expect(parseChatIntent({ text: "Why change depth to L2?" })).toEqual({
      type: "research",
    });
  });

  it("falls back to a normal research turn without classification", () => {
    expect(
      parseChatIntent({ text: "What is the strongest evidence for claim 2?" }),
    ).toEqual({ type: "research" });
  });
});
