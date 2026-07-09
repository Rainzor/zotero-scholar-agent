import { config } from "../../package.json";
import { loadPageCache } from "../services/page-cache";

function getZToolkit(): any {
  return (Zotero as any)[config.addonInstance]?.data?.ztoolkit;
}

export async function getFullText(itemId: number): Promise<string> {
  try {
    const activeReader = await getTargetReader(null);
    const activeItemId = Number((activeReader as any)?.itemID || 0);
    const itemKey = resolveItemKey(activeReader);
    if (activeItemId && activeItemId === itemId && itemKey) {
      const cache = await loadPageCache(itemKey);
      if (cache?.pages?.length) {
        const joined = cache.pages
          .map((p) => String(p?.plainText || "").trim())
          .filter(Boolean)
          .join("\n");
        if (joined) return trimReferences(joined);
      }
    }
    const fullText = await Zotero.PDFWorker.getFullText(itemId, null);
    return trimReferences((fullText?.text as string) || "");
  } catch {
    return "";
  }
}

function trimReferences(content: string) {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) =>
    /^(references|bibliography|参考文献|acknowledgements?)$/i.test(line.trim()),
  );
  return (index >= 0 ? lines.slice(0, index) : lines).join("\n").trim();
}

async function getTargetReader(
  reader?: _ZoteroTypes.ReaderInstance | null,
): Promise<_ZoteroTypes.ReaderInstance | null> {
  if (reader) return reader;
  const tk = getZToolkit();
  return ((await tk?.Reader?.getReader()) as any) || null;
}

function resolveItemKey(reader?: _ZoteroTypes.ReaderInstance | null): string {
  const candidate =
    (reader as any)?.itemKey ||
    (reader as any)?._item?.key ||
    (reader as any)?._itemKey ||
    "";
  return String(candidate || "").trim();
}
