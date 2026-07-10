import { describe, expect, it } from "vitest";
import {
  extractPageEvidence,
  parsePageEvidenceText,
} from "../src/services/page-evidence";

describe("parsePageEvidenceText", () => {
  it("returns a text segment when no page evidence exists", () => {
    expect(parsePageEvidenceText("No citation here.")).toEqual([
      { type: "text", text: "No citation here." },
    ]);
  });

  it("parses a single page reference", () => {
    expect(parsePageEvidenceText("See [page 4].")).toEqual([
      { type: "text", text: "See " },
      { type: "page", raw: "[page 4]", pageNumber: 4, pageIndex: 3 },
      { type: "text", text: "." },
    ]);
  });

  it("parses multiple and repeated page references", () => {
    expect(extractPageEvidence("[page 2], [page 2], [page 10]")).toEqual([
      { type: "page", raw: "[page 2]", pageNumber: 2, pageIndex: 1 },
      { type: "page", raw: "[page 2]", pageNumber: 2, pageIndex: 1 },
      { type: "page", raw: "[page 10]", pageNumber: 10, pageIndex: 9 },
    ]);
  });

  it("ignores invalid page zero and malformed markers", () => {
    expect(parsePageEvidenceText("Bad [page 0], [page -1], [page x].")).toEqual([
      { type: "text", text: "Bad [page 0], [page -1], [page x]." },
    ]);
  });

  it("preserves adjacent text around adjacent markers", () => {
    expect(parsePageEvidenceText("A[page 1][page 2]B")).toEqual([
      { type: "text", text: "A" },
      { type: "page", raw: "[page 1]", pageNumber: 1, pageIndex: 0 },
      { type: "page", raw: "[page 2]", pageNumber: 2, pageIndex: 1 },
      { type: "text", text: "B" },
    ]);
  });
});
