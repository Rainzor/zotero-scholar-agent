import {
  isSemanticRelationshipType,
  safePathSegment,
  type SemanticRelationshipType,
} from "./codex/vault-format";
import {
  commitVaultChanges,
  listVaultPapers,
  readPaperMemory,
  refreshPaperRecordProjection,
  writePaperMemory,
  type PaperVaultMeta,
} from "./codex/vault";
import { runCodexTurn, type CodexTurnInput } from "./codex/runner";
import type { CodexReasoningEffort } from "./codex/context-window";
import type { RunningLineProcess } from "./codex/subprocess";

export type RelationshipProposal = {
  type: SemanticRelationshipType;
  targetItemKey: string;
  title: string;
  rationale: string;
  evidence?: string;
};

const MARKER_PATTERN = /<!--\s*relationship-proposals:\s*(\[[\s\S]*?\])\s*-->/i;

export function extractRelationshipProposals(content: string): {
  content: string;
  proposals: RelationshipProposal[];
} {
  const text = String(content || "");
  const match = MARKER_PATTERN.exec(text);
  if (!match) return { content: text.trim(), proposals: [] };
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    parsed = [];
  }
  const proposals: RelationshipProposal[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(parsed) ? parsed : []) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const type = String(raw.type || "").trim();
    const targetItemKey = safePathSegment(String(raw.targetItemKey || ""));
    const title = String(raw.title || targetItemKey).trim();
    const rationale = String(raw.rationale || "").trim();
    const evidence = String(raw.evidence || "").trim();
    if (
      !isSemanticRelationshipType(type) ||
      targetItemKey === "unknown" ||
      !rationale
    ) {
      continue;
    }
    const key = `${type}\u0000${targetItemKey}\u0000${rationale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push({
      type,
      targetItemKey,
      title: title || targetItemKey,
      rationale,
      evidence: evidence || undefined,
    });
  }
  return {
    content: text.replace(match[0], "").trim(),
    proposals,
  };
}

export function applyRelationshipProposal(
  memoryMarkdown: string,
  proposal: RelationshipProposal,
): string {
  const line = formatRelationshipProposal(proposal);
  const text = String(memoryMarkdown || "");
  if (text.includes(line)) return text;
  const heading = /^###\s+Semantic Relationships\s*$/im.exec(text);
  if (heading && typeof heading.index === "number") {
    const insertAt = heading.index + heading[0].length;
    return `${text.slice(0, insertAt)}\n\n${line}${text.slice(insertAt)}`;
  }
  const library = /^##\s+Library Connections\s*$/im.exec(text);
  if (library && typeof library.index === "number") {
    const insertAt = library.index + library[0].length;
    return `${text.slice(0, insertAt)}\n\n### Semantic Relationships\n\n${line}${text.slice(insertAt)}`;
  }
  return `${text.trimEnd()}\n\n## Library Connections\n\n### Semantic Relationships\n\n${line}\n`;
}

export function formatRelationshipProposal(
  proposal: RelationshipProposal,
): string {
  const title = proposal.title.replace(/[\[\]]/g, "").trim();
  const rationale = proposal.rationale.replace(/\s+/g, " ").trim();
  return `- [${proposal.type}] [${title || proposal.targetItemKey}](../${
    proposal.targetItemKey
  }/memory.md): ${rationale}${
    proposal.evidence ? ` Evidence: ${proposal.evidence}` : ""
  }`;
}

export async function runRelationshipLinkingPass(options: {
  paper: PaperVaultMeta;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  onStatus?: (text: string) => void;
  onProcess?: (process: RunningLineProcess) => void;
}): Promise<RelationshipProposal[]> {
  const papers = await listVaultPapers();
  const candidates = papers.filter(
    (paper) => paper.itemKey !== options.paper.itemKey,
  );
  if (!candidates.length) return [];
  options.onStatus?.("Looking for cross-paper connections...");
  const result = await runCodexTurn({
    prompt: buildRelationshipLinkingPrompt(
      options.paper,
      candidates.map((paper) => paper.itemKey),
    ),
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    fallbackToDefaultModel: options.model ? false : undefined,
    sandbox: "read-only",
    onStatus: options.onStatus,
    onProcess: options.onProcess,
  } satisfies CodexTurnInput);
  const allowedTargets = new Set(candidates.map((paper) => paper.itemKey));
  return extractRelationshipProposals(result.content).proposals.filter(
    (proposal) => allowedTargets.has(proposal.targetItemKey),
  );
}

export async function acceptRelationshipProposal(options: {
  paper: PaperVaultMeta;
  proposal: RelationshipProposal;
}): Promise<boolean> {
  const before = await readPaperMemory(options.paper.itemKey);
  const after = applyRelationshipProposal(before, options.proposal);
  if (after === before) return false;
  await writePaperMemory(options.paper.itemKey, after);
  await refreshPaperRecordProjection(options.paper);
  await commitVaultChanges(
    `relationship: ${options.paper.itemKey} ${options.proposal.targetItemKey}`,
  );
  return true;
}

export function buildRelationshipLinkingPrompt(
  paper: PaperVaultMeta,
  candidateItemKeys: string[],
): string {
  return `Propose durable Semantic Relationships for ${paper.itemKey}.

Read ${paper.itemKey}/memory.md first. Compare it only with these existing Vault papers:
${candidateItemKeys.map((key) => `- ${key}/memory.md`).join("\n")}

Do not edit any file. Return a short confirmation followed by at most five proposals in one
hidden JSON marker using this exact shape:
<!-- relationship-proposals: [{"type":"extends","targetItemKey":"OTHERKEY","title":"Paper title","rationale":"Why the relationship is durable.","evidence":"[page 4]"}] -->

Allowed types: cites, extends, contradicts, supports, uses_same_method,
uses_same_dataset, uses_same_metric, solves_limitation_of, can_combine_with,
inspired_question. Return an empty JSON array when there is no well-grounded relationship.`;
}
