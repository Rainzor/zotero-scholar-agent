import { AIService } from "./ai-service";
import { truncateDocContext } from "./context-builder";
import { initContextPdfPrompt } from "./prompts";
import {
  formatStructuredPagesForPrompt,
  type StructuredPage,
} from "./pdf-parser";
import {
  MAX_CONTEXT_PDF_SIZE_BYTES,
  sha256OfBytes,
} from "../utils/pdf-upload-utils";
import { resolveLocalPdfPath } from "../utils/local-pdf-path";

export type ContextPdfStatus =
  | "uploading"
  | "parsing"
  | "overviewing"
  | "ready"
  | "error";

export type ContextPdfSource = "upload" | "library";

export type ContextPdfSessionRef = {
  source: ContextPdfSource;
  hash: string;
  fileName: string;
  fileSize: number;
  addedAt: number;
  itemKey?: string;
  itemId?: number;
};

export type ContextPdfData = {
  version: number;
  source: ContextPdfSource;
  hash: string;
  fileName: string;
  fileSize: number;
  totalPages: number;
  pages: StructuredPage[];
  overview: string;
  createdAt: number;
  itemKey?: string;
  itemId?: number;
};

type AddContextPdfOptions = {
  miniModel?: string;
  maxContextTokens?: number;
  onStatus?: (status: ContextPdfStatus, text: string) => void;
};

const CACHE_VERSION = 2;
const MEMORY_LIMIT = 6;
const memoryCache = new Map<string, ContextPdfData>();

const HASH_REGEX = /^[a-f0-9]{64}$/;
const ITEM_KEY_REGEX = /^[A-Z0-9]{8}$/i;

// =============== Public API ===============

export async function addUploadContextPdf(
  file: File,
  options: AddContextPdfOptions = {},
): Promise<{ ref: ContextPdfSessionRef; data: ContextPdfData }> {
  const fileName = String(file?.name || "").trim() || "reference.pdf";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileSize = Math.max(0, Number(file.size) || bytes.byteLength || 0);
  options.onStatus?.("uploading", "Hashing PDF file...");
  const hash = await sha256OfBytes(bytes);

  const cached = await loadUploadContextPdfByHash(hash);
  if (cached) {
    options.onStatus?.("ready", "Reference PDF is ready.");
    return { ref: buildUploadRef(cached), data: cached };
  }

  await ensureStorageDir();
  await writePdfBytesIfMissing(hash, bytes);

  options.onStatus?.("parsing", "Parsing PDF text...");
  const parsed = await parseUploadPdfBytes(bytes);

  options.onStatus?.("overviewing", "Generating reference overview...");
  const overview = await generateReferenceOverview(parsed.pages, parsed.fullText, fileName, options);

  const data: ContextPdfData = {
    version: CACHE_VERSION,
    source: "upload",
    hash,
    fileName,
    fileSize,
    totalPages: parsed.pages.length,
    pages: parsed.pages,
    overview,
    createdAt: Date.now(),
  };
  await saveContextPdfData(data);
  options.onStatus?.("ready", "Reference PDF is ready.");
  return { ref: buildUploadRef(data), data };
}

export async function addLocalPathContextPdf(
  rawPath: string,
  options: AddContextPdfOptions = {},
): Promise<{ ref: ContextPdfSessionRef; data: ContextPdfData }> {
  options.onStatus?.("uploading", "Resolving local PDF path...");
  const resolved = await resolveLocalPdfPath(rawPath);
  if (
    resolved.fileSize > 0 &&
    resolved.fileSize > MAX_CONTEXT_PDF_SIZE_BYTES
  ) {
    throw new Error("PDF is too large to process as context.");
  }

  options.onStatus?.("uploading", "Reading local PDF file...");
  const bytes = await readLocalPdfBytes(resolved.filePath);
  const fileSize = Math.max(resolved.fileSize, bytes.byteLength);
  if (fileSize > MAX_CONTEXT_PDF_SIZE_BYTES) {
    throw new Error("PDF is too large to process as context.");
  }

  options.onStatus?.("uploading", "Hashing local PDF file...");
  const hash = await sha256OfBytes(bytes);
  const cached = await loadUploadContextPdfByHash(hash);
  if (cached) {
    options.onStatus?.("ready", "Local PDF is ready.");
    return { ref: buildUploadRef(cached), data: cached };
  }

  await ensureStorageDir();
  await writePdfBytesIfMissing(hash, bytes);

  options.onStatus?.("parsing", "Parsing local PDF text...");
  const parsed = await parseUploadPdfBytes(bytes);

  options.onStatus?.("overviewing", "Generating local PDF overview...");
  const overview = await generateReferenceOverview(
    parsed.pages,
    parsed.fullText,
    resolved.fileName,
    options,
  );

  const data: ContextPdfData = {
    version: CACHE_VERSION,
    source: "upload",
    hash,
    fileName: resolved.fileName,
    fileSize,
    totalPages: parsed.pages.length,
    pages: parsed.pages,
    overview,
    createdAt: Date.now(),
  };
  await saveContextPdfData(data);
  options.onStatus?.("ready", "Local PDF is ready.");
  return { ref: buildUploadRef(data), data };
}

