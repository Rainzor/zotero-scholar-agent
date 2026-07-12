import {
  commitVaultChanges,
  ensurePaperVault,
  readPaperMemory,
  readPaperText,
  refreshPaperRecordProjection,
  runCodexTurn,
  writePaperMemory,
  updatePaperSignals,
  type CodexReasoningEffort,
  type CodexTurnInput,
  type PaperVaultMeta,
  type RunningLineProcess,
} from "./codex";
import {
  evaluateKnowledgeSurface,
  type KnowledgeQualityReport,
} from "./knowledge-quality";
import {
  KNOWLEDGE_SURFACE_PLUGIN_START,
  TIER_SECTION_SHAPES,
  migrateKnowledgeSurfaceV2,
  restoreKnowledgeSurfaceOwnership,
} from "./knowledge-surface";
import {
  runRelationshipLinkingPass,
  type RelationshipProposal,
} from "./relationship-proposals";
import {
  extractPaperAbstract,
  extractPaperKeywords,
} from "./keyword-suggestions";

export type PaperColdStartRequest = {
  paper: PaperVaultMeta;
  pdfItemId: number;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  deepenInsight?: boolean;
  insightModel?: string;
  linkRelationships?: boolean;
};

export type PaperColdStartEvents = {
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
};

export type PaperColdStartResult = {
  quality: KnowledgeQualityReport;
  relationshipProposals: RelationshipProposal[];
  committed: boolean;
};

export type PaperColdStartDeps = {
  ensurePaperVault: typeof ensurePaperVault;
  readPaperMemory: typeof readPaperMemory;
  readPaperText: typeof readPaperText;
  writePaperMemory: typeof writePaperMemory;
  runCodexTurn: typeof runCodexTurn;
  refreshPaperRecordProjection: typeof refreshPaperRecordProjection;
  updatePaperSignals: typeof updatePaperSignals;
  commitVaultChanges: typeof commitVaultChanges;
};

const defaultDeps: PaperColdStartDeps = {
  ensurePaperVault,
  readPaperMemory,
  readPaperText,
  writePaperMemory,
  runCodexTurn,
  refreshPaperRecordProjection,
  updatePaperSignals,
  commitVaultChanges,
};

export async function runPaperColdStart(
  request: PaperColdStartRequest,
  events: PaperColdStartEvents = {},
  depsOverride: Partial<PaperColdStartDeps> = {},
): Promise<PaperColdStartResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  events.onStatus?.("Preparing paper for Knowledge Record initialization...");
  await deps.ensurePaperVault({
    ...request.paper,
    pdfItemId: request.pdfItemId,
    onStatus: events.onStatus,
  });
  const paperText = await deps.readPaperText(request.paper.itemKey);
  const sourceAbstract =
    String(request.paper.abstract || "").trim() ||
    extractPaperAbstract(paperText);
  const paper = { ...request.paper, abstract: sourceAbstract };
  const paperKeywords = extractPaperKeywords(paperText);
  if (paperKeywords.length) {
    await deps.updatePaperSignals(paper, { paperKeywords });
  }
  const before = await deps.readPaperMemory(paper.itemKey);
  await deps.runCodexTurn({
    prompt: buildColdStartPrompt(paper),
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    fallbackToDefaultModel: request.model ? false : undefined,
    sandbox: "workspace-write",
    onStatus: events.onStatus,
    onProcess: events.onProcess,
  } satisfies CodexTurnInput);
  if (request.deepenInsight) {
    events.onStatus?.("Deepening the paper Insight...");
    await deps.runCodexTurn({
      prompt: buildInsightPrompt(request.paper),
      model: request.insightModel,
      reasoningEffort: request.reasoningEffort,
      fallbackToDefaultModel: request.insightModel ? false : undefined,
      sandbox: "workspace-write",
      onStatus: events.onStatus,
      onProcess: events.onProcess,
    } satisfies CodexTurnInput);
  }

  let after = await deps.readPaperMemory(paper.itemKey);
  const migrated = migrateKnowledgeSurfaceV2({
    markdown: after,
    meta: paper,
    migratedAt: new Date().toISOString().slice(0, 10),
  });
  const ownershipBaseline = before.includes(KNOWLEDGE_SURFACE_PLUGIN_START)
    ? before
    : migrated.memoryMarkdown;
  const corrected = restoreKnowledgeSurfaceOwnership(
    migrated.memoryMarkdown,
    ownershipBaseline,
    paper,
  );
  if (corrected !== after) {
    after = corrected;
    await deps.writePaperMemory(paper.itemKey, after);
  }
  const quality = evaluateKnowledgeSurface({
    before,
    after,
    sourceAbstract,
    itemKey: paper.itemKey,
    allowTierChange: !before.includes(KNOWLEDGE_SURFACE_PLUGIN_START),
  });
  await deps.refreshPaperRecordProjection(paper, quality);
  let relationshipProposals: RelationshipProposal[] = [];
  if (request.linkRelationships) {
    try {
      relationshipProposals = await runRelationshipLinkingPass({
        paper,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        onStatus: events.onStatus,
        onProcess: events.onProcess,
      });
    } catch {
      events.onStatus?.(
        "Knowledge Record built; relationship suggestions are unavailable.",
      );
    }
  }
  const committed = await deps.commitVaultChanges(
    `initialize: ${paper.itemKey}`,
  );
  return { quality, relationshipProposals, committed };
}

function buildInsightPrompt(paper: PaperVaultMeta): string {
  return `Deepen the Insight section of the Paper Knowledge Record for ${paper.itemKey}.

Read ${paper.itemKey}/memory.md and ${paper.itemKey}/text.txt.
Rewrite only the ## Insight section so it explains the paper-grounded reason the method works or matters.
Preserve YAML frontmatter, the plugin-owned bibliography/abstract block, all other sections, and notes.md.
Use [page N] evidence where useful.
Do not edit notes.md, record.json, or conversation logs.

Return a short confirmation after the file is updated.`;
}

function buildColdStartPrompt(paper: PaperVaultMeta): string {
  return `Initialize the Paper Knowledge Record for ${paper.itemKey}.

Read ${paper.itemKey}/text.txt and update ${paper.itemKey}/memory.md.
This is an L1 standard skim. Fill ${TIER_SECTION_SHAPES.L1.join(", ")}
with concise, paper-specific knowledge.
Preserve YAML frontmatter and the plugin-owned bibliography/abstract block exactly.
Keep paper claims separate from Reader Thinking in notes.md.
Add inline [page N] evidence anchors where useful.
Rewrite placeholders; do not append a second copy of any section.
Do not edit notes.md, record.json, or conversation logs.

Return a short confirmation after the file is updated.`;
}
