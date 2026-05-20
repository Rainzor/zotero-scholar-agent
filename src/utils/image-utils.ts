export const MAX_PENDING_IMAGES = 10;
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

export function isImageFile(file: File): boolean {
  return Boolean(file?.type && file.type.startsWith("image/"));
}

export function extractImagesFromClipboard(event: ClipboardEvent): File[] {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return [];

  const files: File[] = [];
  const seen = new Set<string>();
  const pushIfImage = (file: File | null) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  if (clipboardData.files?.length) {
    for (const file of Array.from(clipboardData.files)) {
      pushIfImage(file);
    }
  }
  if (clipboardData.items?.length) {
    for (const item of Array.from(clipboardData.items)) {
      if (item.kind !== "file") continue;
      pushIfImage(item.getAsFile());
    }
  }
  return files;
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export function getImageMimeType(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/i.exec(dataUrl || "");
  return (m?.[1] || "image/png").toLowerCase();
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = String(dataUrl || "").indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

export async function optimizeImage(
  dataUrl: string,
  maxWidth = 1600,
  maxQuality = 0.85,
): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    const srcW = img.naturalWidth || img.width || 0;
    const srcH = img.naturalHeight || img.height || 0;
    if (!srcW || !srcH) return dataUrl;

    const scale = srcW > maxWidth ? maxWidth / srcW : 1;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const doc = globalThis.document;
    if (!doc?.createElement) return dataUrl;
    const canvas = doc.createElement("canvas");
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, dstW, dstH);

    const mime = getImageMimeType(dataUrl);
    const lossy =
      mime === "image/jpeg" || mime === "image/jpg" || mime === "image/webp";
    const next = lossy
      ? canvas.toDataURL(mime, clampQuality(maxQuality))
      : canvas.toDataURL(mime);

    // Keep original if optimization produced a larger payload.
    return next.length < dataUrl.length ? next : dataUrl;
  } catch (_e) {
    return dataUrl;
  }
}

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return 0.85;
  return Math.min(0.95, Math.max(0.4, q));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image."));
    img.src = src;
  });
}
