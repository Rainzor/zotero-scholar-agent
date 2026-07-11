import { describe, expect, it } from "vitest";
import { buildTurnDetailsViewModel } from "../src/modules/sidebar/turn-details";

describe("buildTurnDetailsViewModel", () => {
  it("summarizes activity, checks, and relationships in one process model", () => {
    const model = buildTurnDetailsViewModel({
      reasoning: "Compared methods and checked the record.",
      activities: [
        { command: "cat PAPER/text.txt", status: "completed" },
        { command: "git status", status: "completed" },
      ],
      quality: {
        status: "passed",
        checkedAt: "2026-07-10T00:00:00.000Z",
        hardFailures: [],
        warnings: [],
        coreSections: { missing: [], placeholder: [] },
        abstract: { status: "unchanged" },
        relationships: { candidates: 1, parsed: 1 },
        growth: { reviewRequired: false },
      },
      relationshipUpdates: [
        {
          sourceItemKey: "CURRENT",
          targetItemKey: "OTHER",
          type: "extends",
          rationale: "Builds on the benchmark.",
          updatedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
    });

    expect(model.summary).toBe("Run details · 2 steps · checks passed");
    expect(model.sections.map((section) => section.kind)).toEqual([
      "reasoning",
      "activity",
      "quality",
      "relationships",
    ]);
    expect(model.chipTargets).toEqual({
      quality: "quality",
      relationships: "relationships",
    });
  });

  it("reports a review state when automated checks need attention", () => {
    const model = buildTurnDetailsViewModel({
      quality: {
        status: "needs-review",
        checkedAt: "2026-07-10T00:00:00.000Z",
        hardFailures: [],
        warnings: ["Knowledge Surface grew by more than 25% in one turn."],
        coreSections: { missing: [], placeholder: [] },
        abstract: { status: "unchanged" },
        relationships: { candidates: 0, parsed: 0 },
        growth: { ratio: 1.3, reviewRequired: true },
      },
    });

    expect(model.summary).toBe("Run details · checks need review");
    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]).toMatchObject({
      kind: "quality",
      status: "needs-review",
    });
  });

  it("surfaces failed activity in the collapsed summary", () => {
    const model = buildTurnDetailsViewModel({
      activities: [
        { command: "git status", status: "completed" },
        { command: "cat missing-file", status: "failed" },
      ],
    });

    expect(model.summary).toBe("Run details · 2 steps · activity failed");
  });
});
