export const WORKFLOW_SKILL_VERSION = 1;

export function getWorkflowSkillFiles(): Record<string, string> {
  return {
    ".agents/skills/zotero-paper-code/SKILL.md": paperCodeSkill(),
    ".agents/skills/zotero-reader-note/SKILL.md": readerNoteSkill(),
    ".agents/skills/zotero-topic-synthesis/SKILL.md": topicSynthesisSkill(),
    ".agents/skills/zotero-depth-transition/SKILL.md": depthTransitionSkill(),
  };
}

function paperCodeSkill(): string {
  return `---
name: zotero-paper-code
description: Compare a paper with a user-authorized GitHub checkout.
---

# Zotero Paper Code

Read only the In-Focus Paper files and the repository path supplied by the
plugin. Do not write files, choose another checkout, or execute project code.

Return only the requested JSON schema. Ground each conclusion in a paper page
anchor or repository path. Separate confirmed implementation behavior from
inference, and identify paper-vs-code differences and reproducibility limits.
`;
}

function readerNoteSkill(): string {
  return `---
name: zotero-reader-note
description: Organize user-confirmed Reader Thinking for one paper.
---

# Zotero Reader Note

Do not write files. Organize only the supplied user text; do not invent paper
claims or silently strengthen uncertainty.

Choose exactly one destination section:

- Reading Context
- Actions
- Thoughts and Critique

Return only the requested JSON schema with \`section\`, concise Markdown in
\`markdown\`, and a short user-facing \`summary\`. Preserve critique,
hypotheses, open questions, and intended actions.
`;
}

function topicSynthesisSkill(): string {
  return `---
name: zotero-topic-synthesis
description: Synthesize explicitly selected Paper Knowledge Records.
---

# Zotero Topic Synthesis

Read only the selected Paper Knowledge Records supplied by the plugin. Do not
add papers, edit Paper Directories, or write the Topic Note.

Return only the requested JSON schema. Preserve disagreements and evidence
boundaries. Cover the problem definition, method landscape, paper positions,
connections, and open questions with Item Key provenance.
`;
}

function depthTransitionSkill(): string {
  return `---
name: zotero-depth-transition
description: Draft a tier-specific Paper Knowledge Record interpretation.
---

# Zotero Depth Transition

Read only the In-Focus Paper source and current Knowledge Surface. Do not write
files or change plugin-owned frontmatter and blocks.

Return only the requested JSON schema. Rewrite rather than append, satisfy the
requested L0-L3 section shape, keep paper claims separate from Reader Thinking,
and use page anchors for L2/L3 evidence.
`;
}
