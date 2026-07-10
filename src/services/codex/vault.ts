import { getFullText } from "../../modules/pdf-context";
import {
  parseKnowledgeSurface,
  updateKnowledgeSurfaceSignals,
  type PaperSignalUpdate,
} from "../knowledge-surface";
import {
  evaluateKnowledgeSurface,
  type KnowledgeQualityReport,
} from "../knowledge-quality";
import { getPref, setPref } from "../../utils/prefs";
import { runLineProcess } from "./subprocess";
import {
  appendMarkdownBlock,
  buildConversationTurnMarkdown,
  buildPaperVaultPaths,
  buildPaperRecordProjection,
  buildReadmeTable,
  buildTextMeta,
  formatWorkerTextForVault,
  hasPageEvidenceMarkers,
  initialMemoryMarkdown,
  normalizeTextMeta,
  joinPathParts,
  mergeReadmeEntries,
  normalizeVaultPath,
  parseReadmePaperRows,
  replaceMarkedBlock,
  safePathSegment,
  shouldAttemptTextParserMigration,
  shouldReplaceTextWithPageMarkedVersion,
  TEXT_PARSER_VERSION,
  type TextMeta,
  type TextParserSource,
  type SemanticRelationship,
  type PaperRecordProjection,
  type PaperVaultMeta,
} from "./vault-format";
import {
  mergeVaultGitignore,
  normalizeVaultManifest,
} from "./vault-manifest";

export type { PaperVaultMeta } from "./vault-format";
export type { SemanticRelationship } from "./vault-format";

export type EnsurePaperVaultOptions = PaperVaultMeta & {
  pdfItemId: number;
  forceTextRefresh?: boolean;
  onStatus?: (text: string) => void;
};

export type PaperVaultPaths = {
  vaultDir: string;
  paperDir: string;
  textPath: string;
  textMetaPath: string;
  memoryPath: string;
  recordPath: string;
  conversationsDir: string;
};

export const CODEX_VAULT_PATH_PREF = "codex.vaultPath";

export class PaperTextUnavailableError extends Error {
  constructor(
    readonly itemKey: string,
    readonly pdfItemId: number,
  ) {
    super(
      `PDF attachment found, but full text could not be extracted for ${itemKey}.`,
    );
    this.name = "PaperTextUnavailableError";
  }
}

const ROOT_AGENTS_MD = `# Knowledge Vault — Operating Rules

This is a researcher's cross-paper knowledge base. Each subdirectory named by a
Zotero item key (for example \`PXW99EKT/\`) holds one paper.

## Files per paper
- \`text.txt\` — extracted PDF full text. READ-ONLY, never edit.
- \`memory.md\` — durable, human-readable Paper Knowledge Record. READ before answering; UPDATE after.
- \`record.json\` — generated Structured Projection for scripts/search. DO NOT edit.
- \`conversations/*.md\` — human transcript logs. DO NOT read or edit; the plugin manages them.

## The paper currently in focus is given to you in each prompt.

## How to answer
1. Read the in-focus paper's \`memory.md\` first; create it from \`text.txt\` if missing.
2. Use \`text.txt\` for detail the memory does not cover.
3. For cross-paper questions, search across all \`*/memory.md\` files first, then \`*/text.txt\` if needed.

## How to update memory (\`memory.md\`) — the Knowledge Surface
- Preserve YAML frontmatter exactly. The plugin owns rating, Zotero mirrors,
  paper keywords, and accepted Codex keywords; never edit these fields.
- Update ONLY when you learned something materially new this turn.
- REWRITE and DEDUPE. Never blindly append. Keep it tight and factual.
- Preserve this default structure: \`## Abstract\`, \`## Contribution\`, \`## Problem\`,
  \`## Method\`, \`## Insight\`, \`## Results\`, \`## Takeaways\`,
  \`## Reader Thinking\`, \`## Library Connections\`, \`## Evidence Pointers\`.
- \`Abstract\` should be the paper's original or near-original abstract. Do not invent one.
- Keep \`Insight\` paper-grounded. User ideas belong in \`Reader Thinking\`.
- Under \`## Library Connections / ### Semantic Relationships\`, use this exact line format:
  \`- [extends] [Paper title](../OTHERKEY/memory.md): rationale. Evidence: [page 4]\`
- Allowed relationship types: \`cites\`, \`extends\`, \`contradicts\`, \`supports\`,
  \`uses_same_method\`, \`uses_same_dataset\`, \`uses_same_metric\`,
  \`solves_limitation_of\`, \`can_combine_with\`, \`inspired_question\`.
- Never modify another paper's memory unless the user explicitly asks.
`;

