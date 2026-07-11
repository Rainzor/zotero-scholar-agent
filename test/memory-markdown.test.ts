import { describe, expect, it } from "vitest";
import { filterEmptyMarkdownSections } from "../src/modules/sidebar/memory-markdown";

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
});
