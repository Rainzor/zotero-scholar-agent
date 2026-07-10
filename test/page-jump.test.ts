import { describe, expect, it, vi } from "vitest";
import {
  canJumpToPage,
  getReaderPageCount,
  jumpToReaderPage,
} from "../src/modules/page-jump";

describe("getReaderPageCount", () => {
  it("reads page count from reader state", () => {
    expect(getReaderPageCount({ state: { pagesCount: 12 } } as any)).toBe(12);
  });

  it("reads page count from PDFViewerApplication fallback", () => {
    const reader = {
      _iframeWindow: {
        PDFViewerApplication: { pagesCount: 8 },
      },
    };
    expect(getReaderPageCount(reader as any)).toBe(8);
  });
});

describe("canJumpToPage", () => {
  it("rejects missing reader", () => {
    expect(canJumpToPage(null, 0)).toEqual({ ok: false, reason: "no-reader" });
  });

  it("rejects pages outside known page count", () => {
    expect(canJumpToPage({ state: { pagesCount: 2 } } as any, 2)).toEqual({
      ok: false,
      reason: "out-of-range",
      pageCount: 2,
    });
  });
});

describe("jumpToReaderPage", () => {
  it("uses reader.navigate with zero-based pageIndex", async () => {
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn();
    const result = await jumpToReaderPage(
      { state: { pagesCount: 4 }, navigate, focus } as any,
      1,
    );
    expect(result).toEqual({ ok: true, pageCount: 4 });
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ pageIndex: 1 });
  });

  it("falls back to PDFViewerApplication.page", async () => {
    const app = { pagesCount: 4, page: 1 };
    const result = await jumpToReaderPage(
      { _iframeWindow: { PDFViewerApplication: app } } as any,
      2,
    );
    expect(result).toEqual({ ok: true, pageCount: 4 });
    expect(app.page).toBe(3);
  });
});
