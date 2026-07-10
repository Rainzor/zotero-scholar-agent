import { describe, expect, it } from "vitest";
import {
  diffRelationships,
  relationshipIdentity,
} from "../src/services/research-turn/relationships";
import type { SemanticRelationship } from "../src/services/codex";

const base: SemanticRelationship = {
  sourceItemKey: "A",
  targetItemKey: "B",
  type: "extends",
  rationale: "same method family.",
  evidence: "[page 4]",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

describe("relationshipIdentity", () => {
  it("ignores updatedAt for stable diff identity", () => {
    expect(relationshipIdentity(base)).toBe(
      relationshipIdentity({
        ...base,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    );
  });
});

describe("diffRelationships", () => {
  it("returns only newly added relationships", () => {
    const next: SemanticRelationship = {
      ...base,
      targetItemKey: "C",
      rationale: "shares benchmark.",
    };
    expect(diffRelationships([base], [base, next])).toEqual([next]);
  });

  it("treats evidence changes as new reviewable relationships", () => {
    const changed = { ...base, evidence: "[page 5]" };
    expect(diffRelationships([base], [changed])).toEqual([changed]);
  });
});
