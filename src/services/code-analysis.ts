import {
  commitVaultChanges,
  ensurePaperVault,
  readPaperMemory,
  refreshPaperRecordProjection,
  updatePaperSignals,
  writePaperMemory,
  type PaperVaultMeta,
} from "./codex/vault";
import { runCodexTurn, type CodexTurnInput } from "./codex/runner";
import {
  runLineProcess,
  type LineProcessResult,
  type RunningLineProcess,
} from "./codex/subprocess";
import type { CodexReasoningEffort } from "./codex/context-window";
import {
  parseKnowledgeSurface,
  restoreKnowledgeSurfaceOwnership,
  updateKnowledgeSurfaceSignals,
} from "./knowledge-surface";
import { buildTierTransitionPrompt } from "./knowledge-workflows";
import { evaluateKnowledgeSurface } from "./knowledge-quality";

export type GitHubRepository = {
  url: string;
  owner: string;
  repository: string;
};

export const CODE_PROVENANCE_START = "<!-- zotero-agent:code:start -->";
export const CODE_PROVENANCE_END = "<!-- zotero-agent:code:end -->";

export function normalizeGitHubRepositoryUrl(input: string): GitHubRepository {
  const raw = String(input || "").trim();
  let path = "";
  if (/^git@github\.com:/i.test(raw)) {
    path = raw.replace(/^git@github\.com:/i, "");
  } else {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Enter a valid GitHub repository URL.");
    }
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new Error(
        "Only GitHub repository URLs are supported in this version.",
      );
    }
    path = url.pathname.replace(/^\/+/, "");
  }
  const parts = path
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("The GitHub URL must identify one owner/repository.");
  }
  const [owner, repository] = parts;
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(owner) ||
    !/^[a-zA-Z0-9_.-]+$/.test(repository)
  ) {
    throw new Error("The GitHub repository owner or name is invalid.");
  }
  return {
    url: `https://github.com/${owner}/${repository}.git`,
    owner,
    repository,
  };
}

export function buildCodeNotesMarkdown(options: {
  itemKey: string;
  title: string;
  repositoryUrl: string;
  branch: string;
  commit: string;
  generatedAt: string;
}): string {
  return [
    `# Code Notes: ${options.title || options.itemKey}`,
    "",
    CODE_PROVENANCE_START,
    `**Repository:** ${options.repositoryUrl}`,
    `**Branch:** \`${options.branch || "unknown"}\``,
    `**Commit:** \`${options.commit}\``,
    `**Fetched:** ${options.generatedAt}`,
    CODE_PROVENANCE_END,
    "",
    "## Paper-to-Code Map",
    "",
    "## Architecture",
    "",
    "## Paper vs. Implementation",
    "",
    "## Reproduction Entry Points",
    "",
    "## Risks and Open Questions",
    "",
  ].join("\n");
}

export function buildCodeAnalysisPrompt(options: {
  itemKey: string;
  repositoryUrl: string;
  commit: string;
}): string {
  return `Analyze the source repository associated with paper ${options.itemKey}.

Repository: ${options.repositoryUrl}
Pinned commit: ${options.commit}

Read ${options.itemKey}/memory.md and ${options.itemKey}/text.txt first.
Then inspect ${options.itemKey}/code/ only as needed.
Rewrite the interpretation sections of ${options.itemKey}/code-notes.md with:
- a paper-to-code map;
- the implementation architecture and important entry points;
- differences between paper claims and the checked-out implementation;
- reproduction commands or configuration pointers that are directly supported by the repository;
- risks, missing assets, and open questions.

Preserve the plugin-owned provenance block in code-notes.md exactly.
Do not modify any file under ${options.itemKey}/code/.
Do not edit memory.md, notes.md, record.json, or conversation logs.
Return a concise confirmation after code-notes.md is updated.`;
}

export type AnalyzePaperCodeRequest = {
  paper: PaperVaultMeta;
  pdfItemId: number;
  repositoryUrl: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
};

export type AnalyzePaperCodeEvents = {
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
};

type AnalyzePaperCodeDeps = {
  ensurePaperVault: typeof ensurePaperVault;
  runGit: (
    cwd: string,
    args: string[],
    allowNonZero?: boolean,
  ) => Promise<LineProcessResult>;
  runCodexTurn: typeof runCodexTurn;
  readPaperMemory: typeof readPaperMemory;
  writePaperMemory: typeof writePaperMemory;
  updatePaperSignals: typeof updatePaperSignals;
  refreshPaperRecordProjection: typeof refreshPaperRecordProjection;
  commitVaultChanges: typeof commitVaultChanges;
  pathExists: (path: string) => Promise<boolean>;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
  removeText: (path: string) => Promise<void>;
};

