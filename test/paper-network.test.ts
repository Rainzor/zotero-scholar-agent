import { describe, expect, it } from "vitest";
import { collectPaperBacklinks } from "../src/services/paper-network";

describe("paper backlinks", () => {
  it("collects relationships that target the current paper", () => {
    const backlinks = collectPaperBacklinks(
      [
        {
          paper: { itemId: 1, itemKey: "AAAA1111", title: "Paper A" },
          relationships: [
            {
              sourceItemKey: "AAAA1111",
              targetItemKey: "BBBB2222",
              type: "extends",
              rationale: "Builds on B.",
              updatedAt: "2026-07-12T00:00:00.000Z",
            },
          ],
        },
        {
          paper: { itemId: 2, itemKey: "CCCC3333", title: "Paper C" },
          relationships: [],
        },
      ],
      "BBBB2222",
    );

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].source.title).toBe("Paper A");
    expect(backlinks[0].relationship.type).toBe("extends");
  });
});
