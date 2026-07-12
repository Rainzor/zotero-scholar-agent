import { parse, stringify } from "yaml";
import { commitVaultChanges, getVaultDir } from "./codex/vault";
import { runCodexTurn, type CodexTurnInput } from "./codex/runner";
import type { CodexReasoningEffort } from "./codex/context-window";
import type { RunningLineProcess } from "./codex/subprocess";

export type TopicNoteMeta = {
  topicVersion: 1;
  title: string;
  slug: string;
  paperItemKeys: string[];
  updatedAt: string;
};

export function normalizeTopicSlug(title: string): string {
  const source = String(title || "").trim();
  const ascii = source
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (!/[^\x00-\x7F]/.test(source)) return ascii || "topic";
  return `${ascii || "topic"}-${stableTopicHash(source)}`;
}

export function buildTopicNoteMarkdown(options: {
  title: string;
  slug: string;
  paperItemKeys: string[];
  updatedAt: string;
}): string {
  const meta = normalizeTopicMeta({
    topicVersion: 1,
    title: options.title,
    slug: options.slug,
    paperItemKeys: options.paperItemKeys,
    updatedAt: options.updatedAt,
  });
  return serializeTopicNote(
    meta,
    [
      `# ${meta.title}`,
      "",
      "## Problem Framing",
      "",
      "## Method Lineage",
      "",
      "## Paper Positions",
      "",
      "## Supporting and Contradictory Evidence",
      "",
      "## Open Questions",
      "",
      "## Researcher Judgment (Draft)",
      "",
    ].join("\n"),
  );
}

