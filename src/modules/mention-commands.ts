export type MentionToken = {
  query: string;
  atStart: number;
  caretEnd: number;
};

export type MentionCandidate = {
  parentItemId: number;
  attachmentItemId: number;
  attachmentItemKey: string;
  title: string;
  subtitle: string;
  fileName: string;
  fileSize: number;
};

export function parseMentionToken(
  input: string,
  caret: number,
): MentionToken | null {
  const safeInput = typeof input === "string" ? input : "";
  if (!safeInput) return null;

  const normalizedCaret = Math.max(0, Math.min(caret, safeInput.length));
  let atIndex = safeInput.lastIndexOf("@", normalizedCaret - 1);
  while (atIndex >= 0) {
    if (atIndex === 0 || /\s/u.test(safeInput[atIndex - 1] || "")) {
      let tokenEnd = safeInput.length;
      const match = safeInput.slice(atIndex + 1).match(/\s/u);
      if (match?.index !== undefined) {
        tokenEnd = atIndex + 1 + match.index;
      }
      if (normalizedCaret <= tokenEnd) {
        return {
          query: safeInput.slice(
            atIndex + 1,
            Math.min(normalizedCaret, tokenEnd),
          ),
          atStart: atIndex,
          caretEnd: normalizedCaret,
        };
      }
    }
    atIndex = safeInput.lastIndexOf("@", atIndex - 1);
  }
  return null;
}

export function consumeMentionToken(
  input: string,
  token: MentionToken,
): { value: string; caret: number } {
  const before = input.slice(0, token.atStart);
  const after = input.slice(token.caretEnd);
  const value = `${before}${after}`;
  return {
    value,
    caret: token.atStart,
  };
}

export async function searchLibraryItemsForMention(
  query: string,
  limit = 8,
): Promise<MentionCandidate[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return await listRecentLibraryCandidates(limit);
  }
  const fromQuickSearch = await runQuickSearch(trimmed);
  if (fromQuickSearch.length > 0) {
    const candidates = await collectCandidatesFromItemIds(
      fromQuickSearch,
      limit,
    );
    if (candidates.length > 0) return candidates;
  }
  return await fallbackScanByTitleOrCreator(trimmed, limit);
}

async function runQuickSearch(query: string): Promise<number[]> {
  try {
    const libraryID = getUserLibraryID();
    const SearchCtor: any = (Zotero as any).Search;
    if (!SearchCtor) return [];
    const search = new SearchCtor();
    search.libraryID = libraryID;
    if (typeof search.addCondition === "function") {
      try {
        search.addCondition(
          "quicksearch-titleCreatorYearNote",
          "contains",
          query,
        );
      } catch {
        try {
          search.addCondition("title", "contains", query);
        } catch (_inner) {
          return [];
        }
      }
    }
    const result = await Promise.resolve(search.search());
    return Array.isArray(result) ? result.map((v: any) => Number(v)) : [];
  } catch (e) {
    ztoolkit.log("[Agent] @-mention quickSearch error:", e);
    return [];
  }
}

async function fallbackScanByTitleOrCreator(
  query: string,
  limit: number,
): Promise<MentionCandidate[]> {
  try {
    const libraryID = getUserLibraryID();
    const itemsApi: any = (Zotero as any).Items;
    if (typeof itemsApi?.getAll !== "function") return [];
    const topItems: any[] = await itemsApi.getAll(libraryID, true, false);
    const q = query.toLowerCase();
    const filtered: any[] = [];
    for (const it of topItems) {
      try {
        if (typeof it.isAttachment === "function" && it.isAttachment())
          continue;
        if (typeof it.isNote === "function" && it.isNote()) continue;
        const title = String(safeGetTitle(it)).toLowerCase();
        const creators = String(it.getField?.("firstCreator") || "").toLowerCase();
        if (title.includes(q) || creators.includes(q)) {
          filtered.push(it);
        }
        if (filtered.length >= limit * 4) break;
      } catch {
        continue;
      }
    }
    const ids = filtered.map((it) => Number(it.id)).filter(Boolean);
    return await collectCandidatesFromItemIds(ids, limit);
  } catch (e) {
    ztoolkit.log("[Agent] @-mention fallback scan error:", e);
    return [];
  }
}

async function listRecentLibraryCandidates(
  limit: number,
): Promise<MentionCandidate[]> {
  try {
    const libraryID = getUserLibraryID();
    const itemsApi: any = (Zotero as any).Items;
    if (typeof itemsApi?.getAll !== "function") return [];
    const topItems: any[] = await itemsApi.getAll(libraryID, true, false);
    const filtered = (topItems || []).filter((it: any) => {
      try {
        if (typeof it.isAttachment === "function" && it.isAttachment())
          return false;
        if (typeof it.isNote === "function" && it.isNote()) return false;
        return true;
      } catch {
        return false;
      }
    });
    filtered.sort((a: any, b: any) => {
      const ta = parseDate(a?.dateModified);
      const tb = parseDate(b?.dateModified);
      return tb - ta;
    });
    const ids = filtered
      .slice(0, Math.max(40, limit * 6))
      .map((it: any) => Number(it.id))
      .filter(Boolean);
    return await collectCandidatesFromItemIds(ids, limit);
  } catch (e) {
    ztoolkit.log("[Agent] @-mention recent fetch error:", e);
    return [];
  }
}

