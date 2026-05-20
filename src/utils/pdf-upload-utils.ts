export const MAX_CONTEXT_PDF_SIZE_BYTES = 50 * 1024 * 1024;

export function isPdfFile(file: File | null | undefined): boolean {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (type === "application/pdf") return true;
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".pdf");
}

export async function sha256OfFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return sha256OfBytes(new Uint8Array(buffer));
}

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const cryptoObj = (globalThis as any).crypto;
  const subtle = cryptoObj?.subtle;
  if (!subtle?.digest) {
    throw new Error("Web Crypto API is unavailable in this environment.");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export function formatFileSize(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  const fixed = size >= 100 || i === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(fixed)} ${units[i]}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}
