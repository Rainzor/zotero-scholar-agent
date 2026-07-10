import {
  parseKnowledgeSurface,
  type PaperSignalMetadata,
  type ZoteroCollectionSignal,
} from "../knowledge-surface";
import type { KnowledgeQualityReport } from "../knowledge-quality";

export type PaperVaultMeta = {
  itemId: number;
  itemKey: string;
  title: string;
  creators?: string;
  year?: string;
  abstract?: string;
  zoteroCollections?: ZoteroCollectionSignal[];
  zoteroTags?: string[];
  paperKeywords?: string[];
  rating?: number | null;
};

export const SEMANTIC_RELATIONSHIP_TYPES = [
  "cites",
  "extends",
  "contradicts",
  "supports",
  "uses_same_method",
  "uses_same_dataset",
  "uses_same_metric",
  "solves_limitation_of",
  "can_combine_with",
  "inspired_question",
] as const;

export type SemanticRelationshipType =
  (typeof SEMANTIC_RELATIONSHIP_TYPES)[number];

export type SemanticRelationship = {
  sourceItemKey: string;
  targetItemKey: string;
  type: SemanticRelationshipType;
  rationale: string;
  evidence?: string;
  updatedAt: string;
};

export type PaperRecordProjection = PaperVaultMeta & {
  schemaVersion: 2;
  generatedAt: string;
  signals: {
    rating: number | null;
    zoteroCollections: ZoteroCollectionSignal[];
    zoteroTags: string[];
    paperKeywords: string[];
    codexKeywords: string[];
    keywords: Array<{
      value: string;
      source: "zotero" | "paper" | "codex";
    }>;
  };
  quality: KnowledgeQualityReport;
  relationships: SemanticRelationship[];
};

export type PaperSignalProjection = PaperRecordProjection["signals"];

export const TEXT_PARSER_VERSION = 2;

export type TextParserSource =
  | "pdfjs"
  | "pdfworker-formfeed"
  | "pdfworker-plain"
  | "codex-ocr"
  | "inferred";

export type TextMeta = {
  textParserVersion: number;
  generatedAt: string;
  source: TextParserSource;
  hasPageMarkers: boolean;
  attemptedTextParserVersion?: number;
  lastAttemptedAt?: string;
  lastAttemptStatus?: "ok" | "empty" | "no-page-markers";
};

/** Sanitize a vault path segment (itemKey / sessionId). */
export function safePathSegment(input: string): string {
  return String(input || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Join path parts with `/`, collapsing duplicate separators. */
export function joinPathParts(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
}

/**
 * Expand `~` / `~/...` using an explicit home directory.
 * Returns "" for empty input or when `~/` is used without a home.
 */
export function normalizeVaultPath(path: string, homeDir = ""): string {
  const trimmed = String(path || "").trim();
  if (!trimmed) return "";
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) {
    return homeDir ? joinPathParts(homeDir, trimmed.slice(2)) : "";
  }
  return trimmed;
}

export function escapeTable(value: string): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function unescapeTable(value: string): string {
  return String(value || "").replace(/\\\|/g, "|").trim();
}

export function replaceMarkedBlock(
  text: string,
  start: string,
  end: string,
  replacement: string,
): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${text.slice(0, startIndex)}${replacement}${text.slice(endIndex + end.length)}`;
  }
  return `${text.trimEnd()}\n\n${replacement}`;
}

export function initialMemoryMarkdown(meta: PaperVaultMeta): string {
  const headingMeta = [meta.creators, meta.year].filter(Boolean).join(", ");
  return [
    `# ${meta.title || meta.itemKey}${headingMeta ? ` (${headingMeta})` : ""}`,
    "",
    `> itemKey: ${meta.itemKey}`,
    "",
    "## Abstract",
    "",
    "## Contribution",
    "",
    "## Problem",
    "",
    "## Method",
    "",
    "## Insight",
    "",
    "## Results",
    "",
    "## Takeaways",
    "",
    "## Reader Thinking",
    "",
    "### Questions",
    "",
    "### Critiques",
    "",
    "### Ideas / Inspirations",
    "",
    "## Library Connections",
    "",
    "### Explicit Citations",
    "",
    "### Semantic Relationships",
    "",
    "## Evidence Pointers",
    "",
  ].join("\n");
}

