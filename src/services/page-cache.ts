import type { StructuredPage } from "./pdf-parser";

type PageCacheData = {
  version: number;
  totalPages: number;
  pages: StructuredPage[];
};

const CACHE_VERSION = 1;
const memoryCache = new Map<string, PageCacheData>();
const MEMORY_LIMIT = 3;

function getPathUtils(): any {
  return (globalThis as any).PathUtils;
}

function getIOUtils(): any {
  return (globalThis as any).IOUtils;
}

function safeItemKey(itemKey: string): string {
  const raw = String(itemKey || "").trim();
  if (!raw) return "unknown-item";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getPageCacheDir(): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join) {
    return pathUtils.join(Zotero.DataDirectory.dir, "zoteroagent", "papers");
  }
  return `${Zotero.DataDirectory.dir}/zoteroagent/papers`;
}

function getPageCachePath(itemKey: string): string {
  const fileName = `${safeItemKey(itemKey)}-pages.json`;
  const pathUtils = getPathUtils();
  if (pathUtils?.join) {
    return pathUtils.join(getPageCacheDir(), fileName);
  }
  return `${getPageCacheDir()}/${fileName}`;
}

async function ensurePageCacheDir(): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  await ioUtils.makeDirectory(getPageCacheDir(), {
    createAncestors: true,
    ignoreExisting: true,
  });
}

export async function hasPageCache(itemKey: string): Promise<boolean> {
  if (memoryCache.has(itemKey)) return true;
  const ioUtils = getIOUtils();
  if (!ioUtils) return false;
  try {
    return Boolean(await ioUtils.exists(getPageCachePath(itemKey)));
  } catch {
    return false;
  }
}

export async function loadPageCache(
  itemKey: string,
): Promise<PageCacheData | null> {
  const fromMemory = memoryCache.get(itemKey);
  if (fromMemory) return fromMemory;

  const ioUtils = getIOUtils();
  if (!ioUtils) return null;
  try {
    const path = getPageCachePath(itemKey);
    if (!(await ioUtils.exists(path))) return null;
    const raw = await ioUtils.readUTF8(path);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const normalized = normalizeCache(parsed);
    if (!normalized) return null;
    rememberInMemory(itemKey, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export async function savePageCache(
  itemKey: string,
  data: PageCacheData,
): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  const normalized = normalizeCache(data);
  if (!normalized) return;
  await ensurePageCacheDir();
  await ioUtils.writeUTF8(
    getPageCachePath(itemKey),
    JSON.stringify(normalized),
  );
  rememberInMemory(itemKey, normalized);
}

export function buildPageCacheData(pages: StructuredPage[]): PageCacheData {
  const normalizedPages = (pages || [])
    .map((page) => ({
      pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 0)),
      blocks: Array.isArray(page.blocks) ? page.blocks : [],
      plainText: String(page.plainText || ""),
    }))
    .filter((p) => p.pageNumber > 0);
  return {
    version: CACHE_VERSION,
    totalPages: normalizedPages.length,
    pages: normalizedPages,
  };
}

function normalizeCache(data: any): PageCacheData | null {
  if (!data || typeof data !== "object") return null;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const normalized = buildPageCacheData(pages);
  if (!normalized.pages.length) return null;
  normalized.version = Number(data.version) || CACHE_VERSION;
  normalized.totalPages = Number(data.totalPages) || normalized.pages.length;
  return normalized;
}

function rememberInMemory(itemKey: string, data: PageCacheData): void {
  if (memoryCache.has(itemKey)) memoryCache.delete(itemKey);
  memoryCache.set(itemKey, data);
  while (memoryCache.size > MEMORY_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}
