import { describe, expect, it } from "vitest";
import {
  analyzePaperCode,
  buildCodeAnalysisPrompt,
  buildCodeNotesMarkdown,
  normalizeGitHubRepositoryUrl,
} from "../src/services/code-analysis";

const L1_MEMORY = `---
tier: L1
---

<!-- zotero-agent:paper:start -->
## Bibliography

**Title:** Paper A
**Item Key:** AAAA1111

## Abstract
Source abstract.
<!-- zotero-agent:paper:end -->

## TL;DR
Summary.

## Contribution
Contribution.

## Method
Method.

## Takeaways
Takeaway.

## Library Connections
`;

const L2_MEMORY = `---
tier: L1
---

<!-- zotero-agent:paper:start -->
## Bibliography

**Title:** Paper A
**Item Key:** AAAA1111

## Abstract
Source abstract.
<!-- zotero-agent:paper:end -->

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
Takeaway.

## Library Connections
`;

describe("GitHub code analysis", () => {
  it("normalizes supported GitHub repository URLs", () => {
    expect(
      normalizeGitHubRepositoryUrl("https://github.com/openai/codex.git"),
    ).toEqual({
      url: "https://github.com/openai/codex.git",
      owner: "openai",
      repository: "codex",
    });
    expect(
      normalizeGitHubRepositoryUrl("git@github.com:openai/codex.git"),
    ).toEqual({
      url: "https://github.com/openai/codex.git",
      owner: "openai",
      repository: "codex",
    });
  });

  it("rejects non-GitHub and non-repository URLs", () => {
    expect(() =>
      normalizeGitHubRepositoryUrl("https://example.com/openai/codex"),
    ).toThrow("GitHub");
    expect(() =>
      normalizeGitHubRepositoryUrl("https://github.com/openai"),
    ).toThrow("repository");
  });

  it("creates tracked provenance and a read-only analysis prompt", () => {
    const notes = buildCodeNotesMarkdown({
      itemKey: "AAAA1111",
      title: "Paper A",
      repositoryUrl: "https://github.com/openai/codex.git",
      branch: "main",
      commit: "abc123",
      generatedAt: "2026-07-12T00:00:00.000Z",
    });
    const prompt = buildCodeAnalysisPrompt({
      itemKey: "AAAA1111",
      repositoryUrl: "https://github.com/openai/codex.git",
      commit: "abc123",
    });

    expect(notes).toContain("<!-- zotero-agent:code:start -->");
    expect(notes).toContain("**Commit:** `abc123`");
    expect(notes).toContain("## Paper-to-Code Map");
    expect(prompt).toContain("AAAA1111/code/");
    expect(prompt).toContain("AAAA1111/code-notes.md");
    expect(prompt).toContain("Do not modify any file under AAAA1111/code/");
  });

  it("clones, records the pinned commit, analyzes, and commits", async () => {
    const gitCalls: string[][] = [];
    const codexPrompts: string[] = [];
    let notes = "";
    let memory = L1_MEMORY;
    const result = await analyzePaperCode(
      {
        paper: {
          itemId: 1,
          itemKey: "AAAA1111",
          title: "Paper A",
        },
        pdfItemId: 10,
        repositoryUrl: "https://github.com/openai/codex",
      },
      {},
      {
        ensurePaperVault: async () =>
          ({
            vaultDir: "/vault",
            paperDir: "/vault/AAAA1111",
            textPath: "/vault/AAAA1111/text.txt",
            textMetaPath: "/vault/AAAA1111/text.meta.json",
            memoryPath: "/vault/AAAA1111/memory.md",
            notesPath: "/vault/AAAA1111/notes.md",
            recordPath: "/vault/AAAA1111/record.json",
            codeDir: "/vault/AAAA1111/code",
            codeNotesPath: "/vault/AAAA1111/code-notes.md",
            conversationsDir: "/vault/AAAA1111/conversations",
          }) as any,
        pathExists: async () => false,
        readText: async () => notes,
        writeText: async (_path, value) => {
          notes = value;
        },
        removeText: async () => {
          notes = "";
        },
        runGit: async (_cwd, args) => {
          gitCalls.push(args);
          const stdout =
            args[0] === "rev-parse" && args[1] === "HEAD"
              ? "abc123\n"
              : args[0] === "rev-parse"
                ? "main\n"
                : "";
          return {
            stdout,
            stderr: "",
            exitCode: 0,
            timedOut: false,
          };
        },
        readPaperMemory: async () => memory,
        writePaperMemory: async (_itemKey, value) => {
          memory = value;
        },
        runCodexTurn: async (input) => {
          codexPrompts.push(input.prompt);
          if (codexPrompts.length === 1) memory = L2_MEMORY;
          if (codexPrompts.length === 2) {
            notes +=
              "\nThe implementation maps the paper pipeline to concrete modules and entry points.\n";
          }
          return {
            content: "Done.",
            reasoning: "",
            threadId: "code",
          };
        },
        updatePaperSignals: async () => true,
        refreshPaperRecordProjection: async () => [],
        commitVaultChanges: async () => true,
      },
    );

    expect(gitCalls[0]).toEqual([
      "clone",
      "--depth",
      "1",
      "https://github.com/openai/codex.git",
      "code",
    ]);
    expect(notes).toContain("**Commit:** `abc123`");
    expect(codexPrompts).toHaveLength(2);
    expect(codexPrompts[0]).toContain("as tier L2");
    expect(codexPrompts[1]).toContain("Analyze the source repository");
    expect(result).toMatchObject({
      branch: "main",
      commit: "abc123",
      repositoryModified: false,
      committed: true,
    });
  });

  it("restores tracked artifacts when code analysis fails", async () => {
    const originalMemory = L1_MEMORY;
    let memory = originalMemory;
    let notes = "";
    let codexCalls = 0;
    await expect(
      analyzePaperCode(
        {
          paper: {
            itemId: 1,
            itemKey: "AAAA1111",
            title: "Paper A",
          },
          pdfItemId: 10,
          repositoryUrl: "https://github.com/openai/codex",
        },
        {},
        {
          ensurePaperVault: async () =>
            ({
              paperDir: "/vault/AAAA1111",
              codeDir: "/vault/AAAA1111/code",
              codeNotesPath: "/vault/AAAA1111/code-notes.md",
            }) as any,
          pathExists: async () => false,
          readText: async () => notes,
          writeText: async (_path, value) => {
            notes = value;
          },
          removeText: async () => {
            notes = "";
          },
          runGit: async (_cwd, args) => ({
            stdout:
              args[0] === "rev-parse" && args[1] === "HEAD"
                ? "abc123\n"
                : args[0] === "rev-parse"
                  ? "main\n"
                  : "",
            stderr: "",
            exitCode: 0,
            timedOut: false,
          }),
          readPaperMemory: async () => memory,
          writePaperMemory: async (_itemKey, value) => {
            memory = value;
          },
          runCodexTurn: async () => {
            codexCalls += 1;
            if (codexCalls === 2) throw new Error("analysis failed");
            memory = L2_MEMORY;
            return { content: "Done.", reasoning: "", threadId: "tier" };
          },
          updatePaperSignals: async () => true,
          refreshPaperRecordProjection: async () => [],
          commitVaultChanges: async () => true,
        },
      ),
    ).rejects.toThrow("analysis failed");

    expect(memory).toBe(originalMemory);
    expect(notes).toBe("");
  });
});