export function hasPageEvidenceMarkers(text: string): boolean {
  return /\[page\s+[1-9][0-9]*\]/i.test(String(text || ""));
}

export function formatWorkerTextForVault(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  if (!raw.includes("\f")) return raw.trim();
  return raw
    .split(/\f/)
    .map((pageText, index) => ({
      pageNumber: index + 1,
      text: pageText.trim(),
    }))
    .filter((page) => page.text)
    .map((page) => `[page ${page.pageNumber}]\n${page.text}`)
    .join("\n\n");
}

export function shouldReplaceTextWithPageMarkedVersion(
  existingText: string,
  candidateText: string,
): boolean {
  const existing = String(existingText || "").trim();
  const candidate = String(candidateText || "").trim();
  return (
    Boolean(existing) &&
    Boolean(candidate) &&
    !hasPageEvidenceMarkers(existing) &&
    hasPageEvidenceMarkers(candidate) &&
    existing !== candidate
  );
}

export function buildTextMeta(options: {
  text: string;
  source: TextParserSource;
  generatedAt: string;
  textParserVersion?: number;
  attemptedTextParserVersion?: number;
  lastAttemptedAt?: string;
  lastAttemptStatus?: TextMeta["lastAttemptStatus"];
}): TextMeta {
  const meta: TextMeta = {
    textParserVersion: options.textParserVersion ?? TEXT_PARSER_VERSION,
    generatedAt: options.generatedAt,
    source: options.source,
    hasPageMarkers: hasPageEvidenceMarkers(options.text),
  };
  if (typeof options.attemptedTextParserVersion === "number") {
    meta.attemptedTextParserVersion = options.attemptedTextParserVersion;
  }
  if (options.lastAttemptedAt) meta.lastAttemptedAt = options.lastAttemptedAt;
  if (options.lastAttemptStatus) meta.lastAttemptStatus = options.lastAttemptStatus;
  return meta;
}

export function inferTextMetaFromContent(
  text: string,
  generatedAt: string,
): TextMeta {
  return buildTextMeta({
    text,
    source: "inferred",
    generatedAt,
    textParserVersion: hasPageEvidenceMarkers(text) ? TEXT_PARSER_VERSION : 1,
  });
}

export function normalizeTextMeta(
  parsed: unknown,
  fallbackText: string,
  generatedAt: string,
): TextMeta {
  if (!parsed || typeof parsed !== "object") {
    return inferTextMetaFromContent(fallbackText, generatedAt);
  }
  const raw = parsed as Partial<TextMeta>;
  const version = Number(raw.textParserVersion);
  return {
    textParserVersion:
      Number.isSafeInteger(version) && version > 0
        ? version
        : hasPageEvidenceMarkers(fallbackText)
          ? TEXT_PARSER_VERSION
          : 1,
    generatedAt: String(raw.generatedAt || generatedAt),
    source: isTextParserSource(raw.source) ? raw.source : "inferred",
    hasPageMarkers:
      typeof raw.hasPageMarkers === "boolean"
        ? raw.hasPageMarkers
        : hasPageEvidenceMarkers(fallbackText),
    attemptedTextParserVersion:
      typeof raw.attemptedTextParserVersion === "number"
        ? raw.attemptedTextParserVersion
        : undefined,
    lastAttemptedAt: raw.lastAttemptedAt,
    lastAttemptStatus: raw.lastAttemptStatus,
  };
}