const defaultDeps: AnalyzePaperCodeDeps = {
  ensurePaperVault,
  runGit: runGitCommand,
  runCodexTurn,
  readPaperMemory,
  writePaperMemory,
  updatePaperSignals,
  refreshPaperRecordProjection,
  commitVaultChanges,
  pathExists,
  readText,
  writeText,
  removeText,
};

export async function analyzePaperCode(
  request: AnalyzePaperCodeRequest,
  events: AnalyzePaperCodeEvents = {},
  depsOverride: Partial<AnalyzePaperCodeDeps> = {},
): Promise<{
  repository: GitHubRepository;
  branch: string;
  commit: string;
  repositoryModified: boolean;
  committed: boolean;
}> {
  const deps = { ...defaultDeps, ...depsOverride };
  const repository = normalizeGitHubRepositoryUrl(request.repositoryUrl);
  const paths = await deps.ensurePaperVault({
    ...request.paper,
    pdfItemId: request.pdfItemId,
    onStatus: events.onStatus,
  });
  events.onStatus?.("Preparing source repository...");
  const checkoutExists = await deps.pathExists(joinPath(paths.codeDir, ".git"));
  if (checkoutExists) {
    const dirty = await deps.runGit(paths.codeDir, ["status", "--porcelain"]);
    if (dirty.stdout.trim()) {
      throw new Error(
        "The local code checkout has changes. Resolve them before updating or analyzing it.",
      );
    }
    const remote = await deps.runGit(paths.codeDir, [
      "remote",
      "get-url",
      "origin",
    ]);
    const currentRemote = normalizeGitHubRepositoryUrl(remote.stdout.trim());
    if (currentRemote.url !== repository.url) {
      throw new Error(
        `This paper is already linked to ${currentRemote.url}. Remove the local checkout before changing repositories.`,
      );
    }
    await deps.runGit(paths.codeDir, ["pull", "--ff-only"]);
  } else {
    await deps.runGit(paths.paperDir, [
      "clone",
      "--depth",
      "1",
      repository.url,
      "code",
    ]);
  }
  const commit = (
    await deps.runGit(paths.codeDir, ["rev-parse", "HEAD"])
  ).stdout.trim();
  const branch = (
    await deps.runGit(paths.codeDir, ["rev-parse", "--abbrev-ref", "HEAD"])
  ).stdout.trim();
  const generatedAt = new Date().toISOString();
  const provenance = buildCodeNotesMarkdown({
    itemKey: request.paper.itemKey,
    title: request.paper.title,
    repositoryUrl: repository.url,
    branch,
    commit,
    generatedAt,
  });
  const existingNotes = await deps.readText(paths.codeNotesPath);
  const memoryBefore = await deps.readPaperMemory(request.paper.itemKey);
  await deps.writeText(
    paths.codeNotesPath,
    existingNotes
      ? refreshCodeNotesProvenance(existingNotes, provenance)
      : provenance,
  );
  try {
    const currentTier = parseKnowledgeSurface(memoryBefore).signals.tier;
    if (currentTier === "L0" || currentTier === "L1") {
      events.onStatus?.("Upgrading the Knowledge Record for L3 analysis...");
      await deps.runCodexTurn({
        prompt: buildTierTransitionPrompt(request.paper.itemKey, "L2"),
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        fallbackToDefaultModel: request.model ? false : undefined,
        sandbox: "workspace-write",
        onStatus: events.onStatus,
        onProcess: events.onProcess,
      } satisfies CodexTurnInput);
    }
    const tierMemoryRaw = await deps.readPaperMemory(request.paper.itemKey);
    const tierMemory = restoreKnowledgeSurfaceOwnership(
      tierMemoryRaw,
      memoryBefore,
      request.paper,
    );
    if (tierMemory !== tierMemoryRaw) {
      await deps.writePaperMemory(request.paper.itemKey, tierMemory);
    }
    const l2Candidate = updateKnowledgeSurfaceSignals(tierMemory, {
      tier: "L2",
    });
    const l2Quality = evaluateKnowledgeSurface({
      after: l2Candidate,
      sourceAbstract: request.paper.abstract,
      itemKey: request.paper.itemKey,
    });
    if (l2Quality.status === "failed") {
      throw new Error(
        `The Knowledge Record could not be upgraded to L2: ${l2Quality.hardFailures.join(
          " ",
        )}`,
      );
    }
    events.onStatus?.("Analyzing paper source code...");
    await deps.runCodexTurn({
      prompt: buildCodeAnalysisPrompt({
        itemKey: request.paper.itemKey,
        repositoryUrl: repository.url,
        commit,
      }),
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      fallbackToDefaultModel: request.model ? false : undefined,
      sandbox: "workspace-write",
      onStatus: events.onStatus,
      onProcess: events.onProcess,
    } satisfies CodexTurnInput);
    const memoryAfterCode = await deps.readPaperMemory(request.paper.itemKey);
    if (memoryAfterCode !== tierMemory) {
      await deps.writePaperMemory(request.paper.itemKey, tierMemory);
    }
    const analyzedNotes = await deps.readText(paths.codeNotesPath);
    if (!hasCodeAnalysisContent(analyzedNotes)) {
      throw new Error(
        "Codex completed without writing substantive code analysis.",
      );
    }
    await deps.writeText(
      paths.codeNotesPath,
      refreshCodeNotesProvenance(analyzedNotes, provenance),
    );
  } catch (error) {
    await deps.writePaperMemory(request.paper.itemKey, memoryBefore);
    if (existingNotes) {
      await deps.writeText(paths.codeNotesPath, existingNotes);
    } else {
      await deps.removeText(paths.codeNotesPath);
    }
    throw error;
  }
  await deps.updatePaperSignals(request.paper, { tier: "L3" });
  const repositoryStatus = await deps.runGit(paths.codeDir, [
    "status",
    "--porcelain",
  ]);
  const repositoryModified = Boolean(repositoryStatus.stdout.trim());
  await deps.refreshPaperRecordProjection(request.paper);
  const committed = await deps.commitVaultChanges(
    `code: ${request.paper.itemKey} ${repository.owner}/${repository.repository}`,
  );
  return { repository, branch, commit, repositoryModified, committed };
}

