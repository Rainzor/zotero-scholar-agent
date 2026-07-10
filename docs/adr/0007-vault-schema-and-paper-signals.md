---
status: accepted
---

# Version the Vault and represent paper signals as node attributes

## Context

M2 needs both typed Semantic Relationships between papers and stable attributes
on each paper for filtering, grouping, ranking, and future Topic Notes. Zotero
already owns collections and tags, while the Knowledge Vault owns the user's
durable research interpretation. Adding signals without a Vault version would
make accumulated Knowledge Surfaces difficult to migrate safely.

## Decision

The Vault root contains `vault.json`, which versions the Vault, Knowledge
Surface, and Structured Projection formats. Existing `memory.md` files gain
YAML frontmatter without changing their Markdown body.

Paper Signal Metadata contains:

- `rating`: user-owned 1–5 taste signal or `null`;
- `zoteroCollections` and `zoteroTags`: plugin-maintained mirrors of Zotero;
- `paperKeywords`: paper-grounded keywords;
- `codexKeywords`: Codex suggestions accepted by the user.

Codex does not directly edit signal frontmatter. The plugin updates it through
structured parsing and projects it into `record.json` schema v2 alongside
quality and relationships. Zotero remains authoritative for its mirrored
fields.

## Consequences

- Existing Knowledge Surface prose remains intact during migration.
- Future graph and library-query features can consume node attributes without
  parsing prose.
- Rating and accepted Codex keywords remain Vault-owned and reviewable in git.
- Projection regeneration must compare signals and quality, not only
  relationships.
