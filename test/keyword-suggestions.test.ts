import { describe, expect, it } from "vitest";
import {
  extractPaperKeywords,
  extractKeywordSuggestions,
} from "../src/services/keyword-suggestions";

describe("paper keyword extraction", () => {
  it("extracts a paper-authored Keywords line from the first page", () => {
    expect(
      extractPaperKeywords(
        "[page 1]\nAbstract text\nKeywords: video diffusion; causal generation, distillation\n\n[page 2]\nBody",
      ),
    ).toEqual(["video diffusion", "causal generation", "distillation"]);
  });
});

describe("Codex keyword suggestion marker", () => {
  it("removes the hidden marker and returns normalized suggestions", () => {
    expect(
      extractKeywordSuggestions(
        "Answer.\n\n<!-- keyword-suggestions: Video, diffusion, video -->",
      ),
    ).toEqual({
      content: "Answer.",
      suggestions: ["Video", "diffusion"],
    });
  });
});