export function shouldAttemptTextParserMigration(meta: TextMeta): boolean {
  if (meta.textParserVersion >= TEXT_PARSER_VERSION) return false;
  if ((meta.attemptedTextParserVersion || 0) >= TEXT_PARSER_VERSION) return false;
  return true;
}

function isTextParserSource(value: unknown): value is TextParserSource {
  return (
    value === "pdfjs" ||
    value === "pdfworker-formfeed" ||
    value === "pdfworker-plain" ||
    value === "codex-ocr" ||
    value === "inferred"
  );
}

const README_ROW_PATTERN_V2 =
  /^\| ([^|]+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| \[([^\]]+)\]\(\.\/([^/]+)\/memory\.md\) \|$/gm;
const README_ROW_PATTERN_V1 =
  /^\| ([^|]+) \| ([^|]*) \| ([^|]*) \| \[([^\]]+)\]\(\.\/([^/]+)\/memory\.md\) \|$/gm;

/** Parse paper rows from a Vault README.md table. */
export function parseReadmePaperRows(readme: string): PaperVaultMeta[] {
  const entries = new Map<string, PaperVaultMeta>();
  let match: RegExpExecArray | null;
  const current = new RegExp(README_ROW_PATTERN_V2.source, "gm");
  while ((match = current.exec(readme))) {
    const rating = Number(String(match[4] || "").trim());
    entries.set(match[6], {
      itemId: 0,
      itemKey: match[6],
      title: unescapeTable(match[1]),
      creators: unescapeTable(match[2]),
      year: unescapeTable(match[3]),
      rating:
        Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    });
  }
  const legacy = new RegExp(README_ROW_PATTERN_V1.source, "gm");
  while ((match = legacy.exec(readme))) {
    if (entries.has(match[5])) continue;
    entries.set(match[5], {
      itemId: 0,
      itemKey: match[5],
      title: unescapeTable(match[1]),
      creators: unescapeTable(match[2]),
      year: unescapeTable(match[3]),
      rating: null,
    });
  }
  return Array.from(entries.values());
}

export function buildReadmeTable(entries: PaperVaultMeta[]): string {
  const markerStart = "<!-- zotero-agent-papers:start -->";
  const markerEnd = "<!-- zotero-agent-papers:end -->";
  return [
    markerStart,
    "| Title | Authors | Year | Rating | Memory |",
    "|-------|---------|------|-------:|--------|",
    ...entries.map(
      (entry) =>
        `| ${escapeTable(entry.title)} | ${escapeTable(entry.creators || "")} | ${escapeTable(entry.year || "")} | ${entry.rating || ""} | [${entry.itemKey}](./${entry.itemKey}/memory.md) |`,
    ),
    markerEnd,
    "",
  ].join("\n");
}

export function mergeReadmeEntries(
  existingReadme: string,
  current: PaperVaultMeta,
): PaperVaultMeta[] {
  const entries = new Map<string, PaperVaultMeta>();
  for (const row of parseReadmePaperRows(existingReadme)) {
    entries.set(row.itemKey, row);
  }
  entries.set(current.itemKey, current);
  return Array.from(entries.values()).sort((a, b) =>
    String(a.title || a.itemKey).localeCompare(String(b.title || b.itemKey)),
  );
}

export function buildConversationTurnMarkdown(options: {
  userMessage: string;
  assistantMessage: string;
  timestamp: string;
  codexThreadId?: string;
}): string {
  return [
    `## ${options.timestamp}${options.codexThreadId ? ` · ${options.codexThreadId}` : ""}`,
    "",
    `**You:**`,
    "",
    options.userMessage.trim() || "(empty)",
    "",
    `**Codex:**`,
    "",
    options.assistantMessage.trim() || "(empty)",
    "",
  ].join("\n");
}

export function appendMarkdownBlock(
  existing: string,
  block: string,
): string {
  const current = String(existing || "").trimEnd();
  return current ? `${current}\n\n${block}` : block;
}

