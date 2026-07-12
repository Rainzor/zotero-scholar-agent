import { describe, expect, it } from "vitest";
import {
  filterEmptyMarkdownSections,
  prepareCodeNotesMarkdown,
  prepareMemoryMarkdown,
  prepareNotesMarkdown,
} from "../src/modules/sidebar/memory-markdown";

describe("filterEmptyMarkdownSections", () => {
  it("removes empty h2 and h3 sections without depending on their names", () => {
    const markdown = [
      "## Library Connections",
      "",
      "### Semantic Relationships",
      "",
      "## Takeaways",
      "",
      "- The method is reusable.",
      "",
      "### Follow-up",
      "",
      "Keep this question.",
    ].join("\n");

    expect(filterEmptyMarkdownSections(markdown)).toBe(
      [
        "## Takeaways",
        "",
        "- The method is reusable.",
        "",
        "### Follow-up",
        "",
        "Keep this question.",
      ].join("\n"),
    );
  });

  it("preserves headings and heading-like text that have content", () => {
    const markdown = [
      "## Reader Thinking",
      "",
      "### Questions",
      "",
      "What would falsify this claim?",
      "",
      "```markdown",
      "## This is code, not a section",
      "```",
    ].join("\n");

    expect(filterEmptyMarkdownSections(markdown)).toBe(markdown);
  });

  it("does not parse headings inside a longer fenced code block", () => {
    const markdown = [
      "## Example",
      "",
      "````markdown",
      "``` not a closing fence",
      "## Internal heading",
      "",
      "### Empty-looking child",
      "````",
    ].join("\n");

    expect(filterEmptyMarkdownSections(markdown)).toBe(markdown);
  });
});

describe("prepareMemoryMarkdown", () => {
  it("hides action audit markers from the Memory reading surface", () => {
    const markdown = [
      "# Reader Thinking",
      "",
      "## Actions",
      "",
      "### 2026-07-12 [agent, user-confirmed]",
      "<!-- action-id: action-1783843594257-xcpxsw -->",
      "",
      "- Stage I: inherit the video prior.",
    ].join("\n");

    expect(prepareNotesMarkdown(markdown)).toBe(
      [
        "## Actions",
        "",
        "### 2026-07-12 [agent, user-confirmed]",
        "",
        "- Stage I: inherit the video prior.",
      ].join("\n"),
    );
  });

  it("preserves action-like text inside fenced code blocks", () => {
    const markdown = [
      "## Example",
      "",
      "```markdown",
      "<!-- action-id: example -->",
      "```",
    ].join("\n");

    expect(prepareNotesMarkdown(markdown)).toBe(markdown);
  });

  it("hides Knowledge Surface ownership metadata from the reading view", () => {
    const markdown = [
      "# Advancing Open-source World Models",
      "",
      "> itemKey: 2HMS9JJX",
      "",
      "<!-- zotero-agent:paper:start -->",
      "## Bibliography",
      "",
      "**Title:** Advancing Open-source World Models",
      "**Authors:** Robbyant Team",
      "**Year:** 2026",
      "**Item Key:** 2HMS9JJX",
      "",
      "## Abstract",
      "",
      "Source abstract.",
      "<!-- zotero-agent:paper:end -->",
      "",
      "## Contribution",
      "",
      "Contribution text.",
    ].join("\n");

    expect(prepareMemoryMarkdown(markdown)).toBe(
      [
        "## Bibliography",
        "",
        "**Title:** Advancing Open-source World Models",
        "**Authors:** Robbyant Team",
        "**Year:** 2026",
        "",
        "## Abstract",
        "",
        "Source abstract.",
        "",
        "## Contribution",
        "",
        "Contribution text.",
      ].join("\n"),
    );
  });

  it("does not strip internal-looking text inside fenced code blocks", () => {
    const markdown = [
      "## Example",
      "",
      "```markdown",
      "# Stored title",
      "> itemKey: EXAMPLE",
      "<!-- zotero-agent:paper:start -->",
      "**Item Key:** EXAMPLE",
      "```",
    ].join("\n");

    expect(prepareMemoryMarkdown(markdown)).toBe(markdown);
  });

  it("preserves user-authored H1 and Item Key text after the notes header", () => {
    const markdown = [
      "# Reader Thinking: Paper",
      "",
      "> itemKey: KEY",
      "",
      "## Thoughts and Critique",
      "",
      "# User emphasis",
      "",
      "Item Key: this phrase is part of my note.",
    ].join("\n");

    expect(prepareNotesMarkdown(markdown)).toBe(
      [
        "## Thoughts and Critique",
        "",
        "# User emphasis",
        "",
        "Item Key: this phrase is part of my note.",
      ].join("\n"),
    );
  });

  it("hides only known code provenance markers", () => {
    const markdown = [
      "# Code Analysis",
      "",
      "> itemKey: KEY",
      "",
      "<!-- zotero-agent:code:start -->",
      "**Repository:** owner/repo",
      "<!-- zotero-agent:code:end -->",
      "",
      "Item Key: user-visible analysis.",
    ].join("\n");

    expect(prepareCodeNotesMarkdown(markdown)).toBe(
      [
        "**Repository:** owner/repo",
        "",
        "Item Key: user-visible analysis.",
      ].join("\n"),
    );
  });

  it("keeps metadata-like text inside a longer fenced block", () => {
    const markdown = [
      "## Example",
      "",
      "````markdown",
      "``` not a closing fence",
      "# Stored title",
      "> itemKey: EXAMPLE",
      "````",
    ].join("\n");

    expect(prepareMemoryMarkdown(markdown)).toBe(markdown);
  });
});
