import type { CodexReasoningEffort } from "../codex/context-window";
import { ensureVaultWorkflowSkills, runStructuredCodexTurn } from "../codex";

export type PaperNoteSection =
  | "Reading Context"
  | "Actions"
  | "Thoughts and Critique";

export type OrganizedNote = {
  section: PaperNoteSection;
  markdown: string;
  summary: string;
};

export type NoteActionDeps = {
  ensureVaultWorkflowSkills: typeof ensureVaultWorkflowSkills;
  runStructuredCodexTurn: typeof runStructuredCodexTurn<OrganizedNote>;
};

const NOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["section", "markdown", "summary"],
  properties: {
    section: {
      type: "string",
      enum: ["Reading Context", "Actions", "Thoughts and Critique"],
    },
    markdown: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
  },
} as const;

const defaultDeps: NoteActionDeps = {
  ensureVaultWorkflowSkills,
  runStructuredCodexTurn,
};

export async function organizePaperNote(
  request: {
    actionId: string;
    itemKey: string;
    paperTitle: string;
    content: string;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    onStatus?: (text: string) => void;
    onProcess?: Parameters<typeof runStructuredCodexTurn>[0]["onProcess"];
  },
  deps: NoteActionDeps = defaultDeps,
): Promise<{
  summary: string;
  targetPath: string;
  section: PaperNoteSection;
  markdown: string;
}> {
  await deps.ensureVaultWorkflowSkills();
  const organized = await deps.runStructuredCodexTurn({
    prompt: buildNotePrompt(request),
    schema: NOTE_SCHEMA,
    schemaName: `note-${request.actionId}`,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    webSearch: false,
    ephemeral: true,
    sandbox: "read-only",
    validate: validateOrganizedNote,
    onStatus: request.onStatus,
    onProcess: request.onProcess,
  });
  return {
    summary: organized.summary,
    targetPath: `${request.itemKey}/notes.md`,
    section: organized.section,
    markdown: organized.markdown,
  };
}

function buildNotePrompt(request: {
  itemKey: string;
  paperTitle: string;
  content: string;
}): string {
  return [
    "Use `.agents/skills/zotero-reader-note/SKILL.md` explicitly.",
    "This is a read-only analysis turn. Do not edit any files.",
    `In-focus paper: ${request.itemKey}`,
    `Title: ${request.paperTitle || request.itemKey}`,
    "",
    "Organize the Reader Thinking below without adding paper claims.",
    "Preserve uncertainty, criticism, and intended actions.",
    "Choose exactly one notes.md section and return only the requested JSON.",
    "",
    "Original user text:",
    request.content.trim(),
  ].join("\n");
}

function validateOrganizedNote(value: unknown): OrganizedNote {
  if (!value || typeof value !== "object") {
    throw new Error("Codex returned an invalid organized note.");
  }
  const candidate = value as Partial<OrganizedNote>;
  const sections: PaperNoteSection[] = [
    "Reading Context",
    "Actions",
    "Thoughts and Critique",
  ];
  const section = String(candidate.section || "") as PaperNoteSection;
  const markdown = String(candidate.markdown || "").trim();
  const summary = String(candidate.summary || "").trim();
  if (!sections.includes(section) || !markdown || !summary) {
    throw new Error("Codex returned an invalid organized note.");
  }
  return { section, markdown, summary };
}
