---
status: accepted
track: backend
---

# Split paper files by write discipline

## Context

`memory.md` currently mixes three write disciplines in one file: deterministic
bibliographic content (title/abstract) that the plugin can own, the model's
rewrite-and-deduplicate interpretation area, and the user's append-only Reader
Thinking. Early Vault practice confirmed the prediction of
`docs/memory-philosophy.md` (P3): rules that depend on the model voluntarily
following them drift — abstracts get rewritten, sections get re-appended. The
post-turn quality checker detects these violations, but detection is weaker
than a structure that makes them impossible. Evidence Pointers is also a
manually maintained section whose content is fully derivable from inline
`[page N]` anchors.

P4 gives the split criterion: one file, one write discipline, one maintainer.
P5 adds the trust requirement: Paper-grounded Knowledge and Reader Thinking
should be separated by a file boundary, not by in-file labels.

## Decision

Restructure the per-paper directory along write disciplines:

- **`memory.md`** keeps two zones only. A **plugin-marked block**
  (bibliography + the Zotero/source abstract) maintained by
  `replaceMarkedBlock` — the model reads it but never edits it; the `## Abstract`
  section moves into this block and out of the model's reach. The
  **interpretation area** (Contribution … Library Connections) remains the
  model's rewrite-and-dedupe zone. Frontmatter stays plugin-owned (ADR 0007).
- **`notes.md`** becomes the carrier of Reader Thinking: append-only, wording
  preserved exactly. Entries carry a date and an author tag (`[user]` or
  `[agent, user-confirmed]`); agent-suggested entries require explicit user
  confirmation through the UI, reusing the keyword-acceptance pattern.
  Sections: `readingContext`, dated thoughts/critique (including changes of
  viewpoint — never deleted), and `Actions`.
- **Evidence Pointers is removed as a maintained section.** The plugin derives
  a page-anchor index from inline `[page N]` anchors in the interpretation
  area and projects it into `record.json`.
- `record.json` remains purely generated; `conversations/` remains plugin
  append-only. `AGENTS.md` rules are updated: the model must not edit
  `notes.md`, the plugin block, or frontmatter.

**Versioning and migration.** `vault.json` bumps `knowledgeSurfaceVersion`
1 → 2 and `recordProjectionVersion` 2 → 3 (anchor index added). A one-time,
git-committed migration per paper: inject the plugin block from Zotero
metadata, move existing `## Reader Thinking` content into `notes.md` with a
migration-dated `[user]` attribution, harvest inline anchors, and drop the
Evidence Pointers section. The migration runs together with the ADR 0012 tier
migration as a single Vault version step.

## Consequences

- The trust boundary between "what the paper says" and "how I think about it"
  is structural, not rule-based; the model cannot corrupt the abstract or the
  user's own words even in a bad turn.
- The quality checker simplifies: abstract-rewrite detection reduces to
  "plugin block untouched", and append-bloat checks apply only to the
  interpretation area.
- Each paper has exactly two human-maintained files (`memory.md`
  interpretation area, `notes.md`), per the P7 freeze target.
- The Memory view must render both files; Reader Thinking display reads
  `notes.md`.
- Compact Knowledge Surface injection (Paper Mentions) should include the
  plugin block and interpretation area, and may include recent `notes.md`
  entries when the question concerns the user's own thinking.
- `CONTEXT.md` terms change: Reader Thinking's carrier is `notes.md`;
  Evidence Pointers becomes a derived projection field, not a section.
- Existing Vaults must migrate before the 30-paper backfill; migration cost
  today is a handful of papers.
