import {
  ensureVaultWorkflowSkills,
  getVaultHeadSha,
  listPaperReproductionArtifactPaths,
  readPaperMemory,
  removeVaultPaths,
  refreshPaperRecordProjection,
  runStructuredCodexTurn,
  updatePaperRating,
  writePaperMemory,
  type PaperVaultMeta,
  type StructuredCodexTurnInput,
} from "../codex";
import {
  evaluateKnowledgeSurface,
  type KnowledgeQualityReport,
} from "../knowledge-quality";
import {
  TIER_SECTION_SHAPES,
  parseKnowledgeSurface,
  replaceKnowledgeSurfaceInterpretation,
  type PaperTier,
} from "../knowledge-surface";
import type { AgentActionCard } from "./types";

type DepthDraft = {
  interpretationMarkdown: string;
  summary: string;
};

export type PreparedLocalKnowledgeAction = {
  paths: string[];
  commitMessage: string;
  expectedHeadSha?: string;
  apply: () => Promise<{
    summary: string;
    targetPath: string;
    section: "Overview";
    changed: boolean;
    quality?: KnowledgeQualityReport;
  }>;
};

export type LocalKnowledgeActionDeps = {
  readPaperMemory: typeof readPaperMemory;
  writePaperMemory: typeof writePaperMemory;
  updatePaperRating: typeof updatePaperRating;
  refreshPaperRecordProjection: typeof refreshPaperRecordProjection;
  runStructuredCodexTurn: typeof runStructuredCodexTurn<DepthDraft>;
  ensureVaultWorkflowSkills: typeof ensureVaultWorkflowSkills;
  getVaultHeadSha: typeof getVaultHeadSha;
  listPaperReproductionArtifactPaths: typeof listPaperReproductionArtifactPaths;
  removeVaultPaths: typeof removeVaultPaths;
};

const defaultDeps: LocalKnowledgeActionDeps = {
  readPaperMemory,
  writePaperMemory,
  updatePaperRating,
  refreshPaperRecordProjection,
  runStructuredCodexTurn,
  ensureVaultWorkflowSkills,
  getVaultHeadSha,
  listPaperReproductionArtifactPaths,
  removeVaultPaths,
};

export async function prepareLocalKnowledgeAction(
  action: AgentActionCard,
  hooks: {
    onStatus?: (text: string) => void;
    onProcess?: StructuredCodexTurnInput<DepthDraft>["onProcess"];
  },
  deps: LocalKnowledgeActionDeps = defaultDeps,
): Promise<PreparedLocalKnowledgeAction> {
  const paper = paperFromAction(action);
  if (action.kind === "paper.depth.set") {
    await deps.ensureVaultWorkflowSkills();
  }
  const expectedHeadSha = await deps.getVaultHeadSha();
  const memory = await deps.readPaperMemory(paper.itemKey);
  const signals = parseKnowledgeSurface(memory).signals;

  if (action.kind === "paper.rating.set") {
    const rating = action.request.rating;
    if (!rating) throw new Error("Rating must be between 1 and 5.");
    if (signals.rating === rating) {
      return noOp(`Rating is already ${rating}.`, `${paper.itemKey}/memory.md`);
    }
    return {
      paths: [
        `${paper.itemKey}/memory.md`,
        `${paper.itemKey}/record.json`,
        "README.md",
      ],
      commitMessage: `action: rating ${paper.itemKey} ${rating}`,
      expectedHeadSha,
      apply: async () => {
        const changed = await deps.updatePaperRating(paper, rating, {
          commit: false,
        });
        return {
          summary: `Rating set to ${rating}.`,
          targetPath: `${paper.itemKey}/memory.md`,
          section: "Overview",
          changed,
        };
      },
    };
  }

  if (action.kind !== "paper.depth.set") {
    throw new Error(`Unsupported local knowledge action: ${action.kind}`);
  }
  const targetTier = action.request.targetTier;
  if (!targetTier) throw new Error("Depth must be L0, L1, or L2.");
  if (signals.tier === targetTier) {
    return noOp(
      `Depth is already ${targetTier}.`,
      `${paper.itemKey}/memory.md`,
    );
  }
  assertDepthTransition(signals.tier, targetTier);
  const reproductionArtifactPaths =
    signals.tier === "L3" && targetTier === "L0"
      ? await deps.listPaperReproductionArtifactPaths(paper.itemKey)
      : [];
  hooks.onStatus?.(`Drafting ${targetTier} Knowledge Record...`);
  const draft = await deps.runStructuredCodexTurn({
    prompt: buildDepthPrompt(paper, targetTier),
    schema: depthSchema(),
    schemaName: `depth-${action.id}`,
    model: action.request.modelSlug,
    reasoningEffort: action.request.reasoningEffort,
    webSearch: false,
    ephemeral: true,
    sandbox: "read-only",
    validate: validateDepthDraft,
    onStatus: hooks.onStatus,
    onProcess: hooks.onProcess,
  });
  assertDepthDraftShape(draft.interpretationMarkdown, targetTier);
  const candidate = replaceKnowledgeSurfaceInterpretation(
    memory,
    draft.interpretationMarkdown,
    targetTier,
  );
  if (
    targetTier === "L2" &&
    !/\[page\s+[1-9][0-9]*\]/i.test(draft.interpretationMarkdown)
  ) {
    throw new Error("L2 depth draft requires inline [page N] evidence.");
  }
  const quality = evaluateKnowledgeSurface({
    before: memory,
    after: candidate,
    sourceAbstract: paper.abstract,
    itemKey: paper.itemKey,
    allowTierChange: true,
  });
  if (quality.status === "failed") {
    throw new Error(quality.hardFailures.join(" "));
  }
  return {
    paths: [
      `${paper.itemKey}/memory.md`,
      `${paper.itemKey}/record.json`,
      ...reproductionArtifactPaths,
    ],
    commitMessage: `action: depth ${paper.itemKey} ${targetTier}`,
    expectedHeadSha,
    apply: async () => {
      await deps.writePaperMemory(paper.itemKey, candidate);
      await deps.refreshPaperRecordProjection(paper, quality);
      await deps.removeVaultPaths(reproductionArtifactPaths);
      return {
        summary: draft.summary,
        targetPath: `${paper.itemKey}/memory.md`,
        section: "Overview",
        changed: true,
        quality,
      };
    },
  };
}