async function collectCandidatesFromItemIds(
  itemIds: number[],
  limit: number,
): Promise<MentionCandidate[]> {
  const seen = new Set<string>();
  const results: MentionCandidate[] = [];
  for (const id of itemIds) {
    if (results.length >= limit) break;
    let item: any = null;
    try {
      item = Zotero.Items.get(id);
    } catch (_e) {
      item = null;
    }
    if (!item) continue;
    let parentItem: any = item;
    try {
      if (typeof item.isAttachment === "function" && item.isAttachment()) {
        const parentId =
          (typeof item.parentID !== "undefined" && item.parentID) ||
          (typeof item.parentItemID !== "undefined" && item.parentItemID) ||
          (typeof item.getField === "function" && item.getField("parentItemID"));
        const resolved = parentId ? Zotero.Items.get(Number(parentId)) : null;
        if (resolved) parentItem = resolved;
      } else if (typeof item.isNote === "function" && item.isNote()) {
        continue;
      }
    } catch {
      // ignore
    }
    await ensureItemDataLoaded(parentItem);
    const pdfId = findPdfAttachmentForItem(parentItem);
    if (!pdfId) continue;
    const attachment: any = (() => {
      try {
        return Zotero.Items.get(pdfId);
      } catch {
        return null;
      }
    })();
    if (!attachment) continue;
    const attKey = String(attachment.key || "").toUpperCase();
    if (!attKey || seen.has(attKey)) continue;
    seen.add(attKey);
    const title =
      safeGetTitle(parentItem) || safeGetTitle(attachment) || "Untitled";
    results.push({
      parentItemId: Number(parentItem.id || 0),
      attachmentItemId: pdfId,
      attachmentItemKey: attKey,
      title,
      subtitle: buildSubtitle(parentItem),
      fileName: title,
      fileSize: 0,
    });
  }
  return results;
}

function findPdfAttachmentForItem(item: any): number {
  if (!item) return 0;
  try {
    if (typeof item.isAttachment === "function" && item.isAttachment()) {
      if (isPdfAttachment(item)) return Number(item.id);
      return 0;
    }
    if (typeof item.getAttachments !== "function") return 0;
    const ids: number[] = Array.isArray(item.getAttachments())
      ? item.getAttachments()
      : [];
    for (const aid of ids) {
      const child: any = (() => {
        try {
          return Zotero.Items.get(aid);
        } catch {
          return null;
        }
      })();
      if (!child) continue;
      if (!isPdfAttachment(child)) continue;
      return Number(child.id);
    }
  } catch (_e) {
    // ignore
  }
  return 0;
}

function isPdfAttachment(item: any): boolean {
  try {
    if (typeof item?.isPDFAttachment === "function" && item.isPDFAttachment())
      return true;
    if (item?.attachmentContentType === "application/pdf") return true;
    const fn = typeof item?.getFilename === "function" ? item.getFilename() : "";
    if (typeof fn === "string" && fn.toLowerCase().endsWith(".pdf")) return true;
  } catch {
    // ignore
  }
  return false;
}

async function ensureItemDataLoaded(item: any): Promise<void> {
  if (!item) return;
  try {
    if (typeof item.loadAllData === "function") {
      await item.loadAllData();
    } else if (typeof item.loadDataType === "function") {
      await item.loadDataType("primaryData");
      await item.loadDataType("itemData");
    }
  } catch (_e) {
    // ignore
  }
}

function safeGetTitle(item: any): string {
  try {
    const t = String(
      (typeof item?.getDisplayTitle === "function" && item.getDisplayTitle()) ||
        (typeof item?.getField === "function" && item.getField("title")) ||
        "",
    ).trim();
    if (t) return t;
    if (typeof item?.getFilename === "function") {
      const fn = String(item.getFilename() || "").trim();
      if (fn) return fn;
    }
  } catch {
    // ignore
  }
  return "";
}

function buildSubtitle(item: any): string {
  try {
    const creators = String(item?.getField?.("firstCreator") || "").trim();
    const year = String(item?.getField?.("year") || "").trim();
    if (creators && year) return `${creators} · ${year}`;
    return creators || year || "";
  } catch {
    return "";
  }
}

function getUserLibraryID(): number {
  try {
    const libs: any = (Zotero as any).Libraries;
    if (libs?.userLibraryID) return Number(libs.userLibraryID);
  } catch {
    // ignore
  }
  return 1;
}

function parseDate(value: any): number {
  if (!value) return 0;
  try {
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}