export function serializeTopicNote(meta: TopicNoteMeta, body: string): string {
  const frontmatter = stringify(normalizeTopicMeta(meta), {
    lineWidth: 0,
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${String(body || "").trim()}\n`;
}

export function parseTopicNote(markdown: string): {
  meta: TopicNoteMeta;
  body: string;
} {
  const text = String(markdown || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/);
  if (!match) {
    return {
      meta: normalizeTopicMeta({}),
      body: text,
    };
  }
  let value: unknown = {};
  try {
    value = parse(match[1]) || {};
  } catch {
    value = {};
  }
  return {
    meta: normalizeTopicMeta(value),
    body: text.slice(match[0].length),
  };
}

export function buildTopicNotePrompt(options: {
  title: string;
  slug: string;
  paperItemKeys: string[];
}): string {
  const sources = uniqueStrings(options.paperItemKeys)
    .flatMap((itemKey) => [
      `- ${itemKey}/memory.md`,
      `- ${itemKey}/record.json`,
    ])
    .join("\n");
  return `Update the explicit Topic Note "${options.title}" at topics/${options.slug}.md.

The user selected these paper knowledge sources:
${sources}

Read memory.md and record.json first. Open text.txt only when a claim needs page-level evidence.
Rewrite the Topic Note body to synthesize problem framing, method lineage, paper positions,
supporting or contradictory evidence, open questions, and decision-relevant tradeoffs.
Do not invent or attribute personal preferences to the user.
Preserve YAML frontmatter exactly and keep Item Keys unchanged.
Use relative links to paper memory.md files and [page N] evidence where useful.
Do not modify any paper directory or any other Topic Note.
Return a concise confirmation after topics/${options.slug}.md is updated.`;
}

function normalizeTopicMeta(value: unknown): TopicNoteMeta {
  const raw =
    value && typeof value === "object" ? (value as Partial<TopicNoteMeta>) : {};
  const title =
    String(raw.title || "Untitled Topic").trim() || "Untitled Topic";
  return {
    topicVersion: 1,
    title,
    slug: String(raw.slug || "").trim() || normalizeTopicSlug(title),
    paperItemKeys: uniqueStrings(raw.paperItemKeys || []),
    updatedAt: String(raw.updatedAt || "").trim(),
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = String(entry || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function stableTopicHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type TopicNoteSummary = TopicNoteMeta & {
  path: string;
};

type TopicNoteDeps = {
  getVaultDir: typeof getVaultDir;
  runCodexTurn: typeof runCodexTurn;
  commitVaultChanges: typeof commitVaultChanges;
  ensureDirectory: (path: string) => Promise<void>;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
  removeText: (path: string) => Promise<void>;
};

const defaultTopicNoteDeps: TopicNoteDeps = {
  getVaultDir,
  runCodexTurn,
  commitVaultChanges,
  ensureDirectory,
  readText,
  writeText,
  removeText,
};

export async function createOrUpdateTopicNote(
  options: {
    title: string;
    paperItemKeys: string[];
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    onStatus?: (text: string) => void;
    onProcess?: (process: RunningLineProcess) => void;
  },
  depsOverride: Partial<TopicNoteDeps> = {},
): Promise<{ topic: TopicNoteSummary; committed: boolean }> {
  const deps = { ...defaultTopicNoteDeps, ...depsOverride };
  const title = String(options.title || "").trim();
  const paperItemKeys = uniqueStrings(options.paperItemKeys);
  if (!title) throw new Error("Topic title is required.");
  if (paperItemKeys.length < 2) {
    throw new Error("Select at least two papers for a Topic Note.");
  }
  const slug = normalizeTopicSlug(title);
  const vaultDir = await deps.getVaultDir();
  const topicsDir = joinPath(vaultDir, "topics");
  const path = joinPath(topicsDir, `${slug}.md`);
  await deps.ensureDirectory(topicsDir);
  const meta: TopicNoteMeta = {
    topicVersion: 1,
    title,
    slug,
    paperItemKeys,
    updatedAt: new Date().toISOString(),
  };
  const existing = await deps.readText(path);
  const initial = existing
    ? serializeTopicNote(meta, parseTopicNote(existing).body)
    : buildTopicNoteMarkdown(meta);
  await deps.writeText(path, initial);

  options.onStatus?.("Synthesizing selected papers...");
  let finalMeta: TopicNoteMeta;
  try {
    await deps.runCodexTurn({
      prompt: buildTopicNotePrompt({ title, slug, paperItemKeys }),
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      fallbackToDefaultModel: options.model ? false : undefined,
      sandbox: "workspace-write",
      onStatus: options.onStatus,
      onProcess: options.onProcess,
    } satisfies CodexTurnInput);
    const after = await deps.readText(path);
    const parsedAfter = parseTopicNote(after);
    if (!hasSubstantiveTopicBody(parsedAfter.body)) {
      throw new Error(
        "Codex completed without writing substantive Topic Note content.",
      );
    }
    finalMeta = { ...meta, updatedAt: new Date().toISOString() };
    await deps.writeText(path, serializeTopicNote(finalMeta, parsedAfter.body));
  } catch (error) {
    if (existing) {
      await deps.writeText(path, existing);
    } else {
      await deps.removeText(path);
    }
    throw error;
  }
  const committed = await deps.commitVaultChanges(`topic: ${slug}`);
  return {
    topic: { ...finalMeta, path },
    committed,
  };
}

function hasSubstantiveTopicBody(body: string): boolean {
  return (
    String(body || "")
      .replace(/^#{1,3}\s+.+$/gm, "")
      .trim().length >= 80
  );
}

export async function listTopicNotes(): Promise<TopicNoteSummary[]> {
  const topicsDir = joinPath(await getVaultDir(), "topics");
  if (!(await pathExists(topicsDir))) return [];
  const children: string[] = await getIOUtils().getChildren(topicsDir);
  const topics: TopicNoteSummary[] = [];
  for (const path of children || []) {
    if (!String(path).toLowerCase().endsWith(".md")) continue;
    const parsed = parseTopicNote(await readText(path));
    topics.push({ ...parsed.meta, path });
  }
  return topics.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readTopicNote(slug: string): Promise<string> {
  const path = joinPath(
    await getVaultDir(),
    "topics",
    `${normalizeTopicSlug(slug)}.md`,
  );
  return readText(path);
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

async function ensureDirectory(path: string): Promise<void> {
  await getIOUtils().makeDirectory(path, {
    createAncestors: true,
    ignoreExisting: true,
  });
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