function paperFromAction(action: AgentActionCard): PaperVaultMeta {
  const paper = action.request.paper;
  if (!paper || !paper.itemId || paper.itemKey !== action.request.itemKey) {
    throw new Error("The action is missing its paper snapshot.");
  }
  return { ...paper, itemId: paper.itemId };
}

function assertDepthTransition(current: PaperTier, target: "L0" | "L1" | "L2") {
  const rank: Record<PaperTier, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
  if (rank[current] > rank[target] && target !== "L0") {
    throw new Error("Deeper records can only be downgraded to L0.");
  }
}

function buildDepthPrompt(
  paper: PaperVaultMeta,
  targetTier: "L0" | "L1" | "L2",
): string {
  const shape = TIER_SECTION_SHAPES[targetTier].join(", ");
  return [
    "Use `.agents/skills/zotero-depth-transition/SKILL.md` explicitly.",
    "This is a read-only analysis turn. Do not edit any files.",
    `In-focus paper: ${paper.itemKey}`,
    `Title: ${paper.title}`,
    `Target tier: ${targetTier}`,
    `Required H2 sections in order: ${shape}`,
    targetTier === "L2"
      ? "Ground key statements with inline [page N] evidence."
      : "",
    "Preserve valid existing Semantic Relationships unless the paper evidence contradicts them.",
    "Return only the requested JSON.",
  ]
    .filter(Boolean)
    .join("\n");
}

function depthSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["interpretationMarkdown", "summary"],
    properties: {
      interpretationMarkdown: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
    },
  };
}

function validateDepthDraft(value: unknown): DepthDraft {
  if (!value || typeof value !== "object") {
    throw new Error("Codex returned an invalid depth draft.");
  }
  const draft = value as Partial<DepthDraft>;
  const interpretationMarkdown = String(
    draft.interpretationMarkdown || "",
  ).trim();
  const summary = String(draft.summary || "").trim();
  if (!interpretationMarkdown || !summary) {
    throw new Error("Codex returned an invalid depth draft.");
  }
  if (
    interpretationMarkdown.startsWith("---") ||
    /<!--\s*zotero-agent:paper:/i.test(interpretationMarkdown) ||
    /^#\s+\S/m.test(interpretationMarkdown) ||
    /^\s*>?\s*item\s*key\s*:/im.test(interpretationMarkdown)
  ) {
    throw new Error("Depth draft contains plugin-owned content.");
  }
  return { interpretationMarkdown, summary };
}

function assertDepthDraftShape(
  markdown: string,
  targetTier: "L0" | "L1" | "L2",
): void {
  const headings = Array.from(
    String(markdown || "").matchAll(/^##\s+(.+?)\s*$/gm),
  ).map((match) => String(match[1] || "").trim());
  const expected = [...TIER_SECTION_SHAPES[targetTier]];
  if (
    headings.length !== expected.length ||
    headings.some((heading, index) => heading !== expected[index])
  ) {
    throw new Error(
      `Depth draft must contain these H2 sections in order: ${expected.join(", ")}.`,
    );
  }
  if (targetTier === "L0") {
    const substantiveLines = String(markdown || "")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/^#{2,3}\s+/.test(line));
    if (substantiveLines.length > 8) {
      throw new Error("L0 depth draft must remain a concise card.");
    }
    if (String(markdown || "").length > 600) {
      throw new Error("L0 depth draft must remain a concise card.");
    }
  }
}

function noOp(
  summary: string,
  targetPath: string,
): PreparedLocalKnowledgeAction {
  return {
    paths: [],
    commitMessage: "",
    apply: async () => ({
      summary,
      targetPath,
      section: "Overview",
      changed: false,
    }),
  };
}
