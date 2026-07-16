---
status: accepted
track: both
---

# Make Chat the authorization boundary for agent actions

## Context

Research operations were split between Chat and writable controls in Memory.
That made authorization inconsistent: a normal Codex answer could update the
In-Focus Paper, while Note, depth, code, Topic, rating, and repair operations
used unrelated UI paths and persistence rules. It also made Memory both a
reading surface and an editing console.

The product direction requires one conversational entry point while preserving
the existing distinction between Codex Sessions, Conversation Logs, and durable
Paper Knowledge Records.

## Decision

Chat is the only entry point for research actions. `ChatSendFlow` receives an
immutable submission snapshot and routes exact commands or high-confidence
instructions without adding a classification turn to ordinary research Q&A.
Unknown slash commands return local help.

Actions are versioned records attached to `ChatMessage`. Their fixed lifecycle
is `proposed | running | completed | failed | cancelled | dismissed | undone`.
A persisted `running` action is normalized to a retryable interrupted failure
after restart. Action Cards are the authorization and audit surface.

Special Codex work uses independent structured turns with an output JSON Schema,
explicit sandbox mode, optional Search, and ephemeral session storage. Codex
analyzes in read-only mode; the plugin owns final paths, writes, validation,
git commits, and later Undo. Project workflow Skills under `.agents/skills/`
define analysis method and output quality but never grant capabilities.

The first vertical slice is `/note`: command content falls back to selected PDF
text or a quoted reply, Codex organizes it through the
`zotero-reader-note` Skill, and the plugin appends an
`[agent, user-confirmed]` entry to `notes.md`. The original user submission is
preserved in its Conversation Log. Both files are saved in one path-scoped
Vault commit whose receipt is stored on the Action Card.

The local-knowledge slice adds deterministic `/rate 1..5` and structured,
read-only `/depth L0|L1|L2`. The plugin restores ownership blocks, enforces
tier-aware quality gates, writes projections, and commits only action-owned
paths. Memory displays Rating and Depth read-only after their Chat replacements
ship.

Undo is conservative. Rating and Depth use `git revert --no-edit`; Note appends
a retraction rather than deleting the original entry. Undo is allowed only
while Vault `HEAD` is the action commit, so newer research work is never
silently overwritten.

Memory removes its Add Thought control in this slice. Remaining writable Memory
controls migrate in later bounded deliveries before Memory becomes fully
read-only.

## Consequences

- Normal research turns retain their current Codex thread and automatic
  In-Focus Paper Knowledge Surface updates.
- Note actions are independently retryable, cancellable, reviewable, and do
  not rely on mutable composer DOM after submission.
- Chat persistence remains version 2; old messages need no migration.
- Workflow Skill updates are plugin-owned, versioned by
  `workflowSkillVersion`, and committed without absorbing unrelated Vault
  changes.
- Depth, rating, and conservative Undo shipped in this decision's
  local-knowledge slice. Code, Topic, build, repair, PDF enrichment,
  relationship proposals, and action suggestions remain later phases.
