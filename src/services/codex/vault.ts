import { getFullText } from "../../modules/pdf-context";
import {
  buildInitialNotesMarkdown,
  insertPaperNoteEntry,
  migrateKnowledgeSurfaceV2,
  parseKnowledgeSurface,
  refreshKnowledgeSurfacePluginBlock,
  updateKnowledgeSurfaceSignals,
  type PaperSignalUpdate,
  type PaperValueType,
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
  scorePaperForQuery,
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
  CURRENT_VAULT_MANIFEST,
  isCurrentVaultManifest,
  mergeVaultGitignore,
  normalizeVaultManifest,
} from "./vault-manifest";
import {
  getWorkflowSkillFiles,
  WORKFLOW_SKILL_VERSION,
} from "./workflow-skills";

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
  notesPath: string;
  recordPath: string;
  codeDir: string;
  codeNotesPath: string;
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
- \`memory.md\` — paper-grounded Knowledge Surface. The marked bibliography/abstract
  block and YAML frontmatter are plugin-owned; only rewrite the interpretation area.
- \`notes.md\` — append-only Reader Thinking. READ when the user asks about their own
  judgment, but DO NOT edit; the plugin appends confirmed entries.
- \`record.json\` — generated Structured Projection for scripts/search. DO NOT edit.
- \`conversations/*.md\` — human transcript logs. DO NOT read or edit; the plugin manages them.
- \`code/\` — optional gitignored source checkout for L3 analysis. Treat it as read-only.
- \`code-notes.md\` — L3 source-code analysis. Preserve its plugin-owned provenance block.

## The paper currently in focus is given to you in each prompt.

## How to answer
1. Read the in-focus paper's \`memory.md\` first; create it from \`text.txt\` if missing.
2. Use \`text.txt\` for detail the memory does not cover.
3. For cross-paper questions, search across all \`*/memory.md\` files first, then \`*/text.txt\` if needed.
4. Write explanatory prose in the user's language. Preserve canonical technical
   terms, quoted terminology, and established English names when translation would
   reduce retrieval quality.

## How to update memory (\`memory.md\`) — the Knowledge Surface
- Preserve YAML frontmatter exactly. The plugin owns rating, Zotero mirrors,
  tier, value types, paper keywords, and accepted Codex keywords; never edit these fields.
- Never edit content between \`<!-- zotero-agent:paper:start -->\` and
  \`<!-- zotero-agent:paper:end -->\`.
- Update ONLY when you learned something materially new this turn.
- REWRITE and DEDUPE. Never blindly append. Keep it tight and factual.
- Follow the tier in frontmatter: L0 is a short negative-knowledge card, L1 is
  TL;DR/Contribution/Method/Takeaways, L2 is close reading, and L3 adds code analysis.
- Keep \`Insight\` paper-grounded. User ideas belong in \`notes.md\`.
- Use inline \`[page N]\` anchors. The plugin derives the evidence index.
- In Results/Insight, use only \`[claimed by paper]\` and \`[verified]\` trust labels.
- Preserve outdated conclusions as \`[superseded by [[KEY]]]\` instead of deleting them.
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
  setPref(CODEX_VAULT_PATH_PREF, normalizeVaultPath(path, getHomeDir()));
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
    notesPath: paths.notesPath,
    recordPath: paths.recordPath,
    codeDir: paths.codeDir,
    codeNotesPath: paths.codeNotesPath,
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

export async function readPaperNotes(itemKey: string): Promise<string> {
  const paths = await getPaperVaultPaths(itemKey);
  return readTextIfExists(paths.notesPath);
}

export async function readPaperCodeNotes(itemKey: string): Promise<string> {
  const paths = await getPaperVaultPaths(itemKey);
  return readTextIfExists(paths.codeNotesPath);
}

export async function appendPaperNote(options: {
  itemKey: string;
  content: string;
  author?: "user" | "agent, user-confirmed";
  date?: string;
  section?: "Reading Context" | "Actions" | "Thoughts and Critique";
  actionId?: string;
  commit?: boolean;
}): Promise<boolean> {
  const paths = await getPaperVaultPaths(options.itemKey);
  const existing =
    (await readTextIfExists(paths.notesPath)).trimEnd() ||
    buildInitialNotesMarkdown({
      itemKey: options.itemKey,
      title: options.itemKey,
    }).trimEnd();
  const updated = insertPaperNoteEntry(existing, {
    section: options.section || "Thoughts and Critique",
    date: options.date || new Date().toISOString().slice(0, 10),
    author: options.author || "user",
    content: options.content,
    actionId: options.actionId,
  });
  await getIOUtils().writeUTF8(paths.notesPath, updated);
  if (options.commit === false) return false;
  return commitVaultChanges(`note: ${options.itemKey}`);
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
  options: { commit?: boolean } = {},
): Promise<boolean> {
  const changed = await updatePaperSignals(paper, { rating });
  if (!changed) return false;
  await updateReadme({ ...paper, rating });
  if (options.commit !== false) {
    await commitVaultChanges(`rating: ${paper.itemKey}`);
  }
  return true;
}

export async function updatePaperValueTypes(
  paper: PaperVaultMeta,
  valueTypes: PaperValueType[],
): Promise<void> {
  const changed = await updatePaperSignals(paper, { valueTypes });
  if (!changed) return;
  await commitVaultChanges(`value-types: ${paper.itemKey}`);
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
  const codeNotes = await readTextIfExists(paths.codeNotesPath);
  const existing = await readExistingProjection(paths.recordPath);
  const generatedAt = new Date().toISOString();
  const evaluated = evaluateKnowledgeSurface({
    after: memoryMarkdown,
    sourceAbstract: meta.abstract,
    itemKey: meta.itemKey,
    checkedAt: generatedAt,
    codeNotes,
  });
  const qualityReport = mergeProjectionQuality(quality, evaluated);
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

function mergeProjectionQuality(
  supplied: KnowledgeQualityReport | undefined,
  evaluated: KnowledgeQualityReport,
): KnowledgeQualityReport {
  if (!supplied) return evaluated;
  const l3Failures = evaluated.hardFailures.filter((failure) =>
    failure.startsWith("L3 requires"),
  );
  if (!l3Failures.length) return supplied;
  const hardFailures = Array.from(
    new Set([...supplied.hardFailures, ...l3Failures]),
  );
  return {
    ...supplied,
    status: "failed",
    hardFailures,
  };
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
    const signals = parseKnowledgeSurface(memory).signals;
    paper.rating = signals.rating;
    paper.tier = signals.tier;
    paper.valueTypes = signals.valueTypes;
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
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return [];
  const papers = await listVaultPapers();
  const hits: VaultSearchHit[] = [];
  const scores = new Map<string, number>();
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
    if (matches.length) {
      hits.push({ itemKey: paper.itemKey, title: paper.title, matches });
      scores.set(paper.itemKey, scorePaperForQuery(paper, query));
    }
  }
  return hits.sort(
    (a, b) =>
      Number(scores.get(b.itemKey) || 0) - Number(scores.get(a.itemKey) || 0) ||
      a.title.localeCompare(b.title),
  );
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
  const parts = String(path || "")
    .split(/[\\/]/)
    .filter(Boolean);
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
  tier?: PaperRecordProjection["tier"];
  valueTypes?: PaperRecordProjection["valueTypes"];
  evidenceAnchors?: PaperRecordProjection["evidenceAnchors"];
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
    tier?: PaperRecordProjection["tier"];
    valueTypes?: PaperRecordProjection["valueTypes"];
    evidenceAnchors?: PaperRecordProjection["evidenceAnchors"];
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
    tier: PaperRecordProjection["tier"];
    valueTypes: PaperRecordProjection["valueTypes"];
    evidenceAnchors: PaperRecordProjection["evidenceAnchors"];
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
    String(existing.tier || "") === String(next.tier || "") &&
    JSON.stringify(existing.valueTypes || []) ===
      JSON.stringify(next.valueTypes || []) &&
    JSON.stringify(existing.evidenceAnchors || []) ===
      JSON.stringify(next.evidenceAnchors || []) &&
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
  await ensureVaultWorkflowSkills();
  await untrackIgnoredVaultArtifacts(paths.vaultDir);
  await writeIfMissing(
    joinPath(paths.paperDir, "memory.md"),
    initialMemoryMarkdown(options),
  );
  const migrationChanged = await migrateVaultKnowledgeFiles(options);
  const manifestChanged = await ensureVaultManifest(paths.vaultDir);
  const migrationCommitted = await isCurrentVaultManifestCommitted(
    paths.vaultDir,
  );
  if (migrationChanged || manifestChanged || !migrationCommitted) {
    const committed = await commitVaultChanges("migrate: knowledge surface v2");
    if (!committed) {
      throw new Error(
        "Vault migration completed on disk but could not be committed to git.",
      );
    }
  }
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

export async function ensureVaultWorkflowSkills(): Promise<void> {
  const vaultDir = await getVaultDir();
  await ensureDirectory(vaultDir);
  await ensureRootAgents(joinPath(vaultDir, "AGENTS.md"));
  await ensureGitRepo(vaultDir);
  await validateVaultManifest(vaultDir);
  await ensureGitignore(vaultDir);
  const skillsChanged = await ensureWorkflowSkillFiles(vaultDir);
  const manifestChanged = await ensureVaultManifest(vaultDir);
  const manifestCommitted = await isCurrentVaultManifestCommitted(vaultDir);
  if (skillsChanged || manifestChanged || !manifestCommitted) {
    const receipt = await commitVaultPaths(
      `migrate: workflow skills v${WORKFLOW_SKILL_VERSION}`,
      [
        "AGENTS.md",
        ".gitignore",
        "vault.json",
        ...Object.keys(getWorkflowSkillFiles()),
      ],
    );
    if (!receipt) {
      throw new Error(
        "Vault workflow skill migration completed on disk but could not be committed to git.",
      );
    }
  }
}

async function isCurrentVaultManifestCommitted(
  vaultDir: string,
): Promise<boolean> {
  const result = await runGit(
    vaultDir,
    ["show", "HEAD:vault.json"],
    30000,
    true,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) return false;
  try {
    return isCurrentVaultManifest(JSON.parse(result.stdout));
  } catch {
    return false;
  }
}

async function migrateVaultKnowledgeFiles(
  currentPaper: PaperVaultMeta,
): Promise<boolean> {
  const vaultDir = await getVaultDir();
  const readme = await readTextIfExists(joinPath(vaultDir, "README.md"));
  const metadata = new Map(
    parseReadmePaperRows(readme).map((paper) => [paper.itemKey, paper]),
  );
  metadata.set(currentPaper.itemKey, currentPaper);
  const keys = new Set(await listPaperDirs(vaultDir));
  keys.add(currentPaper.itemKey);
  let changed = false;
  for (const itemKey of keys) {
    const paths = await getPaperVaultPaths(itemKey);
    const memoryBefore = await readTextIfExists(paths.memoryPath);
    if (!memoryBefore.trim()) continue;
    const paper =
      metadata.get(itemKey) || inferPaperMeta(itemKey, memoryBefore);
    if (await migratePaperKnowledgeFiles(paper, paths)) changed = true;
    const recordBefore = await readTextIfExists(paths.recordPath);
    await refreshPaperRecordProjection(paper);
    const recordAfter = await readTextIfExists(paths.recordPath);
    if (recordAfter !== recordBefore) changed = true;
  }
  return changed;
}

async function migratePaperKnowledgeFiles(
  meta: PaperVaultMeta,
  paths: PaperVaultPaths,
): Promise<boolean> {
  const memory = await readTextIfExists(paths.memoryPath);
  const notes = await readTextIfExists(paths.notesPath);
  const migrated = migrateKnowledgeSurfaceV2({
    markdown: memory || initialMemoryMarkdown(meta),
    meta,
    migratedAt: new Date().toISOString().slice(0, 10),
    existingNotes: notes,
  });
  const refreshedMemory = refreshKnowledgeSurfacePluginBlock(
    migrated.memoryMarkdown,
    meta,
  );
  let changed = false;
  if (refreshedMemory !== memory) {
    await getIOUtils().writeUTF8(
      paths.memoryPath,
      refreshedMemory.endsWith("\n") ? refreshedMemory : `${refreshedMemory}\n`,
    );
    changed = true;
  }
  if (migrated.notesMarkdown !== notes) {
    await getIOUtils().writeUTF8(
      paths.notesPath,
      migrated.notesMarkdown.endsWith("\n")
        ? migrated.notesMarkdown
        : `${migrated.notesMarkdown}\n`,
    );
    changed = true;
  }
  return changed;
}

function inferPaperMeta(itemKey: string, memory: string): PaperVaultMeta {
  const parsed = parseKnowledgeSurface(memory);
  const heading = /^#\s+(.+?)\s*$/m.exec(parsed.body);
  return {
    itemId: 0,
    itemKey,
    title: String(heading?.[1] || itemKey).trim(),
  };
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

async function readTextMeta(
  metaPath: string,
  fallbackText: string,
): Promise<TextMeta> {
  const raw = await readTextIfExists(metaPath);
  if (!raw.trim()) {
    return normalizeTextMeta(null, fallbackText, new Date().toISOString());
  }
  try {
    return normalizeTextMeta(
      JSON.parse(raw),
      fallbackText,
      new Date().toISOString(),
    );
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
    const filePath = joinPath(
      logsDir,
      `${new Date().toISOString().slice(0, 10)}.log`,
    );
    const block = [
      `## ${new Date().toISOString()} · ${kind}`,
      "",
      message,
      details
        ? `\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``
        : "",
      "",
    ].join("\n");
    const existing = (await readTextIfExists(filePath)).trimEnd();
    await getIOUtils().writeUTF8(
      filePath,
      existing ? `${existing}\n\n${block}` : block,
    );
  } catch (error) {
    ztoolkit.log("[Codex Vault] Failed to write vault log:", error);
  }
}

export async function commitVaultChanges(message: string): Promise<boolean> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  await runGit(vaultDir, ["add", "-A"]);
  const diff = await runGit(
    vaultDir,
    ["diff", "--cached", "--quiet"],
    30000,
    true,
  );
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

export async function commitVaultPaths(
  message: string,
  paths: string[],
  expectedParentSha = "",
  requireAllPaths = false,
): Promise<{
  commitSha: string;
  parentSha: string;
  changedPaths: string[];
} | null> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const scopedPaths = normalizeVaultCommitPaths(paths);
  if (!scopedPaths.length) {
    throw new Error("A path-scoped Vault commit requires at least one path.");
  }
  const stagedBefore = await runGit(
    vaultDir,
    ["diff", "--cached", "--quiet"],
    30000,
    true,
  );
  if (stagedBefore.exitCode !== 0) {
    throw new Error("Vault has staged changes.");
  }
  const parent = await runGit(vaultDir, ["rev-parse", "HEAD"], 30000, true);
  const parentSha = parent.exitCode === 0 ? parent.stdout.trim() : "";
  if (expectedParentSha && parentSha !== expectedParentSha) {
    throw new Error("Vault has newer updates.");
  }
  await runGit(vaultDir, ["add", "--", ...scopedPaths]);
  const diff = await runGit(
    vaultDir,
    ["diff", "--cached", "--quiet", "--", ...scopedPaths],
    30000,
    true,
  );
  if (diff.exitCode === 0) {
    return null;
  }
  const stagedPathsResult = await runGit(vaultDir, [
    "diff",
    "--cached",
    "--name-only",
    "--",
    ...scopedPaths,
  ]);
  const stagedPaths = stagedPathsResult.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
    .sort();
  const expectedPaths = [...scopedPaths].sort();
  if (
    requireAllPaths &&
    JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)
  ) {
    await runGit(vaultDir, ["reset", "--", ...scopedPaths], 30000, true);
    throw new Error("Not every action-owned Vault path changed.");
  }
  const tree = await runGit(vaultDir, ["write-tree"]);
  const commitArgs = [
    "-c",
    "user.name=zotero-agent",
    "-c",
    "user.email=agent@local",
    "commit-tree",
    tree.stdout.trim(),
    ...(parentSha ? ["-p", parentSha] : []),
    "-m",
    message,
  ];
  const commit = await runGit(vaultDir, commitArgs, 120000, true);
  if (commit.exitCode !== 0) {
    await runGit(vaultDir, ["reset", "--", ...scopedPaths], 30000, true);
    throw new Error(
      commit.stderr || commit.stdout || "Path-scoped Vault commit failed.",
    );
  }
  const commitSha = commit.stdout.trim();
  const updateRef = await runGit(
    vaultDir,
    [
      "update-ref",
      "HEAD",
      commitSha,
      parentSha || "0000000000000000000000000000000000000000",
    ],
    30000,
    true,
  );
  if (updateRef.exitCode !== 0) {
    await runGit(vaultDir, ["reset", "--", ...scopedPaths], 30000, true);
    throw new Error("Vault has newer updates.");
  }
  const changed = await runGit(vaultDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-only",
    "-r",
    commitSha,
  ]);
  const receipt = {
    commitSha,
    parentSha,
    changedPaths: changed.stdout
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean),
  };
  const actualPaths = [...receipt.changedPaths].sort();
  if (actualPaths.some((path) => !expectedPaths.includes(path))) {
    throw new Error("Vault action commit paths do not match.");
  }
  return receipt;
}

export async function assertVaultPathsClean(paths: string[]): Promise<void> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const scopedPaths = normalizeVaultCommitPaths(paths);
  const status = await runGit(
    vaultDir,
    ["status", "--porcelain", "--untracked-files=all", "--", ...scopedPaths],
    30000,
    true,
  );
  if (status.exitCode !== 0) {
    throw new Error(status.stderr || status.stdout || "git status failed.");
  }
  if (status.stdout.trim()) {
    throw new Error(
      "Vault target has uncommitted changes. Commit or discard them before retrying this action.",
    );
  }
}

export function normalizeVaultCommitPaths(paths: string[]): string[] {
  const normalized = new Set<string>();
  for (const value of paths) {
    const path = String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
    const segments = path.split("/");
    if (
      !path ||
      path === "." ||
      path.startsWith("/") ||
      path.startsWith(":") ||
      path === ".." ||
      path.startsWith("../") ||
      path.includes("/../") ||
      !/^[a-zA-Z0-9._/-]+$/.test(path) ||
      segments.some(
        (segment) => segment === "." || segment === ".." || segment === ".git",
      )
    ) {
      throw new Error(`Invalid Vault commit path: ${value}`);
    }
    normalized.add(path);
  }
  return [...normalized];
}

export function canUndoVaultAction(
  headSha: string,
  actionCommitSha: string,
): { allowed: true } | { allowed: false; reason: string } {
  return headSha === actionCommitSha
    ? { allowed: true }
    : { allowed: false, reason: "Vault has newer updates." };
}

export async function getVaultHeadSha(): Promise<string> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const result = await runGit(vaultDir, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}

export async function verifyVaultCommitReceipt(receipt: {
  commitSha: string;
  parentSha: string;
  changedPaths: string[];
}): Promise<void> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(receipt.commitSha) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(receipt.parentSha)
  ) {
    throw new Error("Invalid Vault commit receipt.");
  }
  const parent = await runGit(
    vaultDir,
    ["rev-parse", `${receipt.commitSha}^`],
    30000,
    true,
  );
  if (parent.exitCode !== 0 || parent.stdout.trim() !== receipt.parentSha) {
    throw new Error("Vault action commit parent does not match.");
  }
  const changed = await runGit(vaultDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-only",
    "-r",
    receipt.commitSha,
  ]);
  const expectedPaths = normalizeVaultCommitPaths(receipt.changedPaths).sort();
  const actualPaths = changed.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
    .sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Vault action commit paths do not match.");
  }
}

export async function revertVaultCommit(
  actionCommitSha: string,
  changedPaths: string[] = [],
  expectedParentSha = "",
): Promise<{
  commitSha: string;
  parentSha: string;
  changedPaths: string[];
}> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const head = await getVaultHeadSha();
  const allowed = canUndoVaultAction(head, actionCommitSha);
  if (!allowed.allowed) throw new Error(allowed.reason);
  const existingRevert = await runGit(
    vaultDir,
    ["rev-parse", "-q", "--verify", "REVERT_HEAD"],
    30000,
    true,
  );
  if (existingRevert.exitCode === 0) {
    throw new Error("Vault has an unfinished revert.");
  }
  const expectedPaths = normalizeVaultCommitPaths(changedPaths).sort();
  await verifyVaultCommitReceipt({
    commitSha: actionCommitSha,
    parentSha: expectedParentSha,
    changedPaths: expectedPaths,
  });
  if (expectedPaths.length) {
    await assertVaultPathsClean(expectedPaths);
  }
  const stagedBefore = await runGit(
    vaultDir,
    ["diff", "--cached", "--quiet"],
    30000,
    true,
  );
  if (stagedBefore.exitCode !== 0) {
    throw new Error("Vault has staged changes.");
  }
  const revert = await runGit(
    vaultDir,
    ["revert", "--no-commit", actionCommitSha],
    120000,
    true,
  );
  if (revert.exitCode !== 0) {
    const revertHead = await runGit(
      vaultDir,
      ["rev-parse", "-q", "--verify", "REVERT_HEAD"],
      30000,
      true,
    );
    if (revertHead.exitCode === 0) {
      await runGit(vaultDir, ["revert", "--quit"], 30000, true);
    }
    await restoreVaultPathsFromHead(expectedPaths);
    throw new Error(revert.stderr || revert.stdout || "Vault revert failed.");
  }
  const tree = await runGit(vaultDir, ["write-tree"]);
  const commit = await runGit(
    vaultDir,
    [
      "-c",
      "user.name=zotero-agent",
      "-c",
      "user.email=agent@local",
      "commit-tree",
      tree.stdout.trim(),
      "-p",
      actionCommitSha,
      "-m",
      `Revert ${actionCommitSha}`,
    ],
    120000,
    true,
  );
  if (commit.exitCode !== 0) {
    await runGit(vaultDir, ["revert", "--quit"], 30000, true);
    await restoreVaultPathsFromHead(expectedPaths);
    throw new Error(commit.stderr || "Could not create Vault revert commit.");
  }
  const commitSha = commit.stdout.trim();
  const updateRef = await runGit(
    vaultDir,
    ["update-ref", "HEAD", commitSha, actionCommitSha],
    30000,
    true,
  );
  if (updateRef.exitCode !== 0) {
    await runGit(vaultDir, ["revert", "--quit"], 30000, true);
    await restoreVaultPathsFromHead(expectedPaths);
    throw new Error("Vault has newer updates.");
  }
  await runGit(vaultDir, ["revert", "--quit"], 30000, true);
  const changed = await runGit(vaultDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-only",
    "-r",
    commitSha,
  ]);
  return {
    commitSha,
    parentSha: head,
    changedPaths: changed.stdout
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean),
  };
}

export async function listPaperReproductionArtifactPaths(
  itemKey: string,
): Promise<string[]> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const prefix = safePathSegment(itemKey);
  const result = await runGit(
    vaultDir,
    ["ls-files", "--", `${prefix}/code-notes.md`, `${prefix}/experiments`],
    30000,
    true,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Could not list L3 artifacts.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
}

export async function removeVaultPaths(paths: string[]): Promise<void> {
  const vaultDir = await getVaultDir();
  for (const relativePath of normalizeVaultCommitPaths(paths)) {
    await getIOUtils().remove(joinPath(vaultDir, ...relativePath.split("/")), {
      ignoreAbsent: true,
    });
  }
}

export type VaultTextFileSnapshot = {
  relativePath: string;
  existed: boolean;
  content: string;
};

export async function captureVaultTextFiles(
  paths: string[],
): Promise<VaultTextFileSnapshot[]> {
  const vaultDir = await getVaultDir();
  const normalized = normalizeVaultCommitPaths(paths);
  const snapshots: VaultTextFileSnapshot[] = [];
  for (const relativePath of normalized) {
    const path = joinPath(vaultDir, ...relativePath.split("/"));
    const existed = await safeExists(path);
    snapshots.push({
      relativePath,
      existed,
      content: existed ? await readTextIfExists(path) : "",
    });
  }
  return snapshots;
}

export async function restoreVaultTextFiles(
  snapshots: VaultTextFileSnapshot[],
): Promise<void> {
  const vaultDir = await getVaultDir();
  const paths = normalizeVaultCommitPaths(
    snapshots.map((snapshot) => snapshot.relativePath),
  );
  for (const snapshot of snapshots) {
    const path = joinPath(vaultDir, ...snapshot.relativePath.split("/"));
    if (snapshot.existed) {
      await ensureDirectory(path.slice(0, path.lastIndexOf("/")));
      await getIOUtils().writeUTF8(path, snapshot.content);
    } else {
      await getIOUtils().remove(path, { ignoreAbsent: true });
    }
  }
  await runGit(vaultDir, ["reset", "--", ...paths], 30000, true);
}

export async function restoreVaultPathsFromHead(
  paths: string[],
): Promise<void> {
  const vaultDir = await getVaultDir();
  await ensureGitRepo(vaultDir);
  const normalized = normalizeVaultCommitPaths(paths);
  const trackedResult = await runGit(
    vaultDir,
    ["ls-tree", "-r", "--name-only", "HEAD", "--", ...normalized],
    30000,
    true,
  );
  if (trackedResult.exitCode !== 0) {
    throw new Error(trackedResult.stderr || "Could not inspect Vault HEAD.");
  }
  const tracked = trackedResult.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
  if (tracked.length) {
    await runGit(vaultDir, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ...tracked,
    ]);
  }
  const trackedSet = new Set(tracked);
  for (const relativePath of normalized) {
    if (trackedSet.has(relativePath)) continue;
    await getIOUtils().remove(joinPath(vaultDir, ...relativePath.split("/")), {
      ignoreAbsent: true,
    });
  }
  await runGit(vaultDir, ["reset", "--", ...normalized], 30000, true);
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
  const memory = await readPaperMemory(meta.itemKey);
  const rating = parseKnowledgeSurface(memory).signals.rating;
  const entries = mergeReadmeEntries(existing, { ...meta, rating });
  const table = buildReadmeTable(entries);
  const base = existing.trim()
    ? replaceMarkedBlock(existing, markerStart, markerEnd, table)
    : `# My Papers\n\n${table}`;
  await getIOUtils().writeUTF8(
    readmePath,
    base.endsWith("\n") ? base : `${base}\n`,
  );
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