export async function addLibraryContextPdf(
  attachmentItemId: number,
  options: AddContextPdfOptions = {},
): Promise<{ ref: ContextPdfSessionRef; data: ContextPdfData }> {
  const attachment = (Zotero.Items.get(attachmentItemId) as any) || null;
  if (!attachment) {
    throw new Error("Library item not found.");
  }
  const itemKey = String(attachment.key || "").trim();
  if (!ITEM_KEY_REGEX.test(itemKey)) {
    throw new Error("Library item has no valid Zotero key.");
  }
  const fileName = await resolveAttachmentFileName(attachment);
  const fileSize = await resolveAttachmentFileSize(attachment);

  options.onStatus?.("uploading", "Looking up library PDF...");
  const cached = await loadLibraryContextPdfByItemKey(itemKey);
  if (cached) {
    options.onStatus?.("ready", "Library PDF is ready.");
    return {
      ref: buildLibraryRef(cached, attachmentItemId),
      data: { ...cached, itemId: attachmentItemId },
    };
  }

  options.onStatus?.("parsing", "Reading library PDF text...");
  const result = await Zotero.PDFWorker.getFullText(attachmentItemId, null);
  const fullText = String(result?.text || "").trim();
  const pageChars = (result as any)?.pageChars;
  const pages = splitPdfTextToPages(fullText, pageChars);
  const realPages =
    pages.length > 0
      ? pages
      : fullText
        ? [{ pageNumber: 1, blocks: [], plainText: fullText } as StructuredPage]
        : [];
  if (realPages.length === 0) {
    throw new Error(
      "Failed to read text from this library PDF. It may be image-only and need OCR.",
    );
  }

  options.onStatus?.("overviewing", "Generating reference overview...");
  const overview = await generateReferenceOverview(realPages, fullText, fileName, options);

  const data: ContextPdfData = {
    version: CACHE_VERSION,
    source: "library",
    hash: libraryHashKey(itemKey),
    itemKey,
    itemId: attachmentItemId,
    fileName,
    fileSize,
    totalPages: realPages.length,
    pages: realPages,
    overview,
    createdAt: Date.now(),
  };
  await saveContextPdfData(data);
  options.onStatus?.("ready", "Library PDF is ready.");
  return { ref: buildLibraryRef(data, attachmentItemId), data };
}

export async function loadContextPdfByRef(
  ref: ContextPdfSessionRef | null | undefined,
): Promise<ContextPdfData | null> {
  if (!ref) return null;
  if (ref.source === "library") {
    const itemKey = String(ref.itemKey || "").trim();
    if (!itemKey) return null;
    const data = await loadLibraryContextPdfByItemKey(itemKey);
    if (!data) return null;
    if (ref.itemId && Number(ref.itemId) > 0) {
      return { ...data, itemId: Number(ref.itemId) };
    }
    return data;
  }
  return loadUploadContextPdfByHash(ref.hash || "");
}

// Backward-compatible: existing callers may still pass a sha256 hash.
export async function loadContextPdfByHash(
  hash: string,
): Promise<ContextPdfData | null> {
  if (HASH_REGEX.test(String(hash || "").toLowerCase())) {
    return loadUploadContextPdfByHash(hash);
  }
  // Sometimes serialized refs use lib-{itemKey} as a synthetic hash.
  const m = /^lib-([A-Z0-9]{8})$/i.exec(String(hash || "").trim());
  if (m) return loadLibraryContextPdfByItemKey(m[1]);
  return null;
}

