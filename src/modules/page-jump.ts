export type PageJumpState =
  | { ok: true; pageCount?: number }
  | { ok: false; reason: "no-reader" | "out-of-range" | "navigation-failed"; pageCount?: number };

export function getReaderPageCount(
  reader?: _ZoteroTypes.ReaderInstance | null,
): number | undefined {
  const direct = positiveInteger((reader as any)?._state?.pagesCount) ||
    positiveInteger((reader as any)?.state?.pagesCount) ||
    positiveInteger((reader as any)?._internalReader?._state?.pagesCount) ||
    positiveInteger((reader as any)?._internalReader?.state?.pagesCount);
  if (direct) return direct;
  const app = getPdfViewerApplication(reader);
  return positiveInteger(app?.pagesCount) ||
    positiveInteger(app?.pdfViewer?.pagesCount) ||
    positiveInteger(app?.pdfDocument?.numPages);
}

export function canJumpToPage(
  reader: _ZoteroTypes.ReaderInstance | null | undefined,
  pageIndex: number,
): PageJumpState {
  if (!reader) return { ok: false, reason: "no-reader" };
  const pageCount = getReaderPageCount(reader);
  if (pageCount && (pageIndex < 0 || pageIndex >= pageCount)) {
    return { ok: false, reason: "out-of-range", pageCount };
  }
  return { ok: true, pageCount };
}

export async function jumpToReaderPage(
  reader: _ZoteroTypes.ReaderInstance | null | undefined,
  pageIndex: number,
): Promise<PageJumpState> {
  const state = canJumpToPage(reader, pageIndex);
  if (!state.ok) return state;
  try {
    (reader as any)?.focus?.();
    if (typeof (reader as any)?.navigate === "function") {
      await (reader as any).navigate({ pageIndex });
      return state;
    }
    const internal = (reader as any)?._internalReader;
    if (typeof internal?.navigate === "function") {
      await internal.navigate({ pageIndex });
      return state;
    }
    const app = getPdfViewerApplication(reader);
    if (app) {
      app.page = pageIndex + 1;
      return state;
    }
  } catch {
    // Fall through to failure state.
  }
  return {
    ok: false,
    reason: "navigation-failed",
    pageCount: state.pageCount,
  };
}

function getPdfViewerApplication(
  reader?: _ZoteroTypes.ReaderInstance | null,
): any | null {
  try {
    const iframeWin = (reader as any)?._iframeWindow;
    const wrapped = iframeWin?.wrappedJSObject;
    return (
      wrapped?.PDFViewerApplication ||
      iframeWin?.PDFViewerApplication ||
      null
    );
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