async function ensureWorkflowSkillFiles(vaultDir: string): Promise<boolean> {
  let changed = false;
  for (const [relativePath, content] of Object.entries(
    getWorkflowSkillFiles(),
  )) {
    const path = joinPath(vaultDir, ...relativePath.split("/"));
    await ensureDirectory(path.slice(0, path.lastIndexOf("/")));
    const existing = await readTextIfExists(path);
    const normalized = content.endsWith("\n") ? content : `${content}\n`;
    if (existing === normalized) continue;
    await getIOUtils().writeUTF8(path, normalized);
    changed = true;
  }
  return changed;
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

async function validateVaultManifest(vaultDir: string): Promise<void> {
  const raw = await readTextIfExists(joinPath(vaultDir, "vault.json"));
  let parsed: unknown = null;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  normalizeVaultManifest(parsed);
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
    throw new Error(
      result.stderr || result.stdout || `git ${args.join(" ")} failed`,
    );
  }
  return result;
}

async function resolveGitBinary(): Promise<string> {
  for (const candidate of [
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
  ]) {
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
  if (!ioUtils)
    throw new Error("IOUtils is not available in this Zotero environment.");
  return ioUtils;
}

function getHomeDir(): string {
  const envHome = String(
    (globalThis as any).Services?.env?.get?.("HOME") || "",
  );
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
