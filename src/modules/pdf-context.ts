import { config } from "../../package.json";

function getZToolkit(): any {
  return (Zotero as any)[config.addonInstance]?.data?.ztoolkit;
}

export async function getFullText(itemId: number): Promise<string> {
  try {
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
    const tk = getZToolkit();
    const targetReader = reader || ((await tk?.Reader?.getReader()) as any);
    if (!targetReader?._iframeWindow) return "";

    const iframeWin = targetReader._iframeWindow as any;
    const wrapped = iframeWin.wrappedJSObject;
    const pdfApp = wrapped?.PDFViewerApplication;
    if (!pdfApp?.pdfViewer) return "";

    const currentPage = pdfApp.pdfViewer.currentPageNumber;
    if (!currentPage) return "";

    // Strategy 1: Read from rendered text layer DOM (sync, avoids cross-sandbox)
    const textFromDOM = readTextLayerDOM(iframeWin, currentPage);
    if (textFromDOM) return textFromDOM;

    // Strategy 2: Execute extraction inside the iframe context
    try {
      const resultPromise = iframeWin.wrappedJSObject.eval(
        `(async function(){` +
        `  try {` +
        `    var p = await PDFViewerApplication.pdfDocument.getPage(${currentPage});` +
        `    var tc = await p.getTextContent();` +
        `    var lines = []; var lastY = null; var cur = "";` +
        `    for (var i = 0; i < tc.items.length; i++) {` +
        `      var it = tc.items[i];` +
        `      var y = it.transform ? it.transform[5] : null;` +
        `      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {` +
        `        if (cur.trim()) lines.push(cur.trim()); cur = "";` +
        `      }` +
        `      cur += it.str || "";` +
        `      if (y !== null) lastY = y;` +
        `    }` +
        `    if (cur.trim()) lines.push(cur.trim());` +
        `    return lines.join("\\n");` +
        `  } catch(e) { return ""; }` +
        `})()`
      );
      const text = await resultPromise;
      if (text) return String(text);
    } catch (_e) {
      /* fall through */
    }

    return "";
  } catch (e) {
    ztoolkit.log("[Agent] getCurrentPageText error:", e);
    return "";
  }
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
    const tk = getZToolkit();
    const targetReader = reader || ((await tk?.Reader?.getReader()) as any);
    if (!targetReader?._iframeWindow) return 0;
    const wrapped = (targetReader._iframeWindow as any).wrappedJSObject;
    return wrapped?.PDFViewerApplication?.pdfViewer?.currentPageNumber || 0;
  } catch {
    return 0;
  }
}

export type ContextResult = {
  text: string;
  source: "none" | "currentPage" | "fullPdf";
  pageNumber?: number;
};

export async function getContextByMode(options: {
  mode: "none" | "currentPage" | "fullPdf";
  reader?: _ZoteroTypes.ReaderInstance | null;
  itemId?: number;
}): Promise<ContextResult> {
  const { mode, reader } = options;

  if (mode === "none") {
    return { text: "", source: "none" };
  }

  if (mode === "fullPdf") {
    const itemId = options.itemId || reader?.itemID;
    const text = itemId ? await getFullText(itemId) : "";
    return { text, source: "fullPdf" };
  }

  const pageNumber = await getCurrentPageNumber(reader);
  let text = await getCurrentPageText(reader);
  if (text) return { text, source: "currentPage", pageNumber };

  const itemId = options.itemId || reader?.itemID;
  if (itemId) {
    text = await getFullText(itemId);
    if (text) return { text, source: "fullPdf" };
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
