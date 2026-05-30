export type LocalPdfMatch = {
  inputPath: string;
  filePath: string;
  fileName: string;
  fileSize: number;
};

type ResolveOptions = {
  maxDepth?: number;
  maxEntries?: number;
};

export function extractLocalPathCandidates(text: string): string[] {
  const raw = String(text || "");
  const candidates: string[] = [];
  const pdfCandidates: string[] = [];
  const quoted = /["'`]((?:file:\/\/\/|\/)[\s\S]*?)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(raw))) {
    candidates.push(match[1]);
  }

  const unquotedPdf = /(?:^|[\s:：])((?:file:\/\/\/|\/)[\s\S]*?\.pdf)(?=$|[\s"'`<>，。；;!?！？])/gi;
  while ((match = unquotedPdf.exec(raw))) {
    pdfCandidates.push(match[1]);
  }

  const unquoted = /(?:^|[\s:：])((?:file:\/\/\/|\/)[^\s"'`<>]+)/g;
  while ((match = unquoted.exec(raw))) {
    candidates.push(match[1]);
  }

  const normalizedPdfs = normalizeCandidates(pdfCandidates).filter(looksLikePdf);
  if (normalizedPdfs.length > 0) return normalizedPdfs;

  return normalizeCandidates(candidates);
}

function normalizeCandidates(candidates: string[]): string[] {
  return Array.from(
    new Set(
      candidates
        .map(normalizeLocalPathCandidate)
        .filter(isPlausibleLocalPath)
        .filter((path): path is string => Boolean(path)),
    ),
  );
}

export async function resolveLocalPdfPath(
  rawPath: string,
  options: ResolveOptions = {},
): Promise<LocalPdfMatch> {
  const inputPath = normalizeLocalPathCandidate(rawPath);
  if (!inputPath) throw new Error("No local file path found.");

  const direct = await resolvePdfFile(inputPath, inputPath);
  if (direct) return direct;

  const nested = await findPdfInDirectory(inputPath, {
    maxDepth: options.maxDepth ?? 3,
    maxEntries: options.maxEntries ?? 300,
  });
  if (nested) return nested;

  throw new Error(`No readable PDF found at ${inputPath}.`);
}

export function normalizeLocalPathCandidate(rawPath: string): string {
  let path = String(rawPath || "").trim();
  if (!path) return "";
  path = path.replace(/^[([{]+/, "").replace(/[)\]}]+$/, "");
  path = path.replace(/[。．，,;；]+$/g, "");
  if (path.startsWith("file://")) {
    path = path.replace(/^file:\/\//, "");
    if (!path.startsWith("/")) path = `/${path}`;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the original path if percent decoding fails.
    }
  }
  return path.replace(/\\ /g, " ");
}

async function findPdfInDirectory(
  dirPath: string,
  options: Required<ResolveOptions>,
): Promise<LocalPdfMatch | null> {
  const queue: Array<{ path: string; depth: number }> = [
    { path: dirPath, depth: 0 },
  ];
  const seen = new Set<string>();
  const matches: LocalPdfMatch[] = [];
  let visitedEntries = 0;

  while (queue.length > 0 && visitedEntries < options.maxEntries) {
    const current = queue.shift();
    if (!current || seen.has(current.path)) continue;
    seen.add(current.path);

    const children = await getChildren(current.path);
    if (!children.length) continue;

    for (const child of children) {
      if (visitedEntries >= options.maxEntries) break;
      visitedEntries += 1;
      if (looksLikePdf(child)) {
        const pdf = await resolvePdfFile(child, dirPath);
        if (pdf) matches.push(pdf);
        continue;
      }
      if (current.depth < options.maxDepth) {
        queue.push({ path: child, depth: current.depth + 1 });
      }
    }
  }

  matches.sort((a, b) => b.fileSize - a.fileSize);
  return matches[0] || null;
}

async function resolvePdfFile(
  filePath: string,
  inputPath: string,
): Promise<LocalPdfMatch | null> {
  if (!looksLikePdf(filePath)) return null;
  if (!(await exists(filePath))) return null;
  return {
    inputPath,
    filePath,
    fileName: getBaseName(filePath) || "local.pdf",
    fileSize: await statSize(filePath),
  };
}

function looksLikePdf(path: string): boolean {
  return /\.pdf$/i.test(String(path || "").trim());
}

function isPlausibleLocalPath(path: string): boolean {
  const value = String(path || "").trim();
  if (!value) return false;
  if (looksLikePdf(value)) return true;
  return value.split("/").filter(Boolean).length >= 2;
}

async function exists(path: string): Promise<boolean> {
  const ioUtils = getIOUtils();
  try {
    return Boolean(ioUtils?.exists && (await ioUtils.exists(path)));
  } catch {
    return false;
  }
}

async function getChildren(path: string): Promise<string[]> {
  const ioUtils = getIOUtils();
  try {
    if (!ioUtils?.getChildren) return [];
    const children = await ioUtils.getChildren(path);
    return Array.isArray(children) ? children.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function statSize(path: string): Promise<number> {
  const ioUtils = getIOUtils();
  try {
    if (!ioUtils?.stat) return 0;
    const info = await ioUtils.stat(path);
    return Math.max(0, Number(info?.size) || 0);
  } catch {
    return 0;
  }
}

function getBaseName(path: string): string {
  return (
    String(path || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ""
  );
}

function getIOUtils(): any {
  return (globalThis as any).IOUtils;
}
