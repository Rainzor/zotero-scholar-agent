---
status: accepted
---

# Per-chat Codex model selection from the active Codex catalog

## Context

The plugin normally inherits the user's Codex model configuration. That is a
sound default, but research work has different cost and reasoning needs: a user
may want a faster model for extraction or triage and a stronger model for
synthesis without changing `~/.codex/config.toml` or leaving Zotero.

Codex CLI 0.144.1 exposes the authenticated model catalog through
`codex debug models`, accepts `--model` for both new `codex exec` turns and
`codex exec resume`, and emits model/context metadata that the plugin already
parses. The available slugs are provider- and account-dependent, so a static
list would become stale and would break custom Codex gateways.

## Decision

Add an optional `modelSlug` to each sidebar `ChatSession`.

- The compose toolbar shows `Codex default` plus the visible entries returned
  by the active Codex catalog. The plugin does not hardcode model slugs.
- An empty selection means inherit the user's Codex configuration.
- A selected slug is passed as `codex exec --model {slug}` on every turn,
  including resumed turns. Switching models preserves the session's
  `codexThreadId` because Codex explicitly supports a model override on resume.
- The selection is persisted with the Zotero-side chat session and restored
  when the user switches sessions or papers.
- A user-selected model must not silently fall back to the default model. If it
  disappears from the catalog or execution fails, the turn reports an error and
  the user can choose another model. Temporary workflows such as Context Digest
  keep their existing cheap-model-to-default fallback.
- Model selection never edits `~/.codex/config.toml`. Catalog lookup failure
  degrades to the `Codex default` option.

## Consequences

- Different chat sessions for the same paper can use different models while
  retaining independent Codex thread continuity.
- The UI reflects the models actually available through the user's current
  Codex authentication/provider rather than assuming OpenAI-only slugs.
- Conversation messages record the resolved model when usage metadata exposes
  it, making model changes visible in the transcript.
- Reasoning-effort selection was added by ADR 0008 using the same per-session
  ownership and catalog-driven UI.
