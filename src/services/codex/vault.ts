import { getFullText } from "../../modules/pdf-context";
import { getPref, setPref } from "../../utils/prefs";
import { buildPageCacheData, loadPageCache, savePageCache } from "../page-cache";
import { getPdfDocumentFromReader, parseAllPages } from "../pdf-parser";
import { runLineProcess } from "./subprocess";
import {
  appendMarkdownBlock,
  buildConversationTurnMarkdown,
  buildPaperVaultPaths,
  buildReadmeTable,
  formatPagesForVault,
  initialMemoryMarkdown,
  joinPathParts,
  mergeReadmeEntries,
  normalizeVaultPath,
  parseReadmePaperRows,
  replaceMarkedBlock,
  safePathSegment,
  type PaperVaultMeta,
} from "./vault-format";

export type { PaperVaultMeta } from "./vault-format";

export type EnsurePaperVaultOptions = PaperVaultMeta & {
  pdfItemId: number;
  reader?: _ZoteroTypes.ReaderInstance | null;
  forceTextRefresh?: boolean;
  onStatus?: (text: string) => void;
};

export type PaperVaultPaths = {
  vaultDir: string;
  paperDir: string;
  textPath: string;
  memoryPath: string;
  conversationsDir: string;
};

export const CODEX_VAULT_PATH_PREF = "codex.vaultPath";

