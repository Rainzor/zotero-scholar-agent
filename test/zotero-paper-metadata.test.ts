import { afterEach, describe, expect, it } from "vitest";
import { getZoteroPaperMeta } from "../src/services/zotero-paper-metadata";

const originalZotero = (globalThis as any).Zotero;

afterEach(() => {
  (globalThis as any).Zotero = originalZotero;
});

describe("getZoteroPaperMeta", () => {
  it("uses the attachment key but mirrors metadata from the parent item", () => {
    const items = new Map<number, any>([
      [
        10,
        {
          id: 10,
          key: "PDFKEY",
          parentItemID: 1,
          isAttachment: () => true,
        },
      ],
      [
        1,
        {
          id: 1,
          key: "PARENT",
          getField: (field: string) =>
            ({
              title: "Paper",
              date: "2025",
              abstractNote: "Source abstract.",
            })[field] || "",
          getCreators: () => [{ firstName: "A", lastName: "Researcher" }],
          getCollections: () => [20],
          getTags: () => [{ tag: "Diffusion" }, { tag: "Video" }],
        },
      ],
    ]);
    const collections = new Map<number, any>([
      [20, { id: 20, key: "CHILD", name: "Video", parentID: 21 }],
      [21, { id: 21, key: "ROOT", name: "Research", parentID: null }],
    ]);
    (globalThis as any).Zotero = {
      Items: { get: (id: number) => items.get(id) },
      Collections: { get: (id: number) => collections.get(id) },
    };

    expect(getZoteroPaperMeta(10)).toEqual({
      itemId: 10,
      itemKey: "PDFKEY",
      title: "Paper",
      creators: "A Researcher",
      year: "2025",
      abstract: "Source abstract.",
      zoteroCollections: [
        { key: "CHILD", name: "Video", path: "Research / Video" },
      ],
      zoteroTags: ["Diffusion", "Video"],
    });
  });

  it("does not erase mirrored signals when Zotero metadata reads fail", () => {
    (globalThis as any).Zotero = {
      Items: {
        get: () => ({
          id: 10,
          key: "PDFKEY",
          getField: (field: string) => (field === "title" ? "Paper" : ""),
          getTags: () => {
            throw new Error("database unavailable");
          },
        }),
      },
      Collections: { get: () => null },
    };
    expect(getZoteroPaperMeta(10)).toEqual({
      itemId: 10,
      itemKey: "PDFKEY",
      title: "Paper",
    });
  });
});
