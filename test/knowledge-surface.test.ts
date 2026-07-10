import { describe, expect, it } from "vitest";
import {
  parseKnowledgeSurface,
  updateKnowledgeSurfaceSignals,
} from "../src/services/knowledge-surface";

const BODY = `# Paper

> itemKey: AAAA1111

## Abstract

Original abstract.

## Contribution

Useful contribution.
`;

describe("Knowledge Surface frontmatter", () => {
  it("adds signal frontmatter without changing the Markdown body", () => {
    const updated = updateKnowledgeSurfaceSignals(BODY, {
      zoteroCollections: [
        { key: "C1", name: "Video", path: "Research / Video" },
      ],
      zoteroTags: ["diffusion", "video"],
    });

    const parsed = parseKnowledgeSurface(updated);
    expect(parsed.body).toBe(BODY);
    expect(parsed.signals).toEqual({
      rating: null,
      zoteroCollections: [
        { key: "C1", name: "Video", path: "Research / Video" },
      ],
      zoteroTags: ["diffusion", "video"],
      paperKeywords: [],
      codexKeywords: [],
    });
  });

  it("refreshes Zotero mirrors while preserving rating and accepted keywords", () => {
    const first = updateKnowledgeSurfaceSignals(BODY, {
      rating: 5,
      zoteroCollections: [{ key: "OLD", name: "Old", path: "Old" }],
      zoteroTags: ["old"],
      paperKeywords: ["causal video"],
      codexKeywords: ["distillation"],
    });
    const refreshed = updateKnowledgeSurfaceSignals(first, {
      zoteroCollections: [{ key: "NEW", name: "New", path: "New" }],
      zoteroTags: ["new"],
    });

    expect(parseKnowledgeSurface(refreshed).signals).toEqual({
      rating: 5,
      zoteroCollections: [{ key: "NEW", name: "New", path: "New" }],
      zoteroTags: ["new"],
      paperKeywords: ["causal video"],
      codexKeywords: ["distillation"],
    });
  });

  it("normalizes invalid ratings and duplicate signal values", () => {
    const updated = updateKnowledgeSurfaceSignals(BODY, {
      rating: 9,
      zoteroTags: ["Video", "video", "  Diffusion  "],
      paperKeywords: ["Text-to-video", "text-to-video"],
    });

    expect(parseKnowledgeSurface(updated).signals).toMatchObject({
      rating: null,
      zoteroTags: ["Video", "Diffusion"],
      paperKeywords: ["Text-to-video"],
    });
  });
});