export async function getVaultDir(): Promise<string> {
  return getConfiguredVaultPath() || getDefaultVaultPath();
}

export function getDefaultVaultPath(): string {
  return joinPath(getHomeDir(), "papers");
}

export function getConfiguredVaultPath(): string {
  return normalizeVaultPath(
    String(getPref(CODEX_VAULT_PATH_PREF) || ""),
    getHomeDir(),
  );
}

export function setConfiguredVaultPath(path: string) {
  setPref(
    CODEX_VAULT_PATH_PREF,
    normalizeVaultPath(path, getHomeDir()),
  );
}

export async function getPaperVaultPaths(
  itemKey: string,
): Promise<PaperVaultPaths> {
  const vaultDir = await getVaultDir();
  const paths = buildPaperVaultPaths(vaultDir, itemKey);
  return {
    vaultDir: paths.vaultDir,
    paperDir: paths.paperDir,
    textPath: paths.textPath,
    textMetaPath: paths.textMetaPath,
    memoryPath: paths.memoryPath,
    recordPath: paths.recordPath,
    conversationsDir: paths.conversationsDir,
  };
}

export type VaultSearchHit = {
  itemKey: string;
  title: string;
  matches: { line: number; text: string }[];
};

type TextExtractionResult = {
  text: string;
  source: TextParserSource;
};

export async function readPaperMemory(itemKey: string): Promise<string> {
  const paths = await getPaperVaultPaths(itemKey);
  return readTextIfExists(paths.memoryPath);
}

export async function writePaperMemory(
  itemKey: string,
  markdown: string,
): Promise<void> {
  const paths = await getPaperVaultPaths(itemKey);
  await getIOUtils().writeUTF8(
    paths.memoryPath,
    String(markdown || "").endsWith("\n")
      ? String(markdown || "")
      : `${String(markdown || "")}\n`,
  );
}

export async function writeEnrichedPaperText(
  itemKey: string,
  text: string,
  source: Extract<TextParserSource, "codex-ocr">,
): Promise<void> {
  const paths = await getPaperVaultPaths(itemKey);
  await writeTextAndMeta(paths.textPath, paths.textMetaPath, {
    text: String(text || "").trim(),
    source,
  });
}

export async function readPaperText(itemKey: string): Promise<string> {
  const paths = await getPaperVaultPaths(itemKey);
  return readTextIfExists(paths.textPath);
}

export async function updatePaperSignals(
  paper: PaperVaultMeta,
  update: PaperSignalUpdate,
): Promise<boolean> {
  const paths = await getPaperVaultPaths(paper.itemKey);
  const existing = await readTextIfExists(paths.memoryPath);
  const updated = updateKnowledgeSurfaceSignals(existing, update);
  if (updated === existing) return false;
  await getIOUtils().writeUTF8(paths.memoryPath, updated);
  await refreshPaperRecordProjection(paper);
  return true;
}

export async function updatePaperRating(
  paper: PaperVaultMeta,
  rating: number | null,
): Promise<void> {
  const changed = await updatePaperSignals(paper, { rating });
  if (!changed) return;
  await commitVaultChanges(`rating: ${paper.itemKey}`);
}

export async function acceptPaperKeyword(
  paper: PaperVaultMeta,
  keyword: string,
): Promise<void> {
  const memory = await readPaperMemory(paper.itemKey);
  const signals = parseKnowledgeSurface(memory).signals;
  const changed = await updatePaperSignals(paper, {
    codexKeywords: [...signals.codexKeywords, keyword],
  });
  if (!changed) return;
  await commitVaultChanges(`keyword: ${paper.itemKey} ${keyword}`.trim());
}

