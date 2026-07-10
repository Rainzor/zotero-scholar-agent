import type { TokenUsage } from "../../addon";
import { getPref, setPref } from "../../utils/prefs";
import { resolveCodexBinary } from "./path";
import { runLineProcess } from "./subprocess";

export const CODEX_MODEL_SLUG_PREF = "codex.modelSlug";
export const CODEX_CHEAP_MODEL_SLUG_PREF = "codex.cheapModelSlug";
export const CODEX_CONTEXT_WINDOW_PREF = "codex.contextWindowTokens";

export type CodexContextSource =
  | "codex-config"
  | "codex-catalog"
  | "manual"
  | "unknown";

export type CodexContextWindow = {
  modelSlug?: string;
  contextWindowTokens?: number;
  effectiveContextWindowTokens?: number;
  effectiveContextWindowPercent?: number;
  contextSource: CodexContextSource;
};

export type CodexModelCatalogEntry = {
  slug: string;
  displayName?: string;
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
  effectiveContextWindowPercent?: number;
  priority?: number;
  visibility?: string;
};

let cachedContextWindow: CodexContextWindow | null = null;
let cachedContextWindowKey = "";
let cachedCatalog: CodexModelCatalogEntry[] | null = null;

export function getConfiguredCodexModelSlug(): string {
  return String(getPref(CODEX_MODEL_SLUG_PREF) || "").trim();
}

export function setConfiguredCodexModelSlug(slug: string) {
  setPref(CODEX_MODEL_SLUG_PREF, String(slug || "").trim());
  cachedContextWindow = null;
}

export function getConfiguredCodexCheapModelSlug(): string {
  return String(getPref(CODEX_CHEAP_MODEL_SLUG_PREF) || "").trim();
}

export function setConfiguredCodexCheapModelSlug(slug: string) {
  setPref(CODEX_CHEAP_MODEL_SLUG_PREF, String(slug || "").trim());
}

export function getConfiguredCodexContextWindow(): number | undefined {
  return positiveInteger(getPref(CODEX_CONTEXT_WINDOW_PREF));
}

export function setConfiguredCodexContextWindow(tokens?: number | string) {
  const value = positiveInteger(tokens);
  setPref(CODEX_CONTEXT_WINDOW_PREF, value ? String(value) : "");
  cachedContextWindow = null;
}

export async function resolveCodexContextWindow(options?: {
  codexPath?: string;
  modelSlug?: string;
  refresh?: boolean;
}): Promise<CodexContextWindow> {
  const manualWindow = getConfiguredCodexContextWindow();
  const manualModel = getConfiguredCodexModelSlug();
  const configuredModel =
    options?.modelSlug || manualModel || (await readCodexConfiguredModelSlug());
  const cacheKey = [
    configuredModel,
    manualWindow || "",
    manualModel,
  ].join("\n");
  if (!options?.refresh && cachedContextWindow && cachedContextWindowKey === cacheKey) {
    return cachedContextWindow;
  }
  if (manualWindow) {
    return cacheContextWindow({
      modelSlug: options?.modelSlug || manualModel || undefined,
      contextWindowTokens: manualWindow,
      effectiveContextWindowTokens: manualWindow,
      contextSource: "manual",
    }, cacheKey);
  }

  const catalog = await loadCodexModelCatalog(options?.codexPath);
  const matched = selectCatalogModel(catalog, configuredModel);
  if (matched) {
    const contextWindow = matched.contextWindowTokens;
    const percent = matched.effectiveContextWindowPercent;
    return cacheContextWindow({
      modelSlug: matched.slug,
      contextWindowTokens: contextWindow,
      effectiveContextWindowTokens: effectiveWindow(contextWindow, percent),
      effectiveContextWindowPercent: percent,
      contextSource: configuredModel ? "codex-config" : "codex-catalog",
    }, cacheKey);
  }

  return cacheContextWindow({
    modelSlug: configuredModel || undefined,
    contextSource: "unknown",
  }, cacheKey);
}

export function enrichUsageWithContext(
  usage?: TokenUsage,
  context?: CodexContextWindow,
): TokenUsage | undefined {
  if (!usage) return undefined;
  if (!context) return usage;
  return {
    ...usage,
    contextWindowTokens: context.contextWindowTokens,
    effectiveContextWindowTokens: context.effectiveContextWindowTokens,
    contextSource: context.contextSource,
    modelSlug: context.modelSlug,
  };
}

export async function resolveCodexModelForExecution(
  modelSlug: string | undefined,
  codexPath?: string,
): Promise<{
  requestedModelSlug: string;
  modelSlug?: string;
  checkedCatalog: boolean;
}> {
  const requestedModelSlug = String(modelSlug || "").trim();
  if (!requestedModelSlug) return { requestedModelSlug: "", checkedCatalog: false };
  const catalog = await loadCodexModelCatalog(codexPath);
  if (!catalog.length) {
    return {
      requestedModelSlug,
      modelSlug: requestedModelSlug,
      checkedCatalog: false,
    };
  }
  const matched = selectCatalogModel(catalog, requestedModelSlug);
  const exactMatch =
    matched &&
    (matched.slug.toLowerCase() === requestedModelSlug.toLowerCase() ||
      matched.displayName?.toLowerCase() === requestedModelSlug.toLowerCase());
  return {
    requestedModelSlug,
    modelSlug: exactMatch ? matched.slug : undefined,
    checkedCatalog: true,
  };
}

export async function listCodexModels(options?: {
  codexPath?: string;
  refresh?: boolean;
}): Promise<CodexModelCatalogEntry[]> {
  if (options?.refresh) cachedCatalog = null;
  const catalog = await loadCodexModelCatalog(options?.codexPath);
  return catalog
    .filter((model) => model.visibility?.toLowerCase() !== "hide")
    .slice()
    .sort((a, b) => {
      const priority = (a.priority ?? 9999) - (b.priority ?? 9999);
      return priority || a.slug.localeCompare(b.slug);
    });
}

