import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_SURFACE_PLUGIN_END,
  KNOWLEDGE_SURFACE_PLUGIN_START,
  buildInitialNotesMarkdown,
  buildKnowledgeSurfacePluginBlock,
  migrateKnowledgeSurfaceV2,
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
      tier: "L1",
      valueTypes: [],
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
      tier: "L1",
      valueTypes: [],
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
      tier: "L1",
      rating: null,
      zoteroTags: ["Video", "Diffusion"],
      paperKeywords: ["Text-to-video"],
    });
  });

  it("normalizes engagement tiers and value types", () => {
    const updated = updateKnowledgeSurfaceSignals(BODY, {
      tier: "L3",
      valueTypes: ["method-advance", "transferable-insight", "method-advance"],
    });

    expect(parseKnowledgeSurface(updated).signals).toMatchObject({
      tier: "L3",
      valueTypes: ["method-advance", "transferable-insight"],
    });
  });
});

describe("Knowledge Surface v2", () => {
  it("builds a plugin-owned bibliography and abstract block", () => {
    const block = buildKnowledgeSurfacePluginBlock({
      itemId: 1,
      itemKey: "AAAA1111",
      title: "Paper A",
      creators: "Alice",
      year: "2024",
      abstract: "Source abstract.",
    });

    expect(block).toContain(KNOWLEDGE_SURFACE_PLUGIN_START);
    expect(block).toContain("## Bibliography");
    expect(block).toContain("**Title:** Paper A");
    expect(block).toContain("## Abstract\n\nSource abstract.");
    expect(block).toContain(KNOWLEDGE_SURFACE_PLUGIN_END);
  });

  it("migrates Reader Thinking to append-only notes without losing content", () => {
    const migrated = migrateKnowledgeSurfaceV2({
      markdown: `${BODY}
## Problem

Problem.

## Method

Method.

## Insight

Insight.

## Results

Results.

## Takeaways

Takeaway.

## Reader Thinking

### Questions

Does it generalize?

## Library Connections

### Semantic Relationships

## Evidence Pointers

- [page 3]

## Custom Observation

Legacy content that must survive migration.

## Contribution

Later appended contribution detail.
`,
      meta: {
        itemId: 1,
        itemKey: "AAAA1111",
        title: "Paper A",
        abstract: "Original abstract.",
      },
      migratedAt: "2026-07-12",
    });

    expect(migrated.tier).toBe("L2");
    expect(migrated.memoryMarkdown).toContain(KNOWLEDGE_SURFACE_PLUGIN_START);
    expect(migrated.memoryMarkdown).not.toContain("## Reader Thinking");
    expect(migrated.memoryMarkdown).not.toContain("## Evidence Pointers");
    expect(migrated.notesMarkdown).toContain("### 2026-07-12 [user]");
    expect(migrated.notesMarkdown).toContain("Does it generalize?");
    expect(migrated.memoryMarkdown).toContain(
      "Legacy content that must survive migration.",
    );
    expect(migrated.memoryMarkdown).toContain(
      "Later appended contribution detail.",
    );
    expect(migrated.memoryMarkdown).toContain("[page 3]");
  });

  it("creates an empty append-only notes file for new papers", () => {
    const notes = buildInitialNotesMarkdown({
      itemId: 1,
      itemKey: "AAAA1111",
      title: "Paper A",
    });
    expect(notes).toContain("# Reader Thinking: Paper A");
    expect(notes).toContain("## Reading Context");
    expect(notes).toContain("## Thoughts and Critique");
    expect(notes).toContain("## Actions");
  });
});
