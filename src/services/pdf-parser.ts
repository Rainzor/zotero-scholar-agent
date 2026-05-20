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
    return wrapped?.PDFViewerApplication?.pdfDocument || null;
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

export function toPlainText(page: StructuredPage): string {
  return (page?.blocks || [])
    .map((b) => String(b.text || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function formatStructuredPagesForPrompt(
  pages: StructuredPage[],
): string {
  return (pages || [])
    .filter((p) => p.pageNumber > 0 && (p.blocks?.length || p.plainText))
    .map((p) => {
      const body = (p.blocks || [])
        .map((block) => {
          const headingTag =
            block.type === "heading" ? `[H${block.headingLevel || 3}] ` : "";
          return `${headingTag}${block.text}`;
        })
        .join("\n");
      return `=== Page ${p.pageNumber} ===\n${body || p.plainText || ""}`.trim();
    })
    .join("\n\n");
}

export function stripReferencesFromPages(
  pages: StructuredPage[],
): StructuredPage[] {
  let referencesStarted = false;
  const output: StructuredPage[] = [];
  for (const page of pages || []) {
    const safePage: StructuredPage = {
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 0)),
      blocks: Array.isArray(page.blocks) ? page.blocks : [],
      plainText: String(page.plainText || ""),
    };
    if (referencesStarted) {
      output.push({ ...safePage, blocks: [], plainText: "" });
      continue;
    }
    const markerIndex = safePage.blocks.findIndex((block) =>
      isReferenceHeading(block),
    );
    if (markerIndex < 0) {
      output.push(safePage);
      continue;
    }
    referencesStarted = true;
    const keptBlocks = safePage.blocks.slice(0, markerIndex);
    output.push({
      ...safePage,
      blocks: keptBlocks,
      plainText: toPlainText({ ...safePage, blocks: keptBlocks }),
    });
  }
  return output;
}

export function findBlocksByKeyword(
  pages: StructuredPage[],
  keyword: string,
): Array<{ pageNumber: number; block: TextBlock }> {
  const q = String(keyword || "")
    .trim()
    .toLowerCase();
  if (!q) return [];
  const matches: Array<{ pageNumber: number; block: TextBlock }> = [];
  for (const page of pages || []) {
    for (const block of page.blocks || []) {
      if (
        String(block.text || "")
          .toLowerCase()
          .includes(q)
      ) {
        matches.push({ pageNumber: page.pageNumber, block });
      }
    }
  }
  return matches;
}

export function getSectionPages(
  pages: StructuredPage[],
  sectionTitle: string,
): StructuredPage[] {
  const q = String(sectionTitle || "")
    .trim()
    .toLowerCase();
  if (!q) return [];
  const selected = new Set<number>();
  for (const page of pages || []) {
    const hasSection = (page.blocks || []).some(
      (b) =>
        b.type === "heading" &&
        String(b.text || "")
          .toLowerCase()
          .includes(q),
    );
    if (hasSection) {
      selected.add(page.pageNumber);
      selected.add(page.pageNumber + 1);
    }
  }
  return (pages || []).filter((p) => selected.has(p.pageNumber));
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

function isReferenceHeading(block: TextBlock): boolean {
  if (!block || block.type !== "heading") return false;
  const text = String(block.text || "")
    .trim()
    .toLowerCase();
  if (!text) return false;
  return /^(references|bibliography|参考文献)\b/.test(text);
}
