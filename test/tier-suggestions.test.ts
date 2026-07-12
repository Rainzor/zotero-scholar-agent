import { describe, expect, it } from "vitest";
import { extractTierSuggestion } from "../src/services/tier-suggestions";

describe("tier suggestions", () => {
  it("extracts an L2 suggestion and strips the hidden marker", () => {
    expect(
      extractTierSuggestion(
        "This paper now merits close reading.\n<!-- tier-suggestion: L2 -->",
      ),
    ).toEqual({
      content: "This paper now merits close reading.",
      suggestion: "L2",
    });
  });

  it("ignores L3 because reproduction depth is user-initiated only", () => {
    expect(
      extractTierSuggestion("Done.\n<!-- tier-suggestion: L3 -->"),
    ).toEqual({
      content: "Done.",
      suggestion: undefined,
    });
  });
});