function hasCodeAnalysisContent(markdown: string): boolean {
  const body = String(markdown || "")
    .replace(
      /<!--\s*zotero-agent:code:start\s*-->[\s\S]*?<!--\s*zotero-agent:code:end\s*-->/gi,
      "",
    )
    .replace(/^#{1,3}\s+.+$/gm, "")
    .trim();
  return body.length >= 40;
}

function refreshCodeNotesProvenance(
  markdown: string,
  canonicalMarkdown: string,
): string {
  const canonical = extractMarkedBlock(
    canonicalMarkdown,
    CODE_PROVENANCE_START,
    CODE_PROVENANCE_END,
  );
  const current = extractMarkedBlock(
    markdown,
    CODE_PROVENANCE_START,
    CODE_PROVENANCE_END,
  );
  if (!current) {
    const headingEnd = markdown.indexOf("\n");
    return headingEnd >= 0
      ? `${markdown.slice(0, headingEnd + 1)}\n${canonical}\n${markdown
          .slice(headingEnd + 1)
          .trimStart()}`
      : canonicalMarkdown;
  }
  return markdown.replace(current, canonical);
}

function extractMarkedBlock(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) return "";
  return text.slice(startIndex, endIndex + end.length);
}

async function runGitCommand(
  cwd: string,
  args: string[],
  allowNonZero = false,
): Promise<LineProcessResult> {
  const result = await runLineProcess({
    command: await resolveGitBinary(),
    arguments: args,
    cwd,
    timeoutMs: 180000,
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
    if (await pathExists(candidate)) return candidate;
  }
  return "/usr/bin/git";
}

async function readText(path: string): Promise<string> {
  if (!(await pathExists(path))) return "";
  return String(await getIOUtils().readUTF8(path));
}

async function writeText(path: string, text: string): Promise<void> {
  const value = String(text || "");
  await getIOUtils().writeUTF8(
    path,
    value.endsWith("\n") ? value : `${value}\n`,
  );
}

async function removeText(path: string): Promise<void> {
  await getIOUtils().remove(path, { ignoreAbsent: true });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    return Boolean(await getIOUtils().exists(path));
  } catch {
    return false;
  }
}

function getIOUtils(): any {
  const ioUtils = (globalThis as any).IOUtils;
  if (!ioUtils) throw new Error("IOUtils is unavailable.");
  return ioUtils;
}

function joinPath(...parts: string[]): string {
  const pathUtils = (globalThis as any).PathUtils;
  return pathUtils?.join
    ? pathUtils.join(...parts)
    : parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
