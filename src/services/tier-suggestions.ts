import type { PaperTier } from "./knowledge-surface";

const MARKER_PATTERN = /<!--\s*tier-suggestion:\s*(L[0-3])\s*-->/i;

export function extractTierSuggestion(content: string): {
  content: string;
  suggestion?: PaperTier;
} {
  const text = String(content || "");
  const match = MARKER_PATTERN.exec(text);
  const tier = String(match?.[1] || "").toUpperCase();
  return {
    content: match ? text.replace(match[0], "").trim() : text.trim(),
    suggestion: tier === "L2" ? "L2" : undefined,
  };
}