const ROOT_AGENTS_MD = `# Knowledge Vault — Operating Rules

This is a researcher's cross-paper knowledge base. Each subdirectory named by a
Zotero item key (for example \`PXW99EKT/\`) holds one paper.

## Files per paper
- \`text.txt\` — extracted PDF full text. READ-ONLY, never edit.
- \`memory.md\` — durable, distilled knowledge about the paper. READ before answering; UPDATE after.
- \`conversations/*.md\` — human transcript logs. DO NOT read or edit; the plugin manages them.

## The paper currently in focus is given to you in each prompt.

## How to answer
1. Read the in-focus paper's \`memory.md\` first; create it from \`text.txt\` if missing.
2. Use \`text.txt\` for detail the memory does not cover.
3. For cross-paper questions, search across all \`*/memory.md\` files first, then \`*/text.txt\` if needed.

## How to update memory (\`memory.md\`) — the ONLY durable memory
- Update ONLY when you learned something materially new this turn.
- REWRITE and DEDUPE. Never blindly append. Keep it tight and factual.
- Keep these default sections, adapting only when the paper type needs it:
  \`# Title (Authors, Year)\`, \`## TL;DR\`, \`## Key contributions\`, \`## Method\`,
  \`## Results\`, \`## My understanding / open questions\`, \`## Cross-references\`.
- Link related papers with RELATIVE links: \`[Paper title](../OTHERKEY/memory.md)\`.
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
    memoryPath: paths.memoryPath,
    conversationsDir: paths.conversationsDir,
  };
}

export type VaultSearchHit = {
  itemKey: string;
  title: string;
  matches: { line: number; text: string }[];
};

export async function readPaperMemory(itemKey: string): Promise<string> {
  const paths = await getPaperVaultPaths(itemKey);
  return readTextIfExists(paths.memoryPath);
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

export async function ensurePaperVault(
  options: EnsurePaperVaultOptions,
): Promise<PaperVaultPaths> {
  const paths = await getPaperVaultPaths(options.itemKey);
  const ioUtils = getIOUtils();
  options.onStatus?.("Preparing Knowledge Vault...");
  await ensureDirectory(paths.vaultDir);
  await ensureDirectory(paths.paperDir);
  await ensureDirectory(paths.conversationsDir);
  await writeIfMissing(joinPath(paths.vaultDir, "AGENTS.md"), ROOT_AGENTS_MD);
  await writeIfMissing(
    joinPath(paths.paperDir, "memory.md"),
    initialMemoryMarkdown(options),
  );
  await ensureGitRepo(paths.vaultDir);
  await ensureGitignore(paths.vaultDir);

  const textExists = ioUtils && (await safeExists(paths.textPath));
  if (options.forceTextRefresh || !textExists) {
    options.onStatus?.("Extracting paper text...");
    const text = await buildTextForPaper(options);
    if (!text.trim()) {
      throw new Error(
        "PDF attachment found, but full text could not be extracted. Please verify the PDF has a text layer or has been indexed.",
      );
    }
    await getIOUtils().writeUTF8(paths.textPath, text);
  }

  await updateReadme(options);
  return paths;
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

async function buildTextForPaper(
  options: EnsurePaperVaultOptions,
): Promise<string> {
  const cached = await loadPageCache(options.itemKey);
  if (cached?.pages?.length) {
    const cachedText = formatPagesForVault(cached.pages);
    if (cachedText.trim()) return cachedText;
    ztoolkit.log(`[Codex Vault] Ignoring empty page cache for ${options.itemKey}`);
    await appendVaultLog("pdf-text-empty-cache", `Ignoring empty page cache for ${options.itemKey}`, {
      itemKey: options.itemKey,
      pdfItemId: options.pdfItemId,
    });
  }

  const pdfDocument = getPdfDocumentFromReader(options.reader) ||
    getPdfDocumentFromAnyReader(options.pdfItemId);
  if (pdfDocument) {
    const pages = await parseAllPages(pdfDocument);
    const parsedText = formatPagesForVault(pages);
    if (parsedText.trim()) {
      await savePageCache(options.itemKey, buildPageCacheData(pages));
      return parsedText;
    }
    ztoolkit.log(
      `[Codex Vault] PDF.js parse returned no text for ${options.itemKey} (${pages.length} pages)`,
    );
    await appendVaultLog(
      "pdf-text-empty-pdfjs",
      `PDF.js parse returned no text for ${options.itemKey}`,
      { itemKey: options.itemKey, pdfItemId: options.pdfItemId, pages: pages.length },
    );
  } else {
    ztoolkit.log(
      `[Codex Vault] No PDF.js document found for ${options.itemKey}, pdfItemId=${options.pdfItemId}`,
    );
    await appendVaultLog(
      "pdf-text-no-pdfjs-document",
      `No PDF.js document found for ${options.itemKey}`,
      { itemKey: options.itemKey, pdfItemId: options.pdfItemId },
    );
  }

  if (options.pdfItemId > 0) {
    const fullText = await getFullText(options.pdfItemId);
    const workerText = String(fullText || "").trim();
    if (workerText) return workerText;
    ztoolkit.log(
      `[Codex Vault] PDFWorker returned no text for ${options.itemKey}, pdfItemId=${options.pdfItemId}`,
    );
    await appendVaultLog(
      "pdf-text-empty-pdfworker",
      `PDFWorker returned no text for ${options.itemKey}`,
      { itemKey: options.itemKey, pdfItemId: options.pdfItemId },
    );
  }
  return "";
}

function getPdfDocumentFromAnyReader(pdfItemId: number): any | null {
  for (const reader of getCandidateReaders()) {
    const readerItemId = Number((reader as any)?.itemID || (reader as any)?._item?.id || 0);
    if (pdfItemId > 0 && readerItemId > 0 && readerItemId !== pdfItemId) continue;
    const doc = getPdfDocumentFromReader(reader as _ZoteroTypes.ReaderInstance);
    if (doc) return doc;
  }
  return null;
}

function getCandidateReaders(): any[] {
  const candidates: any[] = [];
  try {
    const tabId =
      (typeof Zotero_Tabs !== "undefined" ? (Zotero_Tabs as any).selectedID : "") ||
      (Zotero as any).getActiveZoteroPane?.()?.getSelectedTabID?.() ||
      "";
    if (tabId) {
      const active = Zotero.Reader?.getByTabID?.(tabId);
      if (active) candidates.push(active);
    }
  } catch {
    // Ignore.
  }
  try {
    const readers = (Zotero.Reader as any)?._readers;
    if (Array.isArray(readers)) candidates.push(...readers);
  } catch {
    // Ignore.
  }
  return candidates;
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
  await writeIfMissing(joinPath(vaultDir, ".gitignore"), "*/code/\n");
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