export async function removeContextPdf(
  ref: ContextPdfSessionRef | null | undefined,
): Promise<void> {
  if (!ref) return;
  const ioUtils = getIOUtils();
  if (ref.source === "library") {
    const itemKey = String(ref.itemKey || "").trim();
    if (!ITEM_KEY_REGEX.test(itemKey)) return;
    memoryCache.delete(libraryMemoryKey(itemKey));
    if (!ioUtils) return;
    await safeRemove(ioUtils, getLibraryJsonPath(itemKey));
    return;
  }
  const hash = normalizeUploadHash(ref.hash);
  if (!hash) return;
  memoryCache.delete(uploadMemoryKey(hash));
  if (!ioUtils) return;
  await safeRemove(ioUtils, getUploadJsonPath(hash));
  await safeRemove(ioUtils, getUploadPdfPath(hash));
}

export async function clearContextPdfsExceptActive(
  activeRefs: ContextPdfSessionRef[] = [],
): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  const dir = getContextStorageDir();
  const keepUploadHashes = new Set(
    activeRefs
      .filter((r) => r?.source === "upload")
      .map((r) => normalizeUploadHash(r.hash))
      .filter(Boolean),
  );
  const keepLibraryKeys = new Set(
    activeRefs
      .filter((r) => r?.source === "library")
      .map((r) => String(r.itemKey || "").trim())
      .filter((k) => ITEM_KEY_REGEX.test(k)),
  );
  try {
    if (!(await ioUtils.exists(dir))) return;
    const children: string[] = await ioUtils.getChildren(dir);
    for (const path of children || []) {
      const name =
        String(path || "")
          .split("/")
          .pop() || "";
      const uploadMatch = /^([a-f0-9]{64})\.(json|pdf)$/i.exec(name);
      if (uploadMatch) {
        const hash = uploadMatch[1].toLowerCase();
        if (keepUploadHashes.has(hash)) continue;
        await safeRemove(ioUtils, path);
        memoryCache.delete(uploadMemoryKey(hash));
        continue;
      }
      const libMatch = /^lib-([A-Z0-9]{8})\.json$/i.exec(name);
      if (libMatch) {
        const key = libMatch[1];
        if (keepLibraryKeys.has(key)) continue;
        await safeRemove(ioUtils, path);
        memoryCache.delete(libraryMemoryKey(key));
        continue;
      }
    }
  } catch (_e) {
    // ignore cleanup failures
  }
}

// =============== Internal: refs / cache keys ===============

function buildUploadRef(data: ContextPdfData): ContextPdfSessionRef {
  return {
    source: "upload",
    hash: data.hash,
    fileName: data.fileName,
    fileSize: data.fileSize,
    addedAt: Date.now(),
  };
}

function buildLibraryRef(
  data: ContextPdfData,
  attachmentItemId: number,
): ContextPdfSessionRef {
  return {
    source: "library",
    hash: data.hash,
    fileName: data.fileName,
    fileSize: data.fileSize,
    addedAt: Date.now(),
    itemKey: data.itemKey,
    itemId: attachmentItemId,
  };
}

function uploadMemoryKey(hash: string): string {
  return `upload:${hash}`;
}

function libraryMemoryKey(itemKey: string): string {
  return `library:${itemKey.toUpperCase()}`;
}

function libraryHashKey(itemKey: string): string {
  return `lib-${itemKey.toUpperCase()}`;
}

function normalizeUploadHash(hash: string | undefined | null): string {
  const v = String(hash || "")
    .trim()
    .toLowerCase();
  return HASH_REGEX.test(v) ? v : "";
}

// =============== Internal: persistence layer ===============

function getPathUtils(): any {
  return (globalThis as any).PathUtils;
}

function getIOUtils(): any {
  return (globalThis as any).IOUtils;
}

function getContextStorageDir(): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join) {
    return pathUtils.join(
      Zotero.DataDirectory.dir,
      "zoteroagent",
      "context-uploads",
    );
  }
  return `${Zotero.DataDirectory.dir}/zoteroagent/context-uploads`;
}

function getUploadPdfPath(hash: string): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join)
    return pathUtils.join(getContextStorageDir(), `${hash}.pdf`);
  return `${getContextStorageDir()}/${hash}.pdf`;
}

