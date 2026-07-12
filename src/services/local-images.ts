import { getPaperVaultPaths, getVaultDir } from "./codex";

export type LocalImageRef = {
  id: string;
  sessionId?: string;
  relativePath: string;
  name: string;
  mimeType: string;
  pageNumber?: number;
  previewUrl?: string;
};

export async function saveLocalClipboardImage(options: {
  itemKey: string;
  file: File;
  previewUrl?: string;
  sessionId?: string;
}): Promise<LocalImageRef> {
  const paths = await getPaperVaultPaths(options.itemKey);
  const ioUtils = getIOUtils();
  const dir = joinPath(paths.paperDir, "figures", "local");
  await ioUtils.makeDirectory(dir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const extension = imageExtension(options.file.type);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = `clipboard-${id}.${extension}`;
  const absolutePath = joinPath(dir, name);
  const bytes = new Uint8Array(await options.file.arrayBuffer());
  await ioUtils.write(absolutePath, bytes);
  return {
    id,
    sessionId: options.sessionId,
    relativePath: `${options.itemKey}/figures/local/${name}`,
    name,
    mimeType: options.file.type || `image/${extension}`,
    previewUrl: options.previewUrl,
  };
}

export async function resolveLocalImagePaths(
  refs: LocalImageRef[],
): Promise<string[]> {
  const vaultDir = await getVaultDir();
  return refs.map((ref) => joinPath(vaultDir, ref.relativePath));
}

export async function deleteLocalImage(ref: LocalImageRef): Promise<void> {
  try {
    const [path] = await resolveLocalImagePaths([ref]);
    await getIOUtils().remove(path, { ignoreAbsent: true });
  } catch {
    // Local evidence cleanup is best-effort.
  }
}

function imageExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
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
