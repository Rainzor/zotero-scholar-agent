---
status: accepted
track: both
---

# Tiered engagement depth for Paper Knowledge Records

## Context

The current cold start fills one uniform seven-section template for every
paper. `docs/memory-philosophy.md` (P1) identifies this as denying both design
axes: ordinary papers get notes far beyond their marginal value (wasting
tokens and polluting cross-paper retrieval), while important papers have no
sanctioned path to grow more detailed. P2 adds that a paper's value type is
independent of its engagement depth and should route retrieval. The M1 north
star was accordingly redefined: not "30 records with all seven sections" but
"30 records at the appropriate tier passing tier-aware gates".

## Decision

**Tier field.** `memory.md` frontmatter gains a plugin-owned `tier` field:
`L0 | L1 | L2 | L3`. Cold start defaults to **L1**.

**Tier templates for the interpretation area** (the plugin block and
`notes.md` from ADR 0011 are tier-independent):

- **L0 — one-sentence card**: a ~5-line card — conclusion, why more attention
  is not justified, pointer to more important papers (`[[KEY]]`). Negative
  knowledge is a research result.
- **L1 — standard skim (default)**: TL;DR, Contribution, Method skeleton,
  Takeaways.
- **L2 — close reading**: the full current seven-section shape (Contribution,
  Problem, Method, Insight, Results, Takeaways + Library Connections), with
  inline `[page N]` anchors on key statements. The former "Knowledge Surface
  Core Sections" definition now describes the L2 template.
- **L3 — reproduction-level**: L2 plus `code-notes.md` (repository pointers,
  paper-vs-code differences) and `experiments/` (one file per experiment).
  These files exist only at L3.

**Value type.** Frontmatter gains optional `valueTypes` (controlled
vocabulary: `method-advance | transferable-insight | methodology | canon`),
projected into `record.json` to route retrieval: method-detail questions
prefer L2/L3 records; field-overview questions prefer higher-level notes.

**Transitions.** An upgrade **rewrites** the interpretation area into the
higher tier's template — never appends; a downgrade compresses it into an L0
card. History stays in git. The agent may propose an upgrade (after enough
depth accumulates in conversation) via a hidden marker surfaced as a UI
confirmation; only the user confirms. L3 is user-initiated only.

**Tier-aware quality gates.** Required sections are defined per tier; an L1
record must not fail for "missing sections" it is not supposed to have.
Abstract fidelity and append-bloat gates apply at every tier. The
`knowledge-surface-quality.md` rubric becomes tier-aware. Every gate failure
gets an action path (repair turn injection or UI action) per P3.

**Cognitive labels** (P5, minimal set): `[claimed by paper]` / `[verified]`
allowed only in Results/Insight (L2/L3); `[superseded by [[KEY]]]` marks
outdated conclusions instead of deleting them.

**Versioning.** Ships in the same `vault.json` version step as ADR 0011
(`knowledgeSurfaceVersion` 2). Existing filled records migrate as L2 if they
pass seven-section gates, otherwise L1; empty skeletons migrate as L1
templates.

## Consequences

- Cold start (especially batch backfill) gets materially cheaper: L1 needs
  the cheap model and no Insight-deepening pass; deep reading cost is spent
  only where the user's attention already went.
- Retrieval quality improves: tier and `valueTypes` in `record.json` let
  library-level questions weight sources instead of treating all notes as
  equal.
- The quality checker, cold-start prompts, upgrade prompts, and rubric all
  branch on tier — templates and gates must stay in one shared module to
  avoid drift.
- README index and Memory view can display tier alongside rating.
- Per P7, once ADR 0011 + 0012 land, the single-paper structure is
  **frozen**; future extensions (insights/fields layers) live at the Vault
  level and must not add per-paper complexity.
