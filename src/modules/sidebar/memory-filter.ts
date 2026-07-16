import type { PaperVaultMeta } from "../../services/codex/vault-format";

/**
 * Instant, client-side filter for the navigator list. Matches the needle
 * (case-insensitive) against a paper's title and creators. This is deliberately
 * NOT the full-text Vault search (`searchVaultMemory`) — it never touches disk
 * and never replaces the view, so it can run on every keystroke while a topic
 * selection is in progress without losing state.
 */
export function paperMatchesFilter(
  paper: PaperVaultMeta,
  needle: string,
): boolean {
  const haystack = `${paper.title || ""} ${paper.creators || ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function filterPapers(
  papers: PaperVaultMeta[],
  query: string,
): PaperVaultMeta[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return papers;
  return papers.filter((paper) => paperMatchesFilter(paper, needle));
}
