import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/utils/markdown";

describe("renderMarkdown", () => {
  it("shortens Vault memory paths while retaining the full path in a tooltip", () => {
    const html = renderMarkdown("Saved to 2HMS9JJX/memory.md.");

    expect(html).toContain('href="2HMS9JJX/memory.md"');
    expect(html).toContain('title="2HMS9JJX/memory.md"');
    expect(html).toContain(">memory.md</a>");
    expect(html).not.toContain(">2HMS9JJX/memory.md</a>");
  });

  it("does not add a Vault tooltip to ordinary memory links", () => {
    const html = renderMarkdown("See memory.md for details.");
    expect(html).toContain('href="http://memory.md"');
    expect(html).not.toContain('title="memory.md"');
  });
});
