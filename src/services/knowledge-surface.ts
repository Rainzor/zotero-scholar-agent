import { parse, stringify } from "yaml";

export type ZoteroCollectionSignal = {
  key: string;
  name: string;
  path: string;
};

export type PaperSignalMetadata = {
  rating: number | null;
  zoteroCollections: ZoteroCollectionSignal[];
  zoteroTags: string[];
  paperKeywords: string[];
  codexKeywords: string[];
};

export type PaperSignalUpdate = Partial<PaperSignalMetadata>;

const DEFAULT_SIGNALS: PaperSignalMetadata = {
  rating: null,
  zoteroCollections: [],
  zoteroTags: [],
  paperKeywords: [],
  codexKeywords: [],
};

export function parseKnowledgeSurface(markdown: string): {
  signals: PaperSignalMetadata;
  body: string;
} {
  const text = String(markdown || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/);
  if (!match) {
    return { signals: { ...DEFAULT_SIGNALS }, body: text };
  }
  let parsed: unknown = {};
  try {
    parsed = parse(match[1]) || {};
  } catch {
    parsed = {};
  }
  return {
    signals: normalizePaperSignals(parsed),
    body: text.slice(match[0].length),
  };
}

export function updateKnowledgeSurfaceSignals(
  markdown: string,
  update: PaperSignalUpdate,
): string {
  const current = parseKnowledgeSurface(markdown);
  const signals = normalizePaperSignals({
    ...current.signals,
    ...update,
  });
  const frontmatter = stringify(signals, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${current.body}`;
}

export function replaceKnowledgeSurfaceSection(
  markdown: string,
  heading: string,
  content: string,
): string {
  const text = String(markdown || "");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^##\\s+${escaped}\\s*\\r?\\n)([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`,
    "m",
  );
  const replacement = `$1\n${String(content || "").trim()}\n\n`;
  if (pattern.test(text)) return text.replace(pattern, replacement);
  return `${text.trimEnd()}\n\n## ${heading}\n\n${String(content || "").trim()}\n`;
}

export function normalizePaperSignals(value: unknown): PaperSignalMetadata {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<PaperSignalMetadata>)
      : {};
  return {
    rating: normalizeRating(raw.rating),
    zoteroCollections: normalizeCollections(raw.zoteroCollections),
    zoteroTags: normalizeStrings(raw.zoteroTags),
    paperKeywords: normalizeStrings(raw.paperKeywords),
    codexKeywords: normalizeStrings(raw.codexKeywords),
  };
}

function normalizeRating(value: unknown): number | null {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? rating
    : null;
}

function normalizeCollections(value: unknown): ZoteroCollectionSignal[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ZoteroCollectionSignal[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<ZoteroCollectionSignal>;
    const key = String(raw.key || "").trim();
    const name = String(raw.name || "").trim();
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      name,
      path: String(raw.path || name).trim() || name,
    });
  }
  return result;
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = String(entry || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}