function getUploadJsonPath(hash: string): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join)
    return pathUtils.join(getContextStorageDir(), `${hash}.json`);
  return `${getContextStorageDir()}/${hash}.json`;
}

function getLibraryJsonPath(itemKey: string): string {
  const pathUtils = getPathUtils();
  const fileName = `lib-${itemKey.toUpperCase()}.json`;
  if (pathUtils?.join) return pathUtils.join(getContextStorageDir(), fileName);
  return `${getContextStorageDir()}/${fileName}`;
}

async function ensureStorageDir(): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  await ioUtils.makeDirectory(getContextStorageDir(), {
    createAncestors: true,
    ignoreExisting: true,
  });
}

async function writePdfBytesIfMissing(
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  const pdfPath = getUploadPdfPath(hash);
  if (await ioUtils.exists(pdfPath)) return;
  await ioUtils.write(pdfPath, bytes);
}

async function saveContextPdfData(data: ContextPdfData): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  const normalized = normalizeContextPdfData(data);
  if (!normalized) return;
  await ensureStorageDir();
  const path =
    normalized.source === "library"
      ? getLibraryJsonPath(normalized.itemKey || "")
      : getUploadJsonPath(normalized.hash);
  await ioUtils.writeUTF8(path, JSON.stringify(normalized));
  rememberInMemory(normalized);
}