export function parseCodexModelCatalog(raw: string): CodexModelCatalogEntry[] {
  const parsed = parseJsonObjectFromOutput(raw);
  const models = Array.isArray((parsed as any)?.models) ? (parsed as any).models : [];
  return models
    .map((model: any): CodexModelCatalogEntry | null => {
      const slug = String(model?.slug || "").trim();
      if (!slug) return null;
      return {
        slug,
        displayName: String(model?.display_name || model?.displayName || "").trim() || undefined,
        contextWindowTokens: positiveInteger(model?.context_window),
        maxContextWindowTokens: positiveInteger(model?.max_context_window),
        effectiveContextWindowPercent: positiveInteger(
          model?.effective_context_window_percent,
        ),
        priority:
          typeof model?.priority === "number" && Number.isFinite(model.priority)
            ? model.priority
            : undefined,
        visibility: String(model?.visibility || "").trim() || undefined,
      };
    })
    .filter(Boolean) as CodexModelCatalogEntry[];
}

export function parseTopLevelTomlString(toml: string, key: string): string {
  for (const rawLine of String(toml || "").split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[")) return "";
    const match = line.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.+)$`));
    if (!match) continue;
    return parseTomlScalarString(match[1]);
  }
  return "";
}

export function selectCatalogModel(
  catalog: CodexModelCatalogEntry[],
  preferredSlug?: string,
): CodexModelCatalogEntry | undefined {
  if (!catalog.length) return undefined;
  const preferred = String(preferredSlug || "").trim().toLowerCase();
  if (preferred) {
    const exact = catalog.find((model) => model.slug.toLowerCase() === preferred);
    if (exact) return exact;
    const byName = catalog.find(
      (model) => model.displayName?.toLowerCase() === preferred,
    );
    if (byName) return byName;
  }
  return catalog
    .filter((model) => model.contextWindowTokens)
    .sort((a, b) => (a.priority ?? 9999) - (b.priority ?? 9999))[0];
}

async function loadCodexModelCatalog(
  codexPath?: string,
): Promise<CodexModelCatalogEntry[]> {
  if (cachedCatalog) return cachedCatalog;
  const path = codexPath || (await resolveCodexBinary()).path;
  const direct = await runCodexDebugModels(path, false);
  if (direct.length) {
    cachedCatalog = direct;
    return direct;
  }
  cachedCatalog = await runCodexDebugModels(path, true);
  return cachedCatalog;
}

async function runCodexDebugModels(
  codexPath: string,
  bundled: boolean,
): Promise<CodexModelCatalogEntry[]> {
  try {
    const result = await runLineProcess({
      command: codexPath,
      arguments: bundled ? ["debug", "models", "--bundled"] : ["debug", "models"],
      timeoutMs: bundled ? 8000 : 5000,
    });
    if (result.exitCode !== 0) return [];
    return parseCodexModelCatalog(`${result.stdout}\n${result.stderr}`);
  } catch {
    return [];
  }
}

async function readCodexConfiguredModelSlug(): Promise<string> {
  const path = getCodexConfigPath();
  if (!path) return "";
  const toml = await readTextIfExists(path);
  return parseTopLevelTomlString(toml, "model");
}

function cacheContextWindow(
  context: CodexContextWindow,
  cacheKey: string,
): CodexContextWindow {
  cachedContextWindow = context;
  cachedContextWindowKey = cacheKey;
  return context;
}

function effectiveWindow(
  contextWindow?: number,
  percent?: number,
): number | undefined {
  if (!contextWindow) return undefined;
  if (!percent || percent <= 0 || percent > 100) return contextWindow;
  return Math.floor((contextWindow * percent) / 100);
}

function parseJsonObjectFromOutput(raw: string): unknown {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}

function parseTomlScalarString(value: string): string {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2].trim();
  return trimmed.split(/\s+/)[0]?.trim() || "";
}

function stripTomlComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if ((ch === `"` || ch === "'") && line[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
    }
    if (ch === "#" && !quote) return line.slice(0, i);
  }
  return line;
}

function getCodexConfigPath(): string {
  const codexHome = getEnv("CODEX_HOME") || joinPath(getHomeDir(), ".codex");
  return codexHome ? joinPath(codexHome, "config.toml") : "";
}

async function readTextIfExists(path: string): Promise<string> {
  if (!path) return "";
  try {
    const ioUtils = (globalThis as any).IOUtils;
    if (ioUtils?.exists && !(await ioUtils.exists(path))) return "";
    if (ioUtils?.readUTF8) return String(await ioUtils.readUTF8(path));
  } catch {
    return "";
  }
  return "";
}

function positiveInteger(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function getEnv(name: string): string {
  return String((globalThis as any).Services?.env?.get?.(name) || "");
}

function getHomeDir(): string {
  const envHome = getEnv("HOME");
  if (envHome) return envHome;
  try {
    const dirsvc = (globalThis as any).Services?.dirsvc;
    const components = (globalThis as any).Components;
    const home = dirsvc?.get?.("Home", components?.interfaces?.nsIFile);
    if (home?.path) return String(home.path);
  } catch {
    // Fall through to an empty config path.
  }
  return "";
}

function joinPath(...parts: string[]): string {
  const filtered = parts.filter(Boolean);
  const pathUtils = (globalThis as any).PathUtils;
  if (pathUtils?.join && filtered.length > 0) {
    try {
      return pathUtils.join(...filtered);
    } catch {
      // Fall back to a conservative POSIX-style join.
    }
  }
  return filtered.join("/").replace(/\/+/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
