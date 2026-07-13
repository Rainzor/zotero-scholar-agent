import { describe, expect, it } from "vitest";
import {
  prepareLocalKnowledgeAction,
  type LocalKnowledgeActionDeps,
} from "../src/services/chat-actions/local-knowledge";
import type { AgentActionCard } from "../src/services/chat-actions/types";

const pluginBlock = `<!-- zotero-agent:paper:start -->
## Bibliography

**Title:** Paper
**Item Key:** KEY7

## Abstract

Source abstract.
<!-- zotero-agent:paper:end -->`;

const l1Memory = `---
tier: L1
valueTypes: []
rating: 3
zoteroCollections: []
zoteroTags: []
paperKeywords: []
codexKeywords: []
---

# Paper

> itemKey: KEY7

${pluginBlock}

## TL;DR

Finding.

## Contribution

Contribution.

## Method

Method.

## Takeaways

Takeaway.

## Library Connections

### Semantic Relationships
`;

function action(kind: "paper.rating.set" | "paper.depth.set"): AgentActionCard {
  return {
    version: 1,
    id: "action-1",
    kind,
    state: "running",
    trigger: { source: "slash-command", text: "/action" },
    capabilities: ["codex.read", "vault.write"],
    request: {
      itemId: 7,
      itemKey: "KEY7",
      pdfItemId: 70,
      sessionId: "chat-1",
      paperTitle: "Paper",
      paper: {
        itemId: 7,
        itemKey: "KEY7",
        title: "Paper",
        abstract: "Source abstract.",
      },
      text: "/action",
    },
    target: { itemKey: "KEY7", path: "KEY7/memory.md", section: "Overview" },
    createdAt: 1,
    updatedAt: 1,
  };
}

function deps(
  overrides: Partial<LocalKnowledgeActionDeps> = {},
): LocalKnowledgeActionDeps {
  return {
    readPaperMemory: async () => l1Memory,
    writePaperMemory: async () => undefined,
    updatePaperRating: async () => true,
    refreshPaperRecordProjection: async () => [],
    runStructuredCodexTurn: async () => ({
      interpretationMarkdown: "",
      summary: "",
    }),
    ensureVaultWorkflowSkills: async () => undefined,
    getVaultHeadSha: async () => "head-before",
    listPaperReproductionArtifactPaths: async () => [],
    removeVaultPaths: async () => undefined,
    ...overrides,
  };
}

describe("prepareLocalKnowledgeAction", () => {
  it("prepares a deterministic rating update without Codex", async () => {
    let codexRuns = 0;
    const ratingAction = {
      ...action("paper.rating.set"),
      request: { ...action("paper.rating.set").request, rating: 5 },
    };
    const prepared = await prepareLocalKnowledgeAction(
      ratingAction,
      {},
      deps({
        runStructuredCodexTurn: async () => {
          codexRuns += 1;
          throw new Error("not expected");
        },
      }),
    );

    expect(prepared.paths).toEqual([
      "KEY7/memory.md",
      "KEY7/record.json",
      "README.md",
    ]);
    expect(prepared.expectedHeadSha).toBe("head-before");
    expect(codexRuns).toBe(0);
    expect((await prepared.apply()).summary).toContain("5");
  });

  it("returns a no-op when the requested rating is already set", async () => {
    const ratingAction = {
      ...action("paper.rating.set"),
      request: { ...action("paper.rating.set").request, rating: 3 },
    };
    const prepared = await prepareLocalKnowledgeAction(
      ratingAction,
      {},
      deps(),
    );

    expect(prepared.paths).toEqual([]);
    expect((await prepared.apply()).changed).toBe(false);
  });

  it("uses a read-only structured draft for an L2 depth transition", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L2" },
    };
    const prepared = await prepareLocalKnowledgeAction(
      depthAction,
      {},
      deps({
        runStructuredCodexTurn: async (input) => {
          expect(input.sandbox).toBe("read-only");
          expect(input.ephemeral).toBe(true);
          expect(input.prompt).toContain(
            ".agents/skills/zotero-depth-transition/SKILL.md",
          );
          return {
            interpretationMarkdown: `## Contribution

Contribution. [page 1]

## Problem

Problem. [page 1]

## Method

Method. [page 2]

## Insight

Insight. [page 2]

## Results

Results. [page 3]

## Takeaways

Takeaway. [page 3]

## Library Connections

### Semantic Relationships`,
            summary: "Expanded to close reading.",
          };
        },
      }),
    );

    const result = await prepared.apply();
    expect(prepared.paths).toEqual(["KEY7/memory.md", "KEY7/record.json"]);
    expect(result.changed).toBe(true);
    expect(result.quality?.tier).toBe("L2");
  });

  it("rejects unsupported depth transitions before running Codex", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L1" },
    };
    await expect(
      prepareLocalKnowledgeAction(
        depthAction,
        {},
        deps({
          readPaperMemory: async () => l1Memory.replace("tier: L1", "tier: L2"),
        }),
      ),
    ).rejects.toThrow(/downgraded to L0/i);
  });

  it("rejects a depth draft with extra or reordered sections", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L2" },
    };
    await expect(
      prepareLocalKnowledgeAction(
        depthAction,
        {},
        deps({
          runStructuredCodexTurn: async () => ({
            interpretationMarkdown: `## Problem

Problem.

## Contribution

Contribution.`,
            summary: "Malformed draft.",
          }),
        }),
      ),
    ).rejects.toThrow(/sections in order/i);
  });

  it("rejects an L2 depth draft without page evidence", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L2" },
    };
    await expect(
      prepareLocalKnowledgeAction(
        depthAction,
        {},
        deps({
          runStructuredCodexTurn: async () => ({
            interpretationMarkdown: `## Contribution

Contribution.

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

## Library Connections

### Semantic Relationships`,
            summary: "No evidence.",
          }),
        }),
      ),
    ).rejects.toThrow(/\[page N\] evidence/i);
  });

  it("removes tracked L3 artifacts when downgrading to L0", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L0" },
    };
    const removed: string[][] = [];
    const prepared = await prepareLocalKnowledgeAction(
      depthAction,
      {},
      deps({
        readPaperMemory: async () => l1Memory.replace("tier: L1", "tier: L3"),
        listPaperReproductionArtifactPaths: async () => [
          "KEY7/code-notes.md",
          "KEY7/experiments/run-1.md",
        ],
        removeVaultPaths: async (paths) => {
          removed.push(paths);
        },
        runStructuredCodexTurn: async () => ({
          interpretationMarkdown: `## Verdict

Useful only as a reference.

## Why Stop Here

Evidence is insufficient.

## Better Pointers

See stronger work.

## Library Connections

### Semantic Relationships`,
          summary: "Compressed to L0.",
        }),
      }),
    );

    expect(prepared.paths).toContain("KEY7/code-notes.md");
    await prepared.apply();
    expect(removed).toEqual([
      ["KEY7/code-notes.md", "KEY7/experiments/run-1.md"],
    ]);
  });

  it("rejects an overly verbose L0 card", async () => {
    const depthAction = {
      ...action("paper.depth.set"),
      request: { ...action("paper.depth.set").request, targetTier: "L0" },
    };
    await expect(
      prepareLocalKnowledgeAction(
        depthAction,
        {},
        deps({
          runStructuredCodexTurn: async () => ({
            interpretationMarkdown: `## Verdict

${"Long explanation. ".repeat(40)}

## Why Stop Here

Short.

## Better Pointers

Short.

## Library Connections

### Semantic Relationships`,
            summary: "Too long.",
          }),
        }),
      ),
    ).rejects.toThrow(/concise card/i);
  });
});
