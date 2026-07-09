import { describe, expect, it } from "vitest";
import {
  buildCodexResearchPrompt,
  buildContextDigestPrompt,
  generateContextDigest,
} from "../src/services/context-digest";

describe("buildContextDigestPrompt", () => {
  it("preserves the required compact instruction sections", () => {
    const prompt = buildContextDigestPrompt({
      itemKey: "PXW99EKT",
      title: "Attention Is All You Need",
      startIndex: 0,
      endIndex: 2,
      timestamp: "2026-07-09T00:00:00.000Z",
      messages: [
        { role: "user", content: "What is the main contribution?" },
        { role: "assistant", content: "It introduces the Transformer." },
      ],
    });

    expect(prompt).toContain("# Context Digest");
    expect(prompt).toContain("## Coverage");
    expect(prompt).toContain("## User Intent And Preferences");
    expect(prompt).toContain("## Current Research State");
    expect(prompt).toContain("Paper-grounded knowledge:");
    expect(prompt).toContain("Reader thinking:");
    expect(prompt).toContain("Open questions:");
    expect(prompt).toContain("Covers turns: 0..2");
    expect(prompt).toContain("In-focus paper: PXW99EKT");
    expect(prompt).toContain("[0] User:");
  });

  it("keeps cumulative coverage separate from newly compacted message indices", () => {
    const prompt = buildContextDigestPrompt({
      itemKey: "PXW99EKT",
      title: "Attention Is All You Need",
      coverageStartIndex: 0,
      startIndex: 2,
      endIndex: 4,
      timestamp: "2026-07-09T00:00:00.000Z",
      previousDigest: "# Context Digest\n\n## Coverage\n- Covers turns: 0..1",
      messages: [{ role: "user", content: "Continue from here." }],
    });

    expect(prompt).toContain("Covers turns: 0..4");
    expect(prompt).toContain("[2] User:");
  });
});

describe("buildCodexResearchPrompt", () => {
  it("injects hidden digest plus recent turns without making the digest a visible assistant message", () => {
    const prompt = buildCodexResearchPrompt({
      itemKey: "ITEM1",
      title: "Paper",
      creators: "A. Researcher",
      year: "2024",
      question: "Continue the comparison.",
      contextDigest: "# Context Digest\n\n## Coverage\n- Covers turns: 0..5",
      recentMessages: [
        { role: "user", content: "Compare it with @Other." },
        { role: "assistant", content: "Initial comparison." },
      ],
      mentionedPapers: [
        {
          itemKey: "OTHER",
          title: "Other Paper",
          memory: "## Contribution\n- Related method.",
        },
      ],
    });

    expect(prompt).toContain("Hidden Context Digest");
    expect(prompt).toContain("# Context Digest");
    expect(prompt).toContain("Recent visible chat turns");
    expect(prompt).toContain("[0] User:");
    expect(prompt).toContain("[1] Assistant:");
    expect(prompt).toContain("User question:\nContinue the comparison.");
    expect(prompt).not.toContain("Assistant:\n# Context Digest");
  });
});

describe("generateContextDigest", () => {
  it("falls back from cheap model to default model", async () => {
    const calls: Array<string | undefined> = [];
    const digest = await generateContextDigest({
      itemKey: "ITEM1",
      title: "Paper",
      cheapModelSlug: "cheap-model",
      now: () => new Date("2026-07-09T00:00:00.000Z"),
      messages: [{ role: "user", content: "Keep this question." }],
      runTurn: async (input) => {
        calls.push(input.model);
        if (input.model) throw new Error("cheap unavailable");
        return {
          content:
            "# Context Digest\n\n## Coverage\n- Covers turns: 0..0\n- In-focus paper: ITEM1 — Paper",
          reasoning: "",
          threadId: "thread",
        };
      },
    });

    expect(calls).toEqual(["cheap-model", undefined]);
    expect(digest.contextDigestSource).toBe("codex-default");
    expect(digest.contextDigest).toContain("# Context Digest");
  });

  it("uses deterministic fallback when Codex compaction fails twice", async () => {
    const digest = await generateContextDigest({
      itemKey: "ITEM1",
      title: "Paper",
      cheapModelSlug: "cheap-model",
      now: () => new Date("2026-07-09T00:00:00.000Z"),
      messages: [{ role: "user", content: "Unresolved question?" }],
      runTurn: async () => {
        throw new Error("model failed");
      },
    });

    expect(digest.contextDigestSource).toBe("deterministic");
    expect(digest.contextDigest).toContain("# Context Digest");
    expect(digest.contextDigest).toContain("Unresolved question?");
    expect(digest.contextDigestUpToMessageIndex).toBe(0);
  });
});
