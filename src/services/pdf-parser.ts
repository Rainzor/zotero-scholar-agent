export type TextBlockType =
  | "heading"
  | "paragraph"
  | "caption"
  | "footnote"
  | "listItem"
  | "other";

export type TextBlock = {
  type: TextBlockType;
  text: string;
  fontSize: number;
  fontName: string;
  y: number;
  headingLevel?: 1 | 2 | 3;
};

export type StructuredPage = {
  pageNumber: number;
  blocks: TextBlock[];
  plainText: string;
};

type RawItem = {
  str?: string;
  transform?: number[];
  height?: number;
  fontName?: string;
};

type LineRow = {
  text: string;
  y: number;
  fontSize: number;
  fontName: string;
};

export async function parseAllPages(
  pdfDocument: any,
): Promise<StructuredPage[]> {
  const totalPages = Number(pdfDocument?.numPages || 0);
  if (!Number.isFinite(totalPages) || totalPages <= 0) return [];
  const pages: StructuredPage[] = [];
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    pages.push(await parsePageStructured(pdfDocument, pageNumber));
  }
  return pages;
}

export function getPdfDocumentFromReader(
  reader?: _ZoteroTypes.ReaderInstance | null,
): any | null {
  try {
    const iframeWin = (reader as any)?._iframeWindow;
    const wrapped = iframeWin?.wrappedJSObject;
    return (
      wrapped?.PDFViewerApplication?.pdfDocument ||
      iframeWin?.PDFViewerApplication?.pdfDocument ||
      null
    );
  } catch {
    return null;
  }
}

export async function parsePageStructured(
  pdfDocument: any,
  pageNumber: number,
): Promise<StructuredPage> {
  try {
    const page = await pdfDocument?.getPage?.(pageNumber);
    if (!page) return emptyPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows = collectRows(textContent?.items || []);
    if (rows.length === 0) return emptyPage(pageNumber);
    const medianFont =
      computeMedian(rows.map((r) => r.fontSize).filter((n) => n > 0)) || 10;
    const maxY = Math.max(...rows.map((r) => r.y));
    const blocks = rows
      .map((row) => classifyRow(row, medianFont, maxY))
      .filter((b) => b.text);
    return {
      pageNumber,
      blocks,
      plainText: toPlainText({ pageNumber, blocks, plainText: "" }),
    };
  } catch {
    return emptyPage(pageNumber);
  }
}

function toPlainText(page: StructuredPage): string {
  return (page?.blocks || [])
    .map((b) => String(b.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

function collectRows(items: RawItem[]): LineRow[] {
  const rows: LineRow[] = [];
  let current = "";
  let currentY = Number.NaN;
  let currentFontSize = 0;
  let currentFontName = "";

  const flush = () => {
    const text = current.trim();
    if (!text) return;
    rows.push({
      text,
      y: Number.isFinite(currentY) ? currentY : 0,
      fontSize: currentFontSize > 0 ? currentFontSize : 10,
      fontName: currentFontName || "",
    });
    current = "";
  };

  for (const it of items || []) {
    const chunk = String(it?.str || "");
    if (!chunk) continue;
    const y = Number(it?.transform?.[5]);
    const fontSize = getItemFontSize(it);
    const fontName = String(it?.fontName || "");
    if (
      current &&
      Number.isFinite(y) &&
      Number.isFinite(currentY) &&
      Math.abs(y - currentY) > 2
    ) {
      flush();
    }
    current += chunk;
    if (Number.isFinite(y)) currentY = y;
    if (fontSize > 0) currentFontSize = fontSize;
    if (fontName) currentFontName = fontName;
  }
  flush();
  return rows;
}

function classifyRow(
  row: LineRow,
  medianFont: number,
  maxY: number,
): TextBlock {
  const text = String(row.text || "").trim();
  const fontSize = row.fontSize > 0 ? row.fontSize : medianFont;
  const fontName = row.fontName || "";
  const lower = text.toLowerCase();
  const isBold = /bold|black|semibold|demi|heavy/i.test(fontName);
  const isHeading = isBold || fontSize >= medianFont * 1.2;
  const isCaption = /^(figure|fig\.|table|tab\.)\s*\d*/i.test(text);
  const isList = /^(\d+[\.\)]|[-*•])\s+/.test(text);
  const isFootnote = fontSize <= medianFont * 0.85 && row.y <= maxY * 0.2;

  if (isCaption) return { type: "caption", text, fontSize, fontName, y: row.y };
  if (isFootnote)
    return { type: "footnote", text, fontSize, fontName, y: row.y };
  if (isHeading) {
    const headingLevel: 1 | 2 | 3 =
      fontSize >= medianFont * 1.8 ? 1 : fontSize >= medianFont * 1.45 ? 2 : 3;
    return {
      type: "heading",
      text,
      fontSize,
      fontName,
      y: row.y,
      headingLevel,
    };
  }
  if (isList) return { type: "listItem", text, fontSize, fontName, y: row.y };
  if (!lower) return { type: "other", text, fontSize, fontName, y: row.y };
  return { type: "paragraph", text, fontSize, fontName, y: row.y };
}

function getItemFontSize(it: RawItem): number {
  const byTransform = Number(it?.transform?.[0]);
  if (Number.isFinite(byTransform) && byTransform > 0)
    return Math.abs(byTransform);
  const byHeight = Number(it?.height);
  if (Number.isFinite(byHeight) && byHeight > 0) return Math.abs(byHeight);
  return 0;
}

function computeMedian(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptyPage(pageNumber: number): StructuredPage {
  return { pageNumber, blocks: [], plainText: "" };
}
