import {
  commitVaultChanges,
  getVaultDir,
  runCodexTurn,
  runLineProcess,
  writeEnrichedPaperText,
  type PaperVaultMeta,
  type RunningLineProcess,
} from "./codex";

export type PdfEnrichmentCapabilities = {
  pdftoppm?: string;
  pdfinfo?: string;
  python3?: string;
  available: boolean;
  missing: string[];
};

export function validateEnrichedPdfText(
  text: string,
  pageCount: number,
):
  | { ok: true; pageNumbers: number[] }
  | { ok: false; pageNumbers: number[]; reason: string } {
  const pageNumbers = Array.from(
    String(text || "").matchAll(/\[page\s+([1-9][0-9]*)\]/gi),
  ).map((match) => Number(match[1]));
  const expected = Array.from({ length: pageCount }, (_, index) => index + 1);
  const valid =
    pageCount > 0 &&
    pageNumbers.length === expected.length &&
    pageNumbers.every((value, index) => value === expected[index]);
  return valid
    ? { ok: true, pageNumbers }
    : {
        ok: false,
        pageNumbers,
        reason: `Expected page markers 1..${pageCount}, received ${
          pageNumbers.join(", ") || "none"
        }.`,
      };
}

export function parsePdfInfoPageCount(output: string): number | undefined {
  const match = String(output || "").match(/^Pages:\s+([1-9][0-9]*)\s*$/im);
  const count = Number(match?.[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

export async function probePdfEnrichmentCapabilities(): Promise<PdfEnrichmentCapabilities> {
  const [pdftoppm, pdfinfo, python3] = await Promise.all([
    findExecutable("pdftoppm"),
    findExecutable("pdfinfo"),
    findExecutable("python3"),
  ]);
  const missing = [
    !pdftoppm ? "pdftoppm" : "",
    !pdfinfo ? "pdfinfo" : "",
    !python3 ? "python3" : "",
  ].filter(Boolean);
  return {
    pdftoppm: pdftoppm || undefined,
    pdfinfo: pdfinfo || undefined,
    python3: python3 || undefined,
    available: missing.length === 0,
    missing,
  };
}

export async function parseScannedPdfWithCodex(options: {
  paper: PaperVaultMeta;
  pdfPath: string;
  model?: string;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
}): Promise<{ pageCount: number; committed: boolean }> {
  const capabilities = await probePdfEnrichmentCapabilities();
  if (!capabilities.available || !capabilities.pdfinfo) {
    throw new Error(
      `PDF enrichment dependencies are missing: ${capabilities.missing.join(", ")}.`,
    );
  }
  const pageCount = await readPdfPageCount(
    options.pdfPath,
    capabilities.pdfinfo,
  );
  if (!pageCount) throw new Error("Could not determine PDF page count.");
  const vaultDir = await getVaultDir();
  const outputDir = joinPath(vaultDir, ".generated", options.paper.itemKey);
  const outputPath = joinPath(outputDir, "ocr-text.txt");
  await getIOUtils().makeDirectory(outputDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  options.onStatus?.("Parsing scanned PDF with Codex...");
  await runCodexTurn({
    prompt: buildScannedPdfPrompt(
      options.paper,
      options.pdfPath,
      outputPath,
      pageCount,
    ),
    model: options.model,
    fallbackToDefaultModel: options.model ? false : undefined,
    sandbox: "workspace-write",
    onStatus: options.onStatus,
    onProcess: options.onProcess,
  });
  const text = String(await getIOUtils().readUTF8(outputPath));
  const validation = validateEnrichedPdfText(text, pageCount);
  if (!validation.ok) throw new Error(validation.reason);
  await writeEnrichedPaperText(options.paper.itemKey, text, "codex-ocr");
  const committed = await commitVaultChanges(
    `parse scanned PDF: ${options.paper.itemKey}`,
  );
  return { pageCount, committed };
}

async function readPdfPageCount(
  pdfPath: string,
  pdfinfo: string,
): Promise<number | undefined> {
  const result = await runLineProcess({
    command: pdfinfo,
    arguments: [pdfPath],
    timeoutMs: 30000,
  });
  if (result.exitCode !== 0) return undefined;
  return parsePdfInfoPageCount(`${result.stdout}\n${result.stderr}`);
}

function buildScannedPdfPrompt(
  paper: PaperVaultMeta,
  pdfPath: string,
  outputPath: string,
  pageCount: number,
): string {
  return `Extract text from this scanned PDF using the available PDF/OCR tools.

PDF: ${pdfPath}
Output: ${outputPath}
Expected pages: ${pageCount}

Write UTF-8 plain text to the output path. Include every page exactly once with
monotonic markers [page 1] through [page ${pageCount}], including a marker for
pages with no recognized text. Do not edit memory.md, record.json, or any other
Vault file. Return a short confirmation after writing the output.`;
}

async function findExecutable(name: string): Promise<string> {
  for (const path of [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ]) {
    try {
      if (await getIOUtils().exists(path)) return path;
    } catch {
      // Try the next location.
    }
  }
  return "";
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
