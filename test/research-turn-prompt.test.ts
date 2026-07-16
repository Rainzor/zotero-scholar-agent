import { describe, expect, it } from "vitest";
import {
  buildCodexResearchPrompt,
  buildQuotedQuestion,
  getRecentMessagesForPrompt,
} from "../src/services/research-turn/prompt";

describe("buildQuotedQuestion", () => {
  it("adds selected PDF text and previous response blocks", () => {
    const question = buildQuotedQuestion({
      question: "Compare these.",
      selectedText: "line 1\nline 2",
      responseQuote: "prior answer",
    });
    expect(question).toContain("[PDF Text]\n> line 1\n> line 2");
    expect(question).toContain("[Previous Response]\n> prior answer");
    expect(question.endsWith("Compare these.")).toBe(true);
  });
});

describe("getRecentMessagesForPrompt", () => {
  it("returns messages after the digest coverage point", () => {
    const messages = [
      { role: "user" as const, content: "old" },
      { role: "assistant" as const, content: "old answer" },
      { role: "user" as const, content: "new" },
    ];
    expect(
      getRecentMessagesForPrompt(
        { contextDigestUpToMessageIndex: 1 },
        messages,
      ),
    ).toEqual([messages[2]]);
  });
});

describe("buildCodexResearchPrompt", () => {
  it("injects digest and recent messages for fresh threads", () => {
    const prompt = buildCodexResearchPrompt({
      itemKey: "ITEM1",
      title: "Paper",
      creators: "A. Researcher",
      year: "2024",
      question: "Continue.",
      mode: "fresh-thread",
      contextDigest: "# Context Digest",
      recentMessages: [{ role: "user", content: "recent question" }],
    });
    expect(prompt).toContain("Hidden Context Digest");
    expect(prompt).toContain("# Context Digest");
    expect(prompt).toContain("Recent visible chat turns");
    expect(prompt).toContain("recent question");
  });

  it("omits digest and recent messages for resumed threads", () => {
    const prompt = buildCodexResearchPrompt({
      itemKey: "ITEM1",
      title: "Paper",
      creators: "",
      year: "",
      question: "Continue.",
      mode: "resume",
      contextDigest: "# Context Digest",
      recentMessages: [{ role: "user", content: "recent question" }],
    });
    expect(prompt).toContain(
      "Thread context mode: resume existing Codex thread.",
    );
    expect(prompt).toContain("Hidden Context Digest: omitted");
    expect(prompt).not.toContain("# Context Digest");
    expect(prompt).not.toContain("recent question");
  });

  it("always includes mentioned paper context", () => {
    const prompt = buildCodexResearchPrompt({
      itemKey: "ITEM1",
      title: "Paper",
      creators: "",
      year: "",
      question: "Compare.",
      mode: "resume",
      mentionedPapers: [
        {
          itemKey: "OTHER",
          title: "Other Paper",
          memory: "## Contribution\n- Related.",
        },
      ],
    });
    expect(prompt).toContain("Explicitly mentioned Vault papers (@):");
    expect(prompt).toContain("Other Paper");
    expect(prompt).toContain("## Contribution\n- Related.");
  });
});
