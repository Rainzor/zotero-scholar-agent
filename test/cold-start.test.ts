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
      writePaperMemory: async () => undefined,
      runCodexTurn: async () => ({
        content: "Done.",
        reasoning: "",
        threadId: "cold",
      }),
      refreshPaperRecordProjection: async () => [],
      commitVaultChanges: async () => false,
    };
    const result = await runPaperColdStart(
      { paper, pdfItemId: 10 },
      {},
      deps,
    );
    expect(result.quality.status).toBe("failed");
    expect(result.quality.coreSections.missing).toContain("Method");
  });

  it("uses a second fresh turn to deepen Insight when requested", async () => {
    let memory = completedMemory;
    const prompts: string[] = [];
    const deps: PaperColdStartDeps = {
      ensurePaperVault: async () => ({}) as any,
      readPaperMemory: async () => memory,
      writePaperMemory: async (_key, value) => {
        memory = value;
      },
      runCodexTurn: async (input) => {
        prompts.push(input.prompt);
        return { content: "Done.", reasoning: "", threadId: "cold" };
      },
      refreshPaperRecordProjection: async () => [],
      commitVaultChanges: async () => true,
    };
    await runPaperColdStart(
      {
        paper,
        pdfItemId: 10,
        model: "cheap-model",
        deepenInsight: true,
      },
      {},
      deps,
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Deepen the Insight section");
  });
});
