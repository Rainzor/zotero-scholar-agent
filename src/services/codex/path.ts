import { getPref, setPref } from "../../utils/prefs";
import { runLineProcess } from "./subprocess";

export const CODEX_PATH_PREF = "codex.path";

export type CodexPathSource =
  | "preference"
  | "environment-path"
  | "common-location"
  | "login-shell";

export type CodexPathResolution = {
  path: string;
  source: CodexPathSource;
};

export type CodexVersionResult = {
  ok: boolean;
  path: string;
  version: string;
  source?: CodexPathSource;
  error?: string;
};

let cachedResolution: CodexPathResolution | null = null;

export function getConfiguredCodexPath(): string {
  return normalizePath(String(getPref(CODEX_PATH_PREF) || ""));
}

export function setConfiguredCodexPath(path: string) {
  setPref(CODEX_PATH_PREF, normalizePath(path));
  cachedResolution = null;
}

export async function resolveCodexBinary(
  refresh = false,
): Promise<CodexPathResolution> {
  if (!refresh && cachedResolution) return cachedResolution;

  const configured = getConfiguredCodexPath();
  if (configured) {
    if (await isWorkingCodexBinary(configured)) {
      return cache({ path: configured, source: "preference" });
    }
    throw new Error(`Configured codex path is not executable or failed --version: ${configured}`);
  }

  const shellPaths = await resolveViaLoginShell();
  for (const shellPath of shellPaths) {
    if (await isWorkingCodexBinary(shellPath)) {
      return cache({ path: shellPath, source: "login-shell" });
    }
  }

  for (const candidate of getPathCandidates()) {
    if (await isWorkingCodexBinary(candidate.path)) {
      return cache(candidate);
    }
  }

  throw new Error(
    "Could not find the codex CLI. Set an absolute codex path in Zotero Agent preferences.",
  );
}

export async function testCodexBinary(path?: string): Promise<CodexVersionResult> {
  try {
    const resolved = path
      ? { path: normalizePath(path), source: undefined }
      : await resolveCodexBinary(true);
    if (!resolved.path) {
      return {
        ok: false,
        path: "",
        version: "",
        error: "No codex path was provided.",
      };
    }
    const version = await readCodexVersion(resolved.path);
    if (!version.ok) {
      return {
        ok: false,
        path: resolved.path,
        version: "",
        source: resolved.source,
        error: version.error || `codex --version failed: ${resolved.path}`,
      };
    }
    return {
      ok: true,
      path: resolved.path,
      version: version.version,
      source: resolved.source,
    };
  } catch (error) {
    return {
      ok: false,
      path: path ? normalizePath(path) : "",
      version: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isWorkingCodexBinary(path: string): Promise<boolean> {
  const result = await readCodexVersion(path);
  return result.ok;
}

async function readCodexVersion(
  path: string,
): Promise<{ ok: boolean; version: string; error?: string }> {
  if (!(await pathExists(path))) {
    return { ok: false, version: "", error: `Path does not exist: ${path}` };
  }
  try {
    const result = await runLineProcess({
      command: path,
      arguments: ["--version"],
      timeoutMs: 15000,
    });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      ok: result.exitCode === 0 && Boolean(output),
      version: result.exitCode === 0 ? output : "",
      error: result.exitCode === 0 ? undefined : output || "codex --version failed.",
    };
  } catch (error) {
    return {
      ok: false,
      version: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function cache(resolution: CodexPathResolution): CodexPathResolution {
  cachedResolution = resolution;
  return resolution;
}

function getPathCandidates(): CodexPathResolution[] {
  const candidates: CodexPathResolution[] = [];
  const seen = new Set<string>();
  const add = (path: string, source: CodexPathSource) => {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ path: normalized, source });
  };

  const pathEnv = String((globalThis as any).Services?.env?.get?.("PATH") || "");
  for (const dir of pathEnv.split(":")) {
    if (dir.trim()) add(joinPath(dir.trim(), "codex"), "environment-path");
  }

  for (const dir of [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...getHomeBinDirs(),
  ]) {
    add(joinPath(dir, "codex"), "common-location");
  }

  return candidates;
}

async function resolveViaLoginShell(): Promise<string[]> {
  const shell = getPreferredShell();
  if (!(await pathExists(shell))) return [];
  try {
    const result = await runLineProcess({
      command: shell,
      arguments: ["-l", "-c", "where codex 2>/dev/null || command -v codex"],
      timeoutMs: 15000,
    });
    if (result.exitCode !== 0) return [];
    return absoluteCodexPaths(result.stdout);
  } catch {
    return [];
  }
}

function absoluteCodexPaths(output: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/") && /(?:^|\/)codex$/.test(trimmed)) {
      const normalized = normalizePath(trimmed);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        paths.push(normalized);
      }
    }
  }
  return paths;
}

async function pathExists(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    const ioUtils = (globalThis as any).IOUtils;
    if (ioUtils?.exists) return Boolean(await ioUtils.exists(path));
  } catch {
    return false;
  }
  return false;
}

function normalizePath(path: string): string {
  const trimmed = String(path || "").trim();
  if (!trimmed) return "";
  const extracted = extractCodexPath(trimmed);
  if (extracted) return extracted;
  if (trimmed === "~") return getHomeDir();
  if (trimmed.startsWith("~/")) {
    const home = getHomeDir();
    return home ? joinPath(home, trimmed.slice(2)) : "";
  }
  return trimmed;
}

function extractCodexPath(input: string): string {
  // Users often paste the whole terminal transcript (`where codex`, prompts,
  // errors, multiple candidates). Prefer the first absolute path ending in
  // `/codex` instead of treating the whole transcript as one invalid path.
  const matches = input.match(/\/[^\s'"`<>|]+\/codex\b/g) || [];
  return matches[0] || "";
}

function getPreferredShell(): string {
  const envShell = String((globalThis as any).Services?.env?.get?.("SHELL") || "");
  if (envShell.startsWith("/")) return envShell;
  if ((Zotero as any).isMac) return "/bin/zsh";
  return "/bin/bash";
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
    // Ignore and let callers skip home-relative candidates.
  }
  return "";
}

function getHomeBinDirs(): string[] {
  const home = getHomeDir();
  if (!home) return [];
  return [
    joinPath(home, ".local/bin"),
    joinPath(home, ".npm-global/bin"),
    joinPath(home, ".bun/bin"),
  ].filter(Boolean);
}

function joinPath(...parts: string[]): string {
  const pathUtils = (globalThis as any).PathUtils;
  const filtered = parts.filter(Boolean);
  if (pathUtils?.join && filtered.length > 0) {
    try {
      return pathUtils.join(...filtered);
    } catch {
      // PathUtils.join rejects some relative/empty roots in Zotero's GUI
      // process. Fall back to string joining for candidate construction.
    }
  }
  return filtered
    .join("/")
    .replace(/\/+/g, "/");
}
