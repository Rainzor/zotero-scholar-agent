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

export function getPaperOverviewDir(): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join) {
    return pathUtils.join(Zotero.DataDirectory.dir, "zoteroagent", "papers");
  }
  return `${Zotero.DataDirectory.dir}/zoteroagent/papers`;
}

export function getPaperOverviewPath(itemKey: string): string {
  const pathUtils = getPathUtils();
  const fileName = `${safeItemKey(itemKey)}.md`;
  if (pathUtils?.join) {
    return pathUtils.join(getPaperOverviewDir(), fileName);
  }
  return `${getPaperOverviewDir()}/${fileName}`;
}

async function ensureOverviewDir(): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  await ioUtils.makeDirectory(getPaperOverviewDir(), {
    createAncestors: true,
    ignoreExisting: true,
  });
}

export async function loadPaperOverview(
  itemKey: string,
): Promise<string | null> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return null;
  try {
    const path = getPaperOverviewPath(itemKey);
    if (!(await ioUtils.exists(path))) return null;
    const content = await ioUtils.readUTF8(path);
    return content?.trim() ? String(content) : null;
  } catch {
    return null;
  }
}

export async function savePaperOverview(
  itemKey: string,
  content: string,
): Promise<void> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return;
  await ensureOverviewDir();
  await ioUtils.writeUTF8(getPaperOverviewPath(itemKey), String(content || ""));
}

export async function hasPaperOverview(itemKey: string): Promise<boolean> {
  const ioUtils = getIOUtils();
  if (!ioUtils) return false;
  try {
    return Boolean(await ioUtils.exists(getPaperOverviewPath(itemKey)));
  } catch {
    return false;
  }
}
