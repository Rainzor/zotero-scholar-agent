import { describe, expect, it } from "vitest";
import {
  runPaperColdStart,
  type PaperColdStartDeps,
} from "../src/services/cold-start";

const paper = {
  itemId: 1,
  itemKey: "AAAA1111",
  title: "Paper",
  creators: "A Researcher",
  year: "2025",
  abstract: "Source abstract.",
};

const completedMemory = `# Paper

## Abstract
Rewritten abstract.

## Contribution
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
Takeaways.

## Reader Thinking

## Library Connections

### Semantic Relationships

## Evidence Pointers
`;

describe("runPaperColdStart", () => {
  it("runs a fresh Codex turn, restores the source abstract and commits", async () => {
    let memory = "# Paper\n\n## Abstract\n\n## Contribution\n";
    const calls: string[] = [];
    const deps: PaperColdStartDeps = {
      ensurePaperVault: async () => {
        calls.push("ensure");
        return {} as any;
      },
      readPaperMemory: async () => memory,
      readPaperText: async () => "",
      writePaperMemory: async (_key, value) => {
        calls.push("write");
        memory = value;
      },
      runCodexTurn: async (input) => {
        calls.push("run");
        expect(input.threadId).toBeUndefined();
        expect(input.prompt).toContain("Initialize the Paper Knowledge Record");
        memory = completedMemory;
        return { content: "Initialized.", reasoning: "", threadId: "cold" };
      },
      refreshPaperRecordProjection: async (_meta, quality) => {
        calls.push(`quality:${quality?.status}`);
        return [];
      },
      updatePaperSignals: async () => false,
      commitVaultChanges: async () => {
        calls.push("commit");
        return true;
      },
    };

    const result = await runPaperColdStart(
      { paper, pdfItemId: 10, model: "gpt-5.6-sol" },
      {},
      deps,
    );

    expect(result.quality.status).toBe("passed");
    expect(memory).toContain("## Abstract\n\nSource abstract.");
    expect(memory).not.toContain("Rewritten abstract.");
    expect(calls).toEqual([
      "ensure",
      "run",
      "write",
      "quality:passed",
      "commit",
    ]);
  });

  it("returns a failed quality report when Codex does not fill the record", async () => {
    const memory = "# Paper\n\n## Abstract\n";
    const deps: PaperColdStartDeps = {
      ensurePaperVault: async () => ({}) as any,
      readPaperMemory: async () => memory,
      readPaperText: async () => "",
      writePaperMemory: async () => undefined,
      runCodexTurn: async () => ({
        content: "Done.",
        reasoning: "",
        threadId: "cold",
      }),
      refreshPaperRecordProjection: async () => [],
      updatePaperSignals: async () => false,
      commitVaultChanges: async () => false,
    };
    const result = await runPaperColdStart({ paper, pdfItemId: 10 }, {}, deps);
    expect(result.quality.status).toBe("failed");
    expect([
      ...result.quality.coreSections.missing,
      ...result.quality.coreSections.placeholder,
    ]).toContain("Method");
  });

  it("uses a second fresh turn to deepen Insight when requested", async () => {
    let memory = completedMemory;
    const prompts: string[] = [];
    const efforts: (string | undefined)[] = [];
    const deps: PaperColdStartDeps = {
      ensurePaperVault: async () => ({}) as any,
      readPaperMemory: async () => memory,
      readPaperText: async () => "",
      writePaperMemory: async (_key, value) => {
        memory = value;
      },
      runCodexTurn: async (input) => {
        prompts.push(input.prompt);
        efforts.push(input.reasoningEffort);
        return { content: "Done.", reasoning: "", threadId: "cold" };
      },
      refreshPaperRecordProjection: async () => [],
      updatePaperSignals: async () => false,
      commitVaultChanges: async () => true,
    };
    await runPaperColdStart(
      {
        paper,
        pdfItemId: 10,
        model: "cheap-model",
        reasoningEffort: "low",
        deepenInsight: true,
      },
      {},
      deps,
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Deepen the Insight section");
    expect(efforts).toEqual(["low", "low"]);
  });

  it("falls back to the paper text abstract when Zotero metadata is empty", async () => {
    let memory = completedMemory.replace(
      "Rewritten abstract.",
      "Generated abstract.",
    );
    let projectedAbstract = "";
    const deps: PaperColdStartDeps = {
      ensurePaperVault: async () => ({}) as any,
      readPaperMemory: async () => memory,
      readPaperText: async () =>
        "[page 1]\nAbstract\nExtracted source abstract.\nKeywords: video\n\n1 Introduction",
      writePaperMemory: async (_key, value) => {
        memory = value;
      },
      updatePaperSignals: async () => false,
      runCodexTurn: async () => ({
        content: "Done.",
        reasoning: "",
        threadId: "cold",
      }),
      refreshPaperRecordProjection: async (meta) => {
        projectedAbstract = String(meta.abstract || "");
        return [];
      },
      commitVaultChanges: async () => true,
    };
    const result = await runPaperColdStart(
      { paper: { ...paper, abstract: "" }, pdfItemId: 10 },
      {},
      deps,
    );
    expect(result.quality.status).toBe("passed");
    expect(memory).toContain("## Abstract\n\nExtracted source abstract.");
    expect(projectedAbstract).toBe("Extracted source abstract.");
  });
});
