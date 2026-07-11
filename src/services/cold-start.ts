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
import { replaceKnowledgeSurfaceSection } from "./knowledge-surface";
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
};

export type PaperColdStartEvents = {
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
};

export type PaperColdStartResult = {
  quality: KnowledgeQualityReport;
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
  if (sourceAbstract) {
    const corrected = replaceKnowledgeSurfaceSection(
      after,
      "Abstract",
      sourceAbstract,
    );
    if (corrected !== after) {
      after = corrected;
      await deps.writePaperMemory(paper.itemKey, after);
    }
  }
  const quality = evaluateKnowledgeSurface({
    before,
    after,
    sourceAbstract,
    itemKey: paper.itemKey,
  });
  await deps.refreshPaperRecordProjection(paper, quality);
  const committed = await deps.commitVaultChanges(
    `initialize: ${paper.itemKey}`,
  );
  return { quality, committed };
}

function buildInsightPrompt(paper: PaperVaultMeta): string {
  return `Deepen the Insight section of the Paper Knowledge Record for ${paper.itemKey}.

Read ${paper.itemKey}/memory.md and ${paper.itemKey}/text.txt.
Rewrite only the ## Insight section so it explains the paper-grounded reason the method works or matters.
Preserve YAML frontmatter, Abstract, all other sections, and Reader Thinking.
Use [page N] evidence where useful.
Do not edit record.json or conversation logs.

Return a short confirmation after the file is updated.`;
}

function buildColdStartPrompt(paper: PaperVaultMeta): string {
  return `Initialize the Paper Knowledge Record for ${paper.itemKey}.

Read ${paper.itemKey}/text.txt and update ${paper.itemKey}/memory.md.
Fill the Contribution, Problem, Method, Insight, Results, and Takeaways sections with concise, paper-specific knowledge.
Preserve the existing YAML frontmatter and the Abstract section exactly.
Keep paper claims separate from Reader Thinking.
Add [page N] evidence pointers where useful.
Rewrite placeholders; do not append a second copy of any section.
Do not edit record.json or conversation logs.

Return a short confirmation after the file is updated.`;
}