export async function readPaperCompactContext(
  paper: PaperVaultMeta,
): Promise<string> {
  const memory = await readPaperMemory(paper.itemKey);
  const trimmed = memory.trim();
  if (!trimmed) {
    return `# ${paper.title || paper.itemKey}\n\n> itemKey: ${paper.itemKey}\n\n(No memory.md content yet.)`;
  }
  return truncateForPrompt(trimmed, 12000);
}

export async function refreshPaperRecordProjection(
  meta: PaperVaultMeta,
  quality?: KnowledgeQualityReport,
): Promise<SemanticRelationship[]> {
  const paths = await getPaperVaultPaths(meta.itemKey);
  const memoryMarkdown = await readTextIfExists(paths.memoryPath);
  const existing = await readExistingProjection(paths.recordPath);
  const generatedAt = new Date().toISOString();
  const qualityReport =
    quality ||
    evaluateKnowledgeSurface({
      after: memoryMarkdown,
      sourceAbstract: meta.abstract,
      itemKey: meta.itemKey,
      checkedAt: generatedAt,
    });
  const projection = buildPaperRecordProjection({
    meta,
    memoryMarkdown,
    generatedAt,
    quality: qualityReport,
  });
  if (existing && projectionsEquivalent(existing, projection)) {
    return existing.relationships || [];
  }
  await getIOUtils().writeUTF8(
    paths.recordPath,
    `${JSON.stringify(projection, null, 2)}\n`,
  );
  return projection.relationships;
}

export async function paperMemoryExists(itemKey: string): Promise<boolean> {
  const paths = await getPaperVaultPaths(itemKey);
  return safeExists(paths.memoryPath);
}

/**
 * List every paper known to the vault. Prefers README rows (they carry
 * human-readable metadata) and falls back to scanning item-key directories so
 * papers created outside the README still show up.
 */
export async function listVaultPapers(): Promise<PaperVaultMeta[]> {
  const vaultDir = await getVaultDir();
  const entries = new Map<string, PaperVaultMeta>();

  const readme = await readTextIfExists(joinPath(vaultDir, "README.md"));
  for (const row of parseReadmePaperRows(readme)) {
    entries.set(row.itemKey, row);
  }

  for (const key of await listPaperDirs(vaultDir)) {
    if (entries.has(key)) continue;
    entries.set(key, { itemId: 0, itemKey: key, title: key });
  }

  for (const paper of entries.values()) {
    const memory = await readPaperMemory(paper.itemKey);
    paper.rating = parseKnowledgeSurface(memory).signals.rating;
  }

  return Array.from(entries.values()).sort((a, b) =>
    String(a.title || a.itemKey).localeCompare(String(b.title || b.itemKey)),
  );
}

/**
 * Case-insensitive substring search across every paper's memory.md. Runs in JS
 * (vaults are small) so it has no dependency on grep being available.
 */
export async function searchVaultMemory(
  query: string,
  maxPerPaper = 5,
): Promise<VaultSearchHit[]> {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  const papers = await listVaultPapers();
  const hits: VaultSearchHit[] = [];
  for (const paper of papers) {
    const content = await readPaperMemory(paper.itemKey);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    const matches: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({ line: i + 1, text: lines[i].trim() });
        if (matches.length >= maxPerPaper) break;
      }
    }
    if (matches.length) hits.push({ itemKey: paper.itemKey, title: paper.title, matches });
  }
  return hits;
}

async function listPaperDirs(vaultDir: string): Promise<string[]> {
  try {
    if (!(await safeExists(vaultDir))) return [];
    const children: string[] = await getIOUtils().getChildren(vaultDir);
    const keys: string[] = [];
    for (const child of children || []) {
      const name = basename(child);
      if (!name || name.startsWith(".")) continue;
      if (await safeExists(joinPath(child, "memory.md"))) keys.push(name);
    }
    return keys;
  } catch {
    return [];
  }
}

