import { config } from "../../package.json";

function getZToolkit(): any {
  // @ts-ignore - Access ztoolkit through Zotero global (works in both sandbox & window contexts)
  return Zotero[config.addonInstance]?.data?.ztoolkit;
}

export async function getSelectedText(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<string> {
  try {
    const tk = getZToolkit();
    const targetReader =
      reader || (await tk?.Reader?.getReader()) || undefined;
    if (!targetReader) {
      return "";
    }
    return tk.Reader.getSelectedText(targetReader) || "";
  } catch {
    return "";
  }
}

export async function getFullText(itemId: number): Promise<string> {
  try {
    const fullText = await Zotero.PDFWorker.getFullText(itemId, null);
    return trimReferences((fullText?.text as string) || "");
  } catch {
    return "";
  }
}

export async function getCurrentPageText(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<string> {
  try {
    const tk = getZToolkit();
    const targetReader = reader || ((await tk?.Reader?.getReader()) as any);
    if (!targetReader?._iframeWindow) {
      return "";
    }
    const wrapped = (targetReader._iframeWindow as any).wrappedJSObject;
    const pageIndex = wrapped?.PDFViewerApplication?.pdfViewer?.currentPageNumber;
    const itemId = targetReader.itemID;
    if (!itemId || !pageIndex) {
      return "";
    }
    const fullText = await Zotero.PDFWorker.getFullText(itemId, null);
    const lines = ((fullText?.text as string) || "").split("\n");
    const windowSize = 180;
    const start = Math.max(0, (pageIndex - 1) * windowSize);
    return lines.slice(start, start + windowSize).join("\n");
  } catch {
    return "";
  }
}

export async function getContextByMode(options: {
  mode: "none" | "currentPage" | "selectedText" | "fullPdf";
  reader?: _ZoteroTypes.ReaderInstance | null;
  itemId?: number;
  selectedText?: string;
}) {
  const { mode, reader, selectedText } = options;
  if (mode === "none") {
    return "";
  }
  if (mode === "selectedText") {
    return selectedText || (await getSelectedText(reader));
  }
  if (mode === "fullPdf") {
    const itemId = options.itemId || reader?.itemID;
    return itemId ? await getFullText(itemId) : "";
  }
  return getCurrentPageText(reader);
}

function trimReferences(content: string) {
  if (!content) {
    return "";
  }
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) =>
    /^(references|bibliography|参考文献|acknowledgements?)$/i.test(line.trim()),
  );
  return (index >= 0 ? lines.slice(0, index) : lines).join("\n").trim();
}
