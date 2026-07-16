import { describe, it, expect } from "vitest";
import { filterPapers, paperMatchesFilter } from "../src/modules/sidebar/memory-filter";
import type { PaperVaultMeta } from "../src/services/codex/vault-format";

function paper(over: Partial<PaperVaultMeta>): PaperVaultMeta {
  return { itemId: 1, itemKey: "K", title: "", ...over };
}

const papers: PaperVaultMeta[] = [
  paper({ itemKey: "A", title: "Attention Is All You Need", creators: "Vaswani" }),
  paper({ itemKey: "B", title: "3D Gaussian Splatting", creators: "Kerbl" }),
  paper({ itemKey: "C", title: "MAGI-1", creators: "Sand AI, Hansi Teng" }),
];

describe("paperMatchesFilter", () => {
  it("matches on title (case-insensitive)", () => {
    expect(paperMatchesFilter(papers[0], "attention")).toBe(true);
    expect(paperMatchesFilter(papers[0], "GAUSSIAN")).toBe(false);
  });

  it("matches on author", () => {
    expect(paperMatchesFilter(papers[1], "kerbl")).toBe(true);
    expect(paperMatchesFilter(papers[2], "teng")).toBe(true);
  });

  it("tolerates missing title/creators", () => {
    expect(paperMatchesFilter(paper({ title: "", creators: undefined }), "x")).toBe(
      false,
    );
  });
});

describe("filterPapers", () => {
  it("returns all papers for an empty or whitespace query", () => {
    expect(filterPapers(papers, "")).toHaveLength(3);
    expect(filterPapers(papers, "   ")).toHaveLength(3);
  });

  it("narrows to matches on title or author", () => {
    expect(filterPapers(papers, "gaussian").map((p) => p.itemKey)).toEqual(["B"]);
    expect(filterPapers(papers, "sand").map((p) => p.itemKey)).toEqual(["C"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterPapers(papers, "zzzzz")).toEqual([]);
  });
});
