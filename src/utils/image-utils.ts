export function getImageMimeType(dataUrl: string): string {
  const m = /^data:([^;,]+)[;,]/i.exec(dataUrl || "");
  return (m?.[1] || "image/png").toLowerCase();
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = String(dataUrl || "").indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}
