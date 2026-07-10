import type { PaperVaultMeta } from "./codex/vault-format";
import type { ZoteroCollectionSignal } from "./knowledge-surface";

export function getZoteroPaperMeta(itemId: number): PaperVaultMeta {
  const attachment = Zotero.Items.get(itemId) as any;
  if (!attachment) throw new Error(`Zotero item ${itemId} was not found.`);
  const source =
    Number(attachment.parentItemID) > 0
      ? (Zotero.Items.get(Number(attachment.parentItemID)) as any) || attachment
      : attachment;
  try {
    const creators = (source?.getCreators?.() || [])
      .map((creator: any) =>
        [creator?.firstName, creator?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim(),
      )
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const date = String(source?.getField?.("date") || "");
    return {
      itemId,
      itemKey: String(attachment?.key || itemId),
      title: String(
        source?.getField?.("title") ||
          source?.getDisplayTitle?.() ||
          attachment?.getField?.("title") ||
          `Item ${itemId}`,
      ),
      creators,
      year: (date.match(/\b(18|19|20)\d{2}\b/) || [""])[0],
      abstract: String(source?.getField?.("abstractNote") || "").trim(),
      zoteroCollections: getCollectionSignals(source),
      zoteroTags:
        typeof source?.getTags === "function"
          ? source
              .getTags()
              .map((tag: any) => String(tag?.tag || "").trim())
              .filter(Boolean)
          : undefined,
    };
  } catch (error) {
    (globalThis as any).ztoolkit?.log?.(
      "[Agent] Failed to read Zotero paper metadata:",
      error,
    );
    return {
      itemId,
      itemKey: String(attachment.key || itemId),
      title: String(
        source?.getField?.("title") ||
          source?.getDisplayTitle?.() ||
          `Item ${itemId}`,
      ),
    };
  }
}

function getCollectionSignals(
  item: any,
): ZoteroCollectionSignal[] | undefined {
  if (typeof item?.getCollections !== "function") return undefined;
  const ids = Array.isArray(item.getCollections()) ? item.getCollections() : [];
  return ids
    .map((id: number) => {
      const collection = Zotero.Collections?.get?.(id) as any;
      if (!collection) return null;
      return {
        key: String(collection.key || id),
        name: String(collection.name || collection.key || id),
        path: buildCollectionPath(collection),
      };
    })
    .filter(Boolean) as ZoteroCollectionSignal[];
}

function buildCollectionPath(collection: any): string {
  const names: string[] = [];
  const seen = new Set<number>();
  let current = collection;
  while (current) {
    const id = Number(current.id);
    if (id && seen.has(id)) break;
    if (id) seen.add(id);
    const name = String(current.name || "").trim();
    if (name) names.unshift(name);
    const parentId = Number(current.parentID);
    current = parentId ? Zotero.Collections?.get?.(parentId) : null;
  }
  return names.join(" / ") || String(collection.name || "");
}
