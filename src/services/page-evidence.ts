export type PageEvidenceSegment =
  | { type: "text"; text: string }
  | { type: "page"; raw: string; pageNumber: number; pageIndex: number };

export type PageEvidenceRef = Extract<PageEvidenceSegment, { type: "page" }>;

const PAGE_EVIDENCE_PATTERN = /\[page\s+([0-9]+)\]/gi;

export function parsePageEvidenceText(text: string): PageEvidenceSegment[] {
  const source = String(text || "");
  if (!source) return [];
  const segments: PageEvidenceSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PAGE_EVIDENCE_PATTERN.source, "gi");
  while ((match = pattern.exec(source))) {
    const raw = match[0];
    const pageNumber = Number(match[1]);
    if (!Number.isSafeInteger(pageNumber) || pageNumber <= 0) continue;
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        text: source.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: "page",
      raw,
      pageNumber,
      pageIndex: pageNumber - 1,
    });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < source.length) {
    segments.push({ type: "text", text: source.slice(lastIndex) });
  }
  return segments.length ? segments : [{ type: "text", text: source }];
}

export function extractPageEvidence(text: string): PageEvidenceRef[] {
  return parsePageEvidenceText(text).filter(
    (segment): segment is PageEvidenceRef => segment.type === "page",
  );
}
