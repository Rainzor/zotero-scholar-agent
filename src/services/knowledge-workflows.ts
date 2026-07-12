import {
  commitVaultChanges,
  ensurePaperVault,
  readPaperMemory,
  refreshPaperRecordProjection,
  updatePaperSignals,
  writePaperMemory,
  type PaperVaultMeta,
} from "./codex/vault";
import { runCodexTurn, type CodexTurnInput } from "./codex/runner";
import type { CodexReasoningEffort } from "./codex/context-window";
import type { RunningLineProcess } from "./codex/subprocess";
import {
  evaluateKnowledgeSurface,
  type KnowledgeQualityReport,
} from "./knowledge-quality";
import type { PaperTier } from "./knowledge-surface";
import {
  TIER_SECTION_SHAPES,
  parseKnowledgeSurface,
  restoreKnowledgeSurfaceOwnership,
} from "./knowledge-surface";

export async function transitionPaperTier(options: {
  paper: PaperVaultMeta;
  pdfItemId: number;
  targetTier: Exclude<PaperTier, "L3">;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
}): Promise<{ quality: KnowledgeQualityReport; committed: boolean }> {
  await ensurePaperVault({
    ...options.paper,
    pdfItemId: options.pdfItemId,
    onStatus: options.onStatus,
  });
  const before = await readPaperMemory(options.paper.itemKey);
  const currentTier = parseKnowledgeSurface(before).signals.tier;
  const tierRank: Record<PaperTier, number> = {
    L0: 0,
    L1: 1,
    L2: 2,
    L3: 3,
  };
  if (
    tierRank[currentTier] > tierRank[options.targetTier] &&
    options.targetTier !== "L0"
  ) {
    throw new Error("Deeper records can only be downgraded to L0.");
  }
  options.onStatus?.(`Rewriting Knowledge Record as ${options.targetTier}...`);
  try {
    await runCodexTurn({
      prompt: buildTierTransitionPrompt(
        options.paper.itemKey,
        options.targetTier,
      ),
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      fallbackToDefaultModel: options.model ? false : undefined,
      sandbox: "workspace-write",
      onStatus: options.onStatus,
      onProcess: options.onProcess,
    } satisfies CodexTurnInput);
  } catch (error) {
    await writePaperMemory(options.paper.itemKey, before);
    throw error;
  }
  const rewritten = await readPaperMemory(options.paper.itemKey);
  const restored = restoreKnowledgeSurfaceOwnership(
    rewritten,
    before,
    options.paper,
  );
  if (restored !== rewritten) {
    await writePaperMemory(options.paper.itemKey, restored);
  }
  await updatePaperSignals(options.paper, { tier: options.targetTier });
  const after = await readPaperMemory(options.paper.itemKey);
  const quality = evaluateKnowledgeSurface({
    before,
    after,
    sourceAbstract: options.paper.abstract,
    itemKey: options.paper.itemKey,
    allowTierChange: true,
  });
  await refreshPaperRecordProjection(options.paper, quality);
  const committed = await commitVaultChanges(
    `tier: ${options.paper.itemKey} ${options.targetTier}`,
  );
  return { quality, committed };
}

export async function repairPaperKnowledge(options: {
  paper: PaperVaultMeta;
  pdfItemId: number;
  quality: KnowledgeQualityReport;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
}): Promise<{ quality: KnowledgeQualityReport; committed: boolean }> {
  await ensurePaperVault({
    ...options.paper,
    pdfItemId: options.pdfItemId,
    onStatus: options.onStatus,
  });
  const before = await readPaperMemory(options.paper.itemKey);
  options.onStatus?.("Repairing Knowledge Record...");
  try {
    await runCodexTurn({
      prompt: buildKnowledgeRepairPrompt(
        options.paper.itemKey,
        options.quality,
      ),
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      fallbackToDefaultModel: options.model ? false : undefined,
      sandbox: "workspace-write",
      onStatus: options.onStatus,
      onProcess: options.onProcess,
    } satisfies CodexTurnInput);
  } catch (error) {
    await writePaperMemory(options.paper.itemKey, before);
    throw error;
  }
  const repaired = await readPaperMemory(options.paper.itemKey);
  const restored = restoreKnowledgeSurfaceOwnership(
    repaired,
    before,
    options.paper,
  );
  if (restored !== repaired) {
    await writePaperMemory(options.paper.itemKey, restored);
  }
  const after = await readPaperMemory(options.paper.itemKey);
  const quality = evaluateKnowledgeSurface({
    before,
    after,
    sourceAbstract: options.paper.abstract,
    itemKey: options.paper.itemKey,
  });
  await refreshPaperRecordProjection(options.paper, quality);
  const committed = await commitVaultChanges(
    `repair: ${options.paper.itemKey}`,
  );
  return { quality, committed };
}

export function buildTierTransitionPrompt(
  itemKey: string,
  targetTier: Exclude<PaperTier, "L3">,
): string {
  const shape =
    targetTier === "L0"
      ? `${TIER_SECTION_SHAPES.L0.join(", ")}. Keep the card near five lines of substantive content.`
      : `${TIER_SECTION_SHAPES[targetTier].join(", ")}${
          targetTier === "L2" ? " with inline [page N] evidence" : ""
        }.`;
  return `Rewrite the interpretation area of ${itemKey}/memory.md as tier ${targetTier}.

Required shape: ${shape}
Read ${itemKey}/text.txt only when the current Knowledge Surface lacks needed evidence.
Preserve YAML frontmatter and the plugin-owned bibliography/abstract block exactly.
Rewrite and deduplicate; do not append a second template.
Do not edit notes.md, record.json, code-notes.md, or conversation logs.
Return a concise confirmation after memory.md is updated.`;
}

export function buildKnowledgeRepairPrompt(
  itemKey: string,
  quality: KnowledgeQualityReport,
): string {
  const issues = [...quality.hardFailures, ...quality.warnings]
    .map((issue) => `- ${issue}`)
    .join("\n");
  return `Repair the tier ${quality.tier} Knowledge Surface at ${itemKey}/memory.md.

Detected issues:
${issues || "- Re-check the tier template and grounding."}

Read ${itemKey}/text.txt for missing evidence.
Preserve YAML frontmatter and the plugin-owned bibliography/abstract block exactly.
Rewrite and deduplicate the interpretation area; do not append duplicate sections.
Do not edit notes.md, record.json, code-notes.md, or conversation logs.
Return a concise confirmation after memory.md is repaired.`;
}