/** Build paper-relative vault paths from a vault root + itemKey. */
export function buildPaperVaultPaths(vaultDir: string, itemKey: string) {
  const paperDir = joinPathParts(vaultDir, safePathSegment(itemKey));
  const conversationsDir = joinPathParts(paperDir, "conversations");
  return {
    vaultDir,
    paperDir,
    textPath: joinPathParts(paperDir, "text.txt"),
    textMetaPath: joinPathParts(paperDir, "text.meta.json"),
    memoryPath: joinPathParts(paperDir, "memory.md"),
    recordPath: joinPathParts(paperDir, "record.json"),
    conversationsDir,
    conversationPath: (sessionId: string) =>
      joinPathParts(
        conversationsDir,
        `${safePathSegment(sessionId)}.md`,
      ),
  };
}

export function isSemanticRelationshipType(
  value: string,
): value is SemanticRelationshipType {
  return (SEMANTIC_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

const RELATIONSHIP_LINE_PATTERN =
  /^-\s+\[([a-z_]+)\]\s+\[([^\]]+)\]\(\.\.\/([^/]+)\/memory\.md\):\s*(.+)$/gm;

export function parseSemanticRelationships(
  memoryMarkdown: string,
  sourceItemKey: string,
  updatedAt: string,
): SemanticRelationship[] {
  const relationships: SemanticRelationship[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(RELATIONSHIP_LINE_PATTERN.source, "gm");
  while ((match = pattern.exec(memoryMarkdown || ""))) {
    const type = String(match[1] || "").trim();
    if (!isSemanticRelationshipType(type)) continue;
    const targetItemKey = safePathSegment(match[3] || "");
    if (!targetItemKey || targetItemKey === "unknown") continue;
    const parsed = splitRelationshipRationale(match[4] || "");
    const key = `${sourceItemKey}\u0000${targetItemKey}\u0000${type}\u0000${parsed.rationale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relationships.push({
      sourceItemKey,
      targetItemKey,
      type,
      rationale: parsed.rationale,
      evidence: parsed.evidence || undefined,
      updatedAt,
    });
  }
  return relationships;
}

function splitRelationshipRationale(raw: string): {
  rationale: string;
  evidence: string;
} {
  const text = String(raw || "").trim();
  const marker = /\s+Evidence:\s*/i;
  const parts = text.split(marker);
  return {
    rationale: String(parts[0] || "").trim(),
    evidence: parts.slice(1).join(" Evidence: ").trim(),
  };
}

export function buildPaperRecordProjection(options: {
  meta: PaperVaultMeta;
  memoryMarkdown: string;
  generatedAt: string;
  quality: KnowledgeQualityReport;
}): PaperRecordProjection {
  const surface = parseKnowledgeSurface(options.memoryMarkdown);
  return {
    schemaVersion: 2,
    generatedAt: options.generatedAt,
    itemId: options.meta.itemId,
    itemKey: options.meta.itemKey,
    title: options.meta.title,
    creators: options.meta.creators,
    year: options.meta.year,
    signals: buildPaperSignalProjection(surface.signals),
    quality: options.quality,
    relationships: parseSemanticRelationships(
      options.memoryMarkdown,
      options.meta.itemKey,
      options.generatedAt,
    ),
  };
}

export function buildPaperSignalProjection(
  signals: PaperSignalMetadata,
): PaperSignalProjection {
  return {
    rating: signals.rating,
    zoteroCollections: signals.zoteroCollections,
    zoteroTags: signals.zoteroTags,
    paperKeywords: signals.paperKeywords,
    codexKeywords: signals.codexKeywords,
    keywords: [
      ...signals.zoteroTags.map((value) => ({
        value,
        source: "zotero" as const,
      })),
      ...signals.paperKeywords.map((value) => ({
        value,
        source: "paper" as const,
      })),
      ...signals.codexKeywords.map((value) => ({
        value,
        source: "codex" as const,
      })),
    ],
  };
}
