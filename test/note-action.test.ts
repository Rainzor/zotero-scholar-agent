import { describe, expect, it } from "vitest";
import {
  organizePaperNote,
  type NoteActionDeps,
} from "../src/services/chat-actions/note";

describe("organizePaperNote", () => {
  it("uses a read-only structured turn and appends an attributed note", async () => {
    const calls: string[] = [];
    const deps: NoteActionDeps = {
      ensureVaultWorkflowSkills: async () => {
        calls.push("skills");
      },
      runStructuredCodexTurn: async (input) => {
        calls.push("codex");
        expect(input.sandbox).toBe("read-only");
        expect(input.ephemeral).toBe(true);
        expect(input.webSearch).toBe(false);
        expect(input.prompt).toContain(
          ".agents/skills/zotero-reader-note/SKILL.md",
        );
        expect(input.prompt).toContain("Original user text");
        return {
          section: "Thoughts and Critique",
          markdown: "- The ablation does not isolate decoder capacity.",
          summary: "Captured a critique of the ablation.",
        };
      },
    };

    const result = await organizePaperNote(
      {
        actionId: "action-1",
        itemKey: "KEY7",
        paperTitle: "Paper",
        content: "The ablation does not isolate decoder capacity.",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
      },
      deps,
    );

    expect(calls).toEqual(["skills", "codex"]);
    expect(result).toEqual({
      summary: "Captured a critique of the ablation.",
      targetPath: "KEY7/notes.md",
      section: "Thoughts and Critique",
      markdown: "- The ablation does not isolate decoder capacity.",
    });
  });
});
