import type { SemanticRelationship } from "../codex";

export function relationshipIdentity(rel: SemanticRelationship): string {
  return [
    rel.sourceItemKey,
    rel.targetItemKey,
    rel.type,
    rel.rationale,
    rel.evidence || "",
  ].join("\u0000");
}

export function diffRelationships(
  before: SemanticRelationship[],
  after: SemanticRelationship[],
): SemanticRelationship[] {
  const beforeKeys = new Set((before || []).map(relationshipIdentity));
  return (after || []).filter(
    (rel) => !beforeKeys.has(relationshipIdentity(rel)),
  );
}