async function loadUploadContextPdfByHash(
  hash: string,
): Promise<ContextPdfData | null> {
  const safeHash = normalizeUploadHash(hash);
  if (!safeHash) return null;
  const memKey = uploadMemoryKey(safeHash);
  const fromMemory = memoryCache.get(memKey);
  if (fromMemory) return fromMemory;
  const ioUtils = getIOUtils();
  if (!ioUtils) return null;
  const filePath = getUploadJsonPath(safeHash);
  try {
    if (!(await ioUtils.exists(filePath))) return null;
    const raw = await ioUtils.readUTF8(filePath);
    const parsed = normalizeContextPdfData(JSON.parse(raw));
    if (!parsed || parsed.source !== "upload") return null;
    rememberInMemory(parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function loadLibraryContextPdfByItemKey(
  itemKey: string,
): Promise<ContextPdfData | null> {
  const safeKey = String(itemKey || "").trim();
  if (!ITEM_KEY_REGEX.test(safeKey)) return null;
  const memKey = libraryMemoryKey(safeKey);
  const fromMemory = memoryCache.get(memKey);
  if (fromMemory) return fromMemory;
  const ioUtils = getIOUtils();
  if (!ioUtils) return null;
  const filePath = getLibraryJsonPath(safeKey);
  try {
    if (!(await ioUtils.exists(filePath))) return null;
    const raw = await ioUtils.readUTF8(filePath);
    const parsed = normalizeContextPdfData(JSON.parse(raw));
    if (!parsed || parsed.source !== "library") return null;
    rememberInMemory(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function rememberInMemory(data: ContextPdfData): void {
  const memKey =
    data.source === "library"
      ? libraryMemoryKey(data.itemKey || "")
      : uploadMemoryKey(data.hash);
  if (!memKey) return;
  if (memoryCache.has(memKey)) memoryCache.delete(memKey);
  memoryCache.set(memKey, data);
  while (memoryCache.size > MEMORY_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

// =============== Internal: parsing ===============

async function parseUploadPdfBytes(
  bytes: Uint8Array,
): Promise<{ pages: StructuredPage[]; fullText: string }> {
  const fresh = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const result = await runPdfWorkerGetFullText(fresh);
  const fullText = String(result?.text || "").trim();
  const pageChars = Array.isArray(result?.pageChars) ? result.pageChars : [];
  const pages = splitPdfTextToPages(fullText, pageChars);
  if (pages.length > 0) return { pages, fullText };
  if (!fullText) {
    throw new Error(
      "Failed to extract text from the uploaded PDF. It may be image-only and need OCR.",
    );
  }
  return {
    pages: [{ pageNumber: 1, blocks: [], plainText: fullText }],
    fullText,
  };
}

async function runPdfWorkerGetFullText(
  buf: ArrayBuffer,
): Promise<{ text: string; pageChars: number[] }> {
  const worker = (Zotero as any).PDFWorker;
  if (!worker) {
    throw new Error("Zotero.PDFWorker is unavailable.");
  }
  if (typeof worker._query !== "function" || typeof worker._enqueue !== "function") {
    throw new Error(
      "Zotero.PDFWorker internals are unavailable; cannot parse local PDF without a Zotero item.",
    );
  }
  try {
    const result = await worker._enqueue(
      async () => {
        const queryBuf = cloneArrayBuffer(buf);
        return worker._query(
          "getFulltext",
          { buf: queryBuf, maxPages: null, password: "" },
          [queryBuf],
        );
      },
      true,
    );
    return {
      text: String(result?.text || ""),
      pageChars: Array.isArray(result?.pageChars) ? result.pageChars : [],
    };
  } catch (e: any) {
    const reason = e?.message ? `: ${e.message}` : "";
    throw new Error(`PDFWorker failed to parse uploaded PDF${reason}`);
  }
}

function cloneArrayBuffer(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0);
}

async function readLocalPdfBytes(path: string): Promise<Uint8Array> {
  const ioUtils = getIOUtils();
  if (!ioUtils?.read) {
    throw new Error("IOUtils.read is unavailable; cannot read local PDF.");
  }
  const raw = await ioUtils.read(path);
  const bytes = toUint8Array(raw);
  if (bytes) return bytes;
  throw new Error(`Failed to read local PDF bytes (${describeValue(raw)}).`);
}

function toUint8Array(value: any): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (isArrayBufferLike(value)) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (isByteArrayLike(value)) return Uint8Array.from(value);
  return null;
}

function isArrayBufferLike(value: any): value is ArrayBuffer {
  return (
    value &&
    typeof value === "object" &&
    typeof value.byteLength === "number" &&
    typeof value.slice === "function" &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isByteArrayLike(value: any): value is ArrayLike<number> {
  return (
    value &&
    typeof value === "object" &&
    typeof value.length === "number" &&
    value.length >= 0 &&
    Number.isFinite(value.length) &&
    (value.length === 0 || typeof value[0] === "number")
  );
}

function describeValue(value: any): string {
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  const tag = Object.prototype.toString.call(value);
  const ctor = value?.constructor?.name ? `/${value.constructor.name}` : "";
  const length =
    typeof value?.byteLength === "number"
      ? ` byteLength=${value.byteLength}`
      : typeof value?.length === "number"
        ? ` length=${value.length}`
        : "";
  return `${tag}${ctor}${length}`;
}

function splitPdfTextToPages(
  fullText: string,
  pageCharsRaw: any,
): StructuredPage[] {
  const text = String(fullText || "");
  const pageChars = Array.isArray(pageCharsRaw) ? pageCharsRaw : [];
  const pages: StructuredPage[] = [];

  if (pageChars.length > 0) {
    let offset = 0;
    for (let i = 0; i < pageChars.length; i++) {
      const count = Math.max(0, Math.floor(Number(pageChars[i]) || 0));
      const nextOffset = Math.min(text.length, offset + count);
      const pageText = text.slice(offset, nextOffset).trim();
      pages.push({
        pageNumber: i + 1,
        blocks: [],
        plainText: pageText,
      });
      offset = Math.max(offset, nextOffset);
    }
    const nonEmpty = pages.filter((p) => String(p.plainText || "").trim());
    if (nonEmpty.length > 0) return nonEmpty;
  }

  const byFormFeed = text
    .split("\f")
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (byFormFeed.length > 0) {
    return byFormFeed.map((plainText, idx) => ({
      pageNumber: idx + 1,
      blocks: [],
      plainText,
    }));
  }
  return [];
}

// =============== Internal: overview / metadata helpers ===============

async function generateReferenceOverview(
  pages: StructuredPage[],
  fallbackFullText: string,
  fileName: string,
  options: AddContextPdfOptions,
): Promise<string> {
  const maxTokens = Math.max(
    1200,
    Math.floor(Number(options.maxContextTokens || 16000) * 0.3),
  );
  const fullTextForPrompt =
    formatStructuredPagesForPrompt(pages) || String(fallbackFullText || "");
  const clipped = truncateDocContext(fullTextForPrompt, maxTokens);
  let overview = "";
  try {
    const prompts = initContextPdfPrompt(clipped);
    const result = await AIService.chat(prompts as any, {
      stream: false,
      disableThinking: true,
      model: options.miniModel,
      timeoutMs: 180000,
    });
    overview = String(result.content || "").trim();
  } catch (e) {
    ztoolkit.log("[Agent] context-pdf overview generation failed:", e);
  }
  if (!overview) overview = buildFallbackOverview(pages, fileName);
  return overview;
}

function buildFallbackOverview(
  pages: StructuredPage[],
  fileName: string,
): string {
  const preview = (pages || [])
    .slice(0, 3)
    .map((page) => {
      const content = String(page.plainText || "")
        .replace(/\s+/g, " ")
        .trim();
      const clipped =
        content.length > 450 ? `${content.slice(0, 450)}...` : content;
      return `- [p.${page.pageNumber}] ${clipped}`;
    })
    .join("\n");
  const lines = [
    "## Paper Metadata",
    `- File: ${fileName}`,
    "",
    "## Abstract / TL;DR",
    "- Reference paper. LLM overview generation failed; using text preview fallback.",
    "",
    "## Section Index",
    preview || "- No readable text found.",
  ];
  return lines.join("\n").trim();
}

async function resolveAttachmentFileName(attachment: any): Promise<string> {
  try {
    const parent = typeof attachment.parentItem === "object" && attachment.parentItem
      ? attachment.parentItem
      : attachment.parentID
        ? Zotero.Items.get(Number(attachment.parentID))
        : null;
    const parentTitle =
      String(
        parent?.getDisplayTitle?.() || parent?.getField?.("title") || "",
      ).trim();
    if (parentTitle) return parentTitle;
    const ownTitle = String(
      attachment?.getDisplayTitle?.() || attachment?.getField?.("title") || "",
    ).trim();
    if (ownTitle) return ownTitle;
    const fname = String(attachment?.getFilename?.() || "").trim();
    if (fname) return fname;
  } catch (_e) {
    // ignore
  }
  return "Library PDF";
}

async function resolveAttachmentFileSize(attachment: any): Promise<number> {
  try {
    const path = String(attachment?.getFilePath?.() || "");
    if (!path) return 0;
    const ioUtils = getIOUtils();
    if (!ioUtils?.stat) return 0;
    const info = await ioUtils.stat(path);
    return Math.max(0, Number(info?.size) || 0);
  } catch {
    return 0;
  }
}

function normalizeContextPdfData(raw: any): ContextPdfData | null {
  if (!raw || typeof raw !== "object") return null;
  const source: ContextPdfSource =
    raw.source === "library" ? "library" : "upload";
  const pagesRaw = Array.isArray(raw.pages) ? raw.pages : [];
  const pages: StructuredPage[] = pagesRaw
    .map((p: any, index: number) => ({
      pageNumber: Math.max(1, Math.floor(Number(p?.pageNumber) || index + 1)),
      blocks: Array.isArray(p?.blocks) ? p.blocks : [],
      plainText: String(p?.plainText || ""),
    }))
    .filter((p: StructuredPage) => String(p.plainText || "").trim());
  if (pages.length === 0) return null;

  let hash = "";
  let itemKey: string | undefined;
  if (source === "library") {
    itemKey = String(raw.itemKey || "").trim().toUpperCase();
    if (!ITEM_KEY_REGEX.test(itemKey)) return null;
    hash = libraryHashKey(itemKey);
  } else {
    hash = normalizeUploadHash(raw.hash);
    if (!hash) return null;
  }

  return {
    version: Number(raw.version) || CACHE_VERSION,
    source,
    hash,
    itemKey,
    itemId:
      typeof raw.itemId === "number" && Number.isFinite(raw.itemId)
        ? Number(raw.itemId)
        : undefined,
    fileName: String(raw.fileName || (source === "library" ? "Library PDF" : "reference.pdf")),
    fileSize: Math.max(0, Number(raw.fileSize) || 0),
    totalPages: Math.max(1, Number(raw.totalPages) || pages.length),
    pages,
    overview: String(raw.overview || "").trim(),
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

async function safeRemove(ioUtils: any, path: string): Promise<void> {
  try {
    await ioUtils.remove(path, { ignoreAbsent: true });
  } catch (_e) {
    // ignore delete failures
  }
}