function basename(path: string): string {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function truncateForPrompt(text: string, maxChars: number): string {
  const clean = String(text || "").trim();
  if (clean.length <= maxChars) return clean;
  const head = clean.slice(0, Math.max(0, maxChars - 160)).trimEnd();
  return `${head}\n\n[Truncated for prompt. Codex may read this paper's text.txt if the question needs more detail.]`;
}

async function readExistingProjection(path: string): Promise<{
  schemaVersion?: number;
  itemId?: number;
  itemKey?: string;
  title?: string;
  creators?: string;
  year?: string;
  signals?: PaperRecordProjection["signals"];
  quality?: KnowledgeQualityReport;
  relationships?: SemanticRelationship[];
} | null> {
  try {
    const raw = await readTextIfExists(path);
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function projectionsEquivalent(
  existing: {
    schemaVersion?: number;
    itemId?: number;
    itemKey?: string;
    title?: string;
    creators?: string;
    year?: string;
    signals?: PaperRecordProjection["signals"];
    quality?: KnowledgeQualityReport;
    relationships?: SemanticRelationship[];
  },
  next: {
    schemaVersion: number;
    itemId?: number;
    itemKey?: string;
    title?: string;
    creators?: string;
    year?: string;
    signals: PaperRecordProjection["signals"];
    quality: KnowledgeQualityReport;
    relationships: SemanticRelationship[];
  },
): boolean {
  return (
    Number(existing.schemaVersion || 0) === Number(next.schemaVersion) &&
    Number(existing.itemId || 0) === Number(next.itemId || 0) &&
    String(existing.itemKey || "") === String(next.itemKey || "") &&
    String(existing.title || "") === String(next.title || "") &&
    String(existing.creators || "") === String(next.creators || "") &&
    String(existing.year || "") === String(next.year || "") &&
    JSON.stringify(existing.signals || null) === JSON.stringify(next.signals) &&
    stableQuality(existing.quality) === stableQuality(next.quality) &&
    stableRelationships(existing.relationships || []) ===
      stableRelationships(next.relationships || [])
  );
}

function stableQuality(quality?: KnowledgeQualityReport): string {
  if (!quality) return "";
  return JSON.stringify({
    ...quality,
    checkedAt: "",
  });
}

function stableRelationships(relationships: SemanticRelationship[]): string {
  return JSON.stringify(
    (relationships || [])
      .map((rel) => ({
        sourceItemKey: rel.sourceItemKey,
        targetItemKey: rel.targetItemKey,
        type: rel.type,
        rationale: rel.rationale,
        evidence: rel.evidence || "",
      }))
      .sort((a, b) =>
        `${a.sourceItemKey}\u0000${a.targetItemKey}\u0000${a.type}\u0000${a.rationale}`.localeCompare(
          `${b.sourceItemKey}\u0000${b.targetItemKey}\u0000${b.type}\u0000${b.rationale}`,
        ),
      ),
  );
}

export async function ensurePaperVault(
  options: EnsurePaperVaultOptions,
): Promise<PaperVaultPaths> {
  const paths = await getPaperVaultPaths(options.itemKey);
  const ioUtils = getIOUtils();
  options.onStatus?.("Preparing Knowledge Vault...");
  await ensureDirectory(paths.vaultDir);
  await ensureDirectory(paths.paperDir);
  await ensureDirectory(paths.conversationsDir);
  await ensureRootAgents(joinPath(paths.vaultDir, "AGENTS.md"));
  await ensureGitRepo(paths.vaultDir);
  const manifestMigrated = await ensureVaultManifest(paths.vaultDir);
  await ensureGitignore(paths.vaultDir);
  if (manifestMigrated) {
    await untrackIgnoredVaultArtifacts(paths.vaultDir);
  }
  await writeIfMissing(
    joinPath(paths.paperDir, "memory.md"),
    initialMemoryMarkdown(options),
  );
  await syncPaperSignalMetadata(paths.memoryPath, {
    zoteroCollections: options.zoteroCollections,
    zoteroTags: options.zoteroTags,
    paperKeywords: options.paperKeywords,
  });
  const textExists = ioUtils && (await safeExists(paths.textPath));
  if (options.forceTextRefresh || !textExists) {
    options.onStatus?.("Extracting paper text...");
    const result = await buildTextForPaper(options);
    if (!result.text.trim()) {
      throw new PaperTextUnavailableError(options.itemKey, options.pdfItemId);
    }
    await writeTextAndMeta(paths.textPath, paths.textMetaPath, result);
  } else {
    await migrateTextIfParserOutdated(options, paths);
    const currentText = await readTextIfExists(paths.textPath);
    if (!currentText.trim()) {
      throw new PaperTextUnavailableError(options.itemKey, options.pdfItemId);
    }
  }

  await updateReadme(options);
  await refreshPaperRecordProjection(options);
  return paths;
}

async function migrateTextIfParserOutdated(
  options: EnsurePaperVaultOptions,
  paths: PaperVaultPaths,
) {
  const existing = await readTextIfExists(paths.textPath);
  const meta = await readTextMeta(paths.textMetaPath, existing);
  if (!shouldAttemptTextParserMigration(meta)) {
    if (!(await safeExists(paths.textMetaPath))) {
      await writeTextMeta(paths.textMetaPath, meta);
    }
    return;
  }
  options.onStatus?.("Refreshing paper text parser version...");
  const result = await buildTextForPaper(options);
  const status = !result.text.trim()
    ? "empty"
    : hasPageEvidenceMarkers(result.text)
      ? "ok"
      : "no-page-markers";
  if (!result.text.trim()) {
    await writeTextMeta(
      paths.textMetaPath,
      buildTextMeta({
        text: existing,
        source: meta.source,
        generatedAt: meta.generatedAt,
        textParserVersion: meta.textParserVersion,
        attemptedTextParserVersion: TEXT_PARSER_VERSION,
        lastAttemptedAt: new Date().toISOString(),
        lastAttemptStatus: status,
      }),
    );
    return;
  }

  if (
    !existing.trim() ||
    shouldReplaceTextWithPageMarkedVersion(existing, result.text) ||
    existing.trim() !== result.text.trim()
  ) {
    await writeTextAndMeta(paths.textPath, paths.textMetaPath, result);
  } else {
    await writeTextMeta(
      paths.textMetaPath,
      buildTextMeta({
        text: existing,
        source: result.source,
        generatedAt: new Date().toISOString(),
        textParserVersion: TEXT_PARSER_VERSION,
        attemptedTextParserVersion: TEXT_PARSER_VERSION,
        lastAttemptedAt: new Date().toISOString(),
        lastAttemptStatus: status,
      }),
    );
  }
  await appendVaultLog(
    "pdf-text-parser-migration",
    `Refreshed text.txt parser metadata for ${options.itemKey}`,
    {
      itemKey: options.itemKey,
      pdfItemId: options.pdfItemId,
      fromVersion: meta.textParserVersion,
      toVersion: TEXT_PARSER_VERSION,
      source: result.source,
      hasPageMarkers: hasPageEvidenceMarkers(result.text),
    },
  );
}

async function writeTextAndMeta(
  textPath: string,
  metaPath: string,
  result: TextExtractionResult,
) {
  await getIOUtils().writeUTF8(textPath, result.text);
  await writeTextMeta(
    metaPath,
    buildTextMeta({
      text: result.text,
      source: result.source,
      generatedAt: new Date().toISOString(),
    }),
  );
}

async function readTextMeta(metaPath: string, fallbackText: string): Promise<TextMeta> {
  const raw = await readTextIfExists(metaPath);
  if (!raw.trim()) {
    return normalizeTextMeta(null, fallbackText, new Date().toISOString());
  }
  try {
    return normalizeTextMeta(JSON.parse(raw), fallbackText, new Date().toISOString());
  } catch {
    return normalizeTextMeta(null, fallbackText, new Date().toISOString());
  }
}

async function writeTextMeta(metaPath: string, meta: TextMeta) {
  await getIOUtils().writeUTF8(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

export async function appendConversationTurn(options: {
  itemKey: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  codexThreadId?: string;
}) {
  const paths = await getPaperVaultPaths(options.itemKey);
  await ensureDirectory(paths.conversationsDir);
  const filePath = joinPath(
    paths.conversationsDir,
    `${safePathSegment(options.sessionId)}.md`,
  );
  const block = buildConversationTurnMarkdown({
    userMessage: options.userMessage,
    assistantMessage: options.assistantMessage,
    timestamp: new Date().toISOString(),
    codexThreadId: options.codexThreadId,
  });
  const existing = await readTextIfExists(filePath);
  await getIOUtils().writeUTF8(filePath, appendMarkdownBlock(existing, block));
}

export async function appendVaultLog(
  kind: string,
  message: string,
  details?: Record<string, unknown>,
) {
  try {
    const vaultDir = await getVaultDir();
    const logsDir = joinPath(vaultDir, ".logs");
    await ensureDirectory(logsDir);
    const filePath = joinPath(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);
    const block = [
      `## ${new Date().toISOString()} · ${kind}`,
      "",
      message,
      details ? `\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`` : "",
      "",
    ].join("\n");
    const existing = (await readTextIfExists(filePath)).trimEnd();
    await getIOUtils().writeUTF8(filePath, existing ? `${existing}\n\n${block}` : block);
  } catch (error) {
    ztoolkit.log("[Codex Vault] Failed to write vault log:", error);
  }
}

export async function commitVaultChanges(message: string): Promise<boolean> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  await runGit(vaultDir, ["add", "-A"]);
  const diff = await runGit(vaultDir, ["diff", "--cached", "--quiet"], 30000, true);
  if (diff.exitCode === 0) return false;
  const commit = await runGit(
    vaultDir,
    [
      "-c",
      "user.name=zotero-agent",
      "-c",
      "user.email=agent@local",
      "commit",
      "-m",
      message,
    ],
    120000,
    true,
  );
  return commit.exitCode === 0;
}

// Vault text comes solely from Zotero's PDFWorker full-text extraction. The
// former PDF.js structured-parse path never succeeded in production (page
// getTextContent items were unreadable across the reader's Xray boundary), so
// it and its page cache were removed. formatWorkerTextForVault turns the
// worker's form-feed page breaks into `[page N]` markers.
async function buildTextForPaper(
  options: EnsurePaperVaultOptions,
): Promise<TextExtractionResult> {
  if (options.pdfItemId > 0) {
    const fullText = await getFullText(options.pdfItemId);
    const workerText = formatWorkerTextForVault(fullText);
    if (workerText) {
      return {
        text: workerText,
        source: hasPageEvidenceMarkers(workerText)
          ? "pdfworker-formfeed"
          : "pdfworker-plain",
      };
    }
    ztoolkit.log(
      `[Codex Vault] PDFWorker returned no text for ${options.itemKey}, pdfItemId=${options.pdfItemId}`,
    );
    await appendVaultLog(
      "pdf-text-empty-pdfworker",
      `PDFWorker returned no text for ${options.itemKey}`,
      { itemKey: options.itemKey, pdfItemId: options.pdfItemId },
    );
  }
  return { text: "", source: "pdfworker-plain" };
}

async function updateReadme(meta: PaperVaultMeta) {
  const vaultDir = await getVaultDir();
  const readmePath = joinPath(vaultDir, "README.md");
  const existing = await readTextIfExists(readmePath);
  const markerStart = "<!-- zotero-agent-papers:start -->";
  const markerEnd = "<!-- zotero-agent-papers:end -->";
  const entries = mergeReadmeEntries(existing, meta);
  const table = buildReadmeTable(entries);
  const base = existing.trim()
    ? replaceMarkedBlock(existing, markerStart, markerEnd, table)
    : `# My Papers\n\n${table}`;
  await getIOUtils().writeUTF8(readmePath, base.endsWith("\n") ? base : `${base}\n`);
}

async function ensureGitRepo(vaultDir: string) {
  if (await safeExists(joinPath(vaultDir, ".git"))) return;
  await runGit(vaultDir, ["init"], 30000, true);
}

async function ensureGitignore(vaultDir: string) {
  const path = joinPath(vaultDir, ".gitignore");
  const existing = await readTextIfExists(path);
  const merged = mergeVaultGitignore(existing);
  if (merged !== existing) {
    await getIOUtils().writeUTF8(path, merged);
  }
}

async function ensureVaultManifest(vaultDir: string): Promise<boolean> {
  const path = joinPath(vaultDir, "vault.json");
  const raw = await readTextIfExists(path);
  let parsed: unknown = null;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const manifest = normalizeVaultManifest(parsed);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (serialized !== raw) {
    await getIOUtils().writeUTF8(path, serialized);
    return true;
  }
  return false;
}

async function untrackIgnoredVaultArtifacts(vaultDir: string) {
  await runGit(
    vaultDir,
    [
      "rm",
      "-r",
      "--cached",
      "--ignore-unmatch",
      "--",
      ".logs",
      ".generated",
      ":(glob)*/figures/local/**",
      ":(glob)*/figures/generated/**",
    ],
    30000,
    true,
  );
}

async function syncPaperSignalMetadata(
  memoryPath: string,
  update: PaperSignalUpdate,
) {
  const definedUpdate: PaperSignalUpdate = {};
  if (update.zoteroCollections) {
    definedUpdate.zoteroCollections = update.zoteroCollections;
  }
  if (update.zoteroTags) definedUpdate.zoteroTags = update.zoteroTags;
  if (update.paperKeywords) {
    definedUpdate.paperKeywords = update.paperKeywords;
  }
  if (!Object.keys(definedUpdate).length) return;
  const existing = await readTextIfExists(memoryPath);
  const updated = updateKnowledgeSurfaceSignals(existing, definedUpdate);
  if (updated !== existing) {
    await getIOUtils().writeUTF8(memoryPath, updated);
  }
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 60000,
  allowNonZero = false,
) {
  const git = await resolveGitBinary();
  const result = await runLineProcess({
    command: git,
    arguments: args,
    cwd,
    timeoutMs,
  });
  if (!allowNonZero && result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result;
}

async function resolveGitBinary(): Promise<string> {
  for (const candidate of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
    if (await safeExists(candidate)) return candidate;
  }
  return "/usr/bin/git";
}

async function writeIfMissing(path: string, content: string) {
  if (await safeExists(path)) return;
  await getIOUtils().writeUTF8(path, content);
}

async function ensureRootAgents(path: string) {
  const existing = await readTextIfExists(path);
  if (!existing.trim()) {
    await getIOUtils().writeUTF8(path, ROOT_AGENTS_MD);
    return;
  }
  if (
    existing.startsWith("# Knowledge Vault — Operating Rules") &&
    existing !== ROOT_AGENTS_MD
  ) {
    await getIOUtils().writeUTF8(path, ROOT_AGENTS_MD);
  }
}

async function readTextIfExists(path: string): Promise<string> {
  if (!(await safeExists(path))) return "";
  try {
    return String(await getIOUtils().readUTF8(path));
  } catch {
    return "";
  }
}

async function ensureDirectory(path: string) {
  await getIOUtils().makeDirectory(path, {
    createAncestors: true,
    ignoreExisting: true,
  });
}

async function safeExists(path: string): Promise<boolean> {
  try {
    return Boolean(await getIOUtils().exists(path));
  } catch {
    return false;
  }
}

function getIOUtils(): any {
  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils) throw new Error("IOUtils is not available in this Zotero environment.");
  return ioUtils;
}

function getHomeDir(): string {
  const envHome = String((globalThis as any).Services?.env?.get?.("HOME") || "");
  if (envHome) return envHome;
  try {
    const dirsvc = (globalThis as any).Services?.dirsvc;
    const components = (globalThis as any).Components;
    const home = dirsvc?.get?.("Home", components?.interfaces?.nsIFile);
    if (home?.path) return String(home.path);
  } catch {
    // Ignore.
  }
  return "";
}

function joinPath(...parts: string[]): string {
  const pathUtils = (globalThis as any).PathUtils;
  if (pathUtils?.join) return pathUtils.join(...parts.filter(Boolean));
  return joinPathParts(...parts);
}
