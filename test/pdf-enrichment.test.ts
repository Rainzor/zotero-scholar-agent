import { describe, expect, it } from "vitest";
import {
  buildPdftoppmArgs,
  parsePdfInfoPageCount,
  validateEnrichedPdfText,
} from "../src/services/pdf-enrichment";

describe("PDF enrichment validation", () => {
  it("accepts complete monotonic page markers", () => {
    expect(
      validateEnrichedPdfText(
        "[page 1]\nFirst\n\n[page 2]\nSecond\n\n[page 3]\nThird",
        3,
      ),
    ).toEqual({ ok: true, pageNumbers: [1, 2, 3] });
  });

  it("rejects missing, duplicate or out-of-order page markers", () => {
    expect(
      validateEnrichedPdfText("[page 1]\nA\n[page 3]\nC", 3),
    ).toMatchObject({ ok: false });
    expect(
      validateEnrichedPdfText("[page 1]\nA\n[page 1]\nAgain", 2),
    ).toMatchObject({ ok: false });
  });

  it("parses Poppler pdfinfo page count", () => {
    expect(parsePdfInfoPageCount("Title: Paper\nPages:          17\n")).toBe(
      17,
    );
    expect(parsePdfInfoPageCount("no pages")).toBeUndefined();
  });

  it("builds a single-page pdftoppm command", () => {
    expect(buildPdftoppmArgs("/paper.pdf", "/out/page-4", 4)).toEqual([
      "-f",
      "4",
      "-l",
      "4",
      "-png",
      "-singlefile",
      "/paper.pdf",
      "/out/page-4",
    ]);
  });
});
