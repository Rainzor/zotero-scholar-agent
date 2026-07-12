import { describe, expect, it } from "vitest";
import {
  WORKFLOW_SKILL_VERSION,
  getWorkflowSkillFiles,
} from "../src/services/codex/workflow-skills";

describe("Vault workflow skills", () => {
  it("installs the four plugin-owned action skills", () => {
    expect(WORKFLOW_SKILL_VERSION).toBe(1);
    expect(Object.keys(getWorkflowSkillFiles())).toEqual([
      ".agents/skills/zotero-paper-code/SKILL.md",
      ".agents/skills/zotero-reader-note/SKILL.md",
      ".agents/skills/zotero-topic-synthesis/SKILL.md",
      ".agents/skills/zotero-depth-transition/SKILL.md",
    ]);
  });

  it("keeps the Note skill read-only and schema-bound", () => {
    const note =
      getWorkflowSkillFiles()[".agents/skills/zotero-reader-note/SKILL.md"];
    expect(note).toContain("Do not write files");
    expect(note).toContain("Thoughts and Critique");
    expect(note).toContain("JSON");
    expect(note).not.toContain("network");
  });
});
