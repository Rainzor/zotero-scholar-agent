---
status: accepted
track: frontend
---

# Put the answer before execution detail in the reader sidebar

## Context

A completed Codex turn could display reasoning, command activity, automated
checks, keyword review, and relationship review before the answer. In a narrow
reader sidebar this hid the user's primary reading surface behind several
independent boxes. Session and message deletion also had inconsistent
protection, including native prompt dialogs and irreversible single-click
message deletion.

## Decision

Completed assistant turns render in this order:

1. Message header and answer.
2. Keyword suggestions.
3. Trust chips.
4. One collapsed Run details disclosure.
5. Usage and message actions.

Run details combines reasoning, Codex activity, deterministic checks, and
Semantic Relationship review. Trust chips that have details are buttons that
open and focus the corresponding section. Streaming retains only the temporary
Agent status; the completed render moves all persistent process information
after the answer.

Activity step count appears only in the Run details summary. It is not repeated
as a trust chip because it is process metadata rather than an independent trust
signal.

Session rename and deletion use in-panel controls. Session deletion requires
confirmation. Message and session deletions produce a short undo toast backed
by ChatStore receipts. A receipt restores only when the item state has not
changed since deletion.

## Consequences

- The answer remains the stable reading priority while provenance stays
  discoverable.
- Deletion undo is intentionally conservative: any later item-state change
  invalidates the receipt.
- Hidden Context Digest is shown only when one exists or compaction is running;
  manual compaction moves to the session overflow menu.
- Sidebar chrome uses one SVG icon system and keyboard-accessible disclosure,
  menus, context previews, and message actions.
