import { config } from "../../package.json";
import { loadPageCache } from "../services/page-cache";
import {
  getPdfDocumentFromReader,
  parsePageStructured,
  toPlainText,
} from "../services/pdf-parser";

function getZToolkit(): any {
  return (Zotero as any)[config.addonInstance]?.data?.ztoolkit;
}

export async function getFullText(itemId: number): Promise<string> {
  try {
    const activeReader = await getTargetReader(null);
    const activeItemId = Number((activeReader as any)?.itemID || 0);
    const itemKey = resolveItemKey(activeReader);
    if (activeItemId && activeItemId === itemId && itemKey) {
      const cache = await loadPageCache(itemKey);
      if (cache?.pages?.length) {
        const joined = cache.pages
          .map((p) => String(p?.plainText || "").trim())
          .filter(Boolean)
          .join("\n");
        if (joined) return trimReferences(joined);
      }
    }
    const fullText = await Zotero.PDFWorker.getFullText(itemId, null);
    return trimReferences((fullText?.text as string) || "");
  } catch {
    return "";
  }
}

export async function getCurrentPageText(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<string> {
  try {
    const targetReader = await getTargetReader(reader);
    if (!targetReader) return "";
    const currentPage = await getCurrentPageNumber(targetReader);
    if (!currentPage) return "";
    return getPageText(targetReader, currentPage);
  } catch (e) {
    ztoolkit.log("[Agent] getCurrentPageText error:", e);
    return "";
  }
}

export async function getPageText(
  reader?: _ZoteroTypes.ReaderInstance | null,
  pageNumber?: number,
): Promise<string> {
  const cached = await getCachedPageText(reader, pageNumber);
  if (cached) return cached;
  return getPageTextFromReader(reader, pageNumber);
}

async function getPageTextFromReader(
  reader?: _ZoteroTypes.ReaderInstance | null,
  pageNumber?: number,
): Promise<string> {
  try {
    const targetReader = await getTargetReader(reader);
    if (!targetReader) return "";
    const iframeWin = targetReader._iframeWindow as any;
    const wrapped = iframeWin?.wrappedJSObject;
    const pdfApp = wrapped?.PDFViewerApplication;
    if (!pdfApp?.pdfViewer || !pdfApp?.pdfDocument) return "";

    const targetPage = normalizePageNumber(
      pageNumber,
      pdfApp.pdfViewer.currentPageNumber,
    );
    if (!targetPage) return "";

    const textFromDOM = readTextLayerDOM(iframeWin, targetPage);
    if (textFromDOM) return textFromDOM;

    try {
      const pdfDocument = getPdfDocumentFromReader(targetReader);
      if (!pdfDocument) return "";
      const page = await parsePageStructured(pdfDocument, targetPage);
      return toPlainText(page);
    } catch {
      return "";
    }
  } catch {
    return "";
  }
}

export async function getMultiPageText(
  reader: _ZoteroTypes.ReaderInstance | null | undefined,
  pageNumbers: number[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const uniquePages = Array.from(
    new Set(
      (pageNumbers || [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0),
    ),
  );
  const cache = await loadReaderPageCache(reader);
  if (cache?.pages?.length) {
    const index = new Map<number, string>();
    for (const page of cache.pages) {
      const n = Math.max(1, Math.floor(Number(page.pageNumber) || 0));
      const text = String(page.plainText || "").trim();
      if (n > 0 && text) index.set(n, text);
    }
    for (const page of uniquePages) {
      const text = index.get(page);
      if (text) result.set(page, text);
    }
  }
  for (const page of uniquePages) {
    if (result.has(page)) continue;
    const text = await getPageText(reader, page);
    if (text) result.set(page, text);
  }
  return result;
}

function readTextLayerDOM(iframeWin: any, pageNum: number): string {
  try {
    const iframeDoc = iframeWin.document;
    if (!iframeDoc) return "";

    const pageEl =
      iframeDoc.querySelector(`[data-page-number="${pageNum}"]`) ||
      iframeDoc.querySelector(`.page[data-page-number="${pageNum}"]`);
    if (!pageEl) return "";

    const textLayer =
      pageEl.querySelector(".textLayer") ||
      pageEl.querySelector('[class*="textLayer"]');
    if (!textLayer) return "";

    const spans = textLayer.querySelectorAll("span");
    if (!spans || spans.length === 0) {
      const raw = textLayer.textContent?.trim();
      return raw || "";
    }

    const lines: string[] = [];
    let lastRect: DOMRect | null = null;
    let currentLine = "";

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i] as HTMLElement;
      const text = span.textContent || "";
      if (!text) continue;

      try {
        const rect = span.getBoundingClientRect();
        if (lastRect && Math.abs(rect.top - lastRect.top) > 4) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = "";
        }
        currentLine += text;
        lastRect = rect;
      } catch {
        currentLine += text;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function getCurrentPageNumber(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<number> {
  try {
    const targetReader = await getTargetReader(reader);
    if (!targetReader?._iframeWindow) return 0;
    const wrapped = (targetReader._iframeWindow as any).wrappedJSObject;
    return wrapped?.PDFViewerApplication?.pdfViewer?.currentPageNumber || 0;
  } catch {
    return 0;
  }
}

export async function getTotalPages(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<number> {
  try {
    const targetReader = await getTargetReader(reader);
    if (!targetReader?._iframeWindow) return 0;
    const wrapped = (targetReader._iframeWindow as any).wrappedJSObject;
    return wrapped?.PDFViewerApplication?.pdfViewer?.pagesCount || 0;
  } catch {
    return 0;
  }
}

export type ContextResult = {
  text: string;
  source: "none" | "currentPage";
  pageNumber?: number;
};

export async function getContextByMode(options: {
  mode: "none" | "currentPage";
  reader?: _ZoteroTypes.ReaderInstance | null;
  itemId?: number;
}): Promise<ContextResult> {
  const { mode, reader } = options;

  if (mode === "none") {
    return { text: "", source: "none" };
  }

  const pageNumber = await getCurrentPageNumber(reader);
  let text = await getCurrentPageText(reader);
  if (text) return { text, source: "currentPage", pageNumber };

  const itemId = options.itemId || reader?.itemID;
  if (itemId) {
    text = await getFullText(itemId);
    if (text) return { text, source: "currentPage", pageNumber };
  }
  return { text: "", source: "currentPage", pageNumber };
}

function trimReferences(content: string) {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) =>
    /^(references|bibliography|参考文献|acknowledgements?)$/i.test(line.trim()),
  );
  return (index >= 0 ? lines.slice(0, index) : lines).join("\n").trim();
}

async function getTargetReader(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<_ZoteroTypes.ReaderInstance | null> {
  if (reader) return reader;
  const tk = getZToolkit();
  return ((await tk?.Reader?.getReader()) as any) || null;
}

function normalizePageNumber(
  pageNumber: number | undefined,
  fallback: number,
): number {
  const n = Number(pageNumber);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const f = Number(fallback);
  if (Number.isFinite(f) && f > 0) return Math.floor(f);
  return 0;
}

async function getCachedPageText(
  reader?: _ZoteroTypes.ReaderInstance | null,
  pageNumber?: number,
): Promise<string> {
  const targetPage = Math.max(1, Math.floor(Number(pageNumber) || 0));
  if (!targetPage) return "";
  const cache = await loadReaderPageCache(reader);
  if (!cache?.pages?.length) return "";
  const page = cache.pages.find((p) => Number(p.pageNumber) === targetPage);
  return String(page?.plainText || "").trim();
}

async function loadReaderPageCache(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<Awaited<ReturnType<typeof loadPageCache>> | null> {
  const targetReader = await getTargetReader(reader);
  const itemKey = resolveItemKey(targetReader);
  if (!itemKey) return null;
  return loadPageCache(itemKey);
}

function resolveItemKey(reader?: _ZoteroTypes.ReaderInstance | null): string {
  const candidate =
    (reader as any)?.itemKey ||
    (reader as any)?._item?.key ||
    (reader as any)?._itemKey ||
    "";
  return String(candidate || "").trim();
}
