---
status: accepted
track: both
---

# Preferences: debounced persistence, read-only Codex detection, and per-service testing

## Context

The preferences pane grew a manual-Save-button pattern per section (Codex,
Vault, AI Services), each with its own status text convention. Three
reliability problems followed from this shape:

- The Codex "Test" button doubled as detection _and_ silent persistence — a
  successful auto-detect immediately overwrote the configured path pref, with
  no read-only step to review the result first.
- The AI-service "Test" button called `AIService.chat()`, which always
  resolves the persisted default service, never the service currently
  selected/edited in the pane. Testing a non-default or unsaved edit silently
  tested the wrong config.
- The service editor is a single shared form reused for every row. Selecting
  a different service, or clicking Add/Remove, unconditionally overwrote the
  form from persisted data with no dirty check, silently discarding
  unsaved edits.

## Decision

Manual Save buttons are removed. Every preferences field persists through a
debounced (~500ms) write, reported through one shared status presentation
(`idle | saving | saved | error`) per section instead of separate
button-triggered toasts. `src/utils/debounce.ts` provides `cancel()`/`flush()`
so a pending write can be committed immediately before the UI reuses the same
form for a different target (switching the selected AI service, or
navigating away) — this is what makes switching services lossless: edits are
persisted as the user types, not held only in the DOM.

Codex detection is split into two buttons: **Detect**, which runs
auto-detection and fills the path field (persisted the same way manual typing
is — through the normal debounce), and **Test**, which validates the current
path and never writes to `Zotero.Prefs` regardless of outcome. Detect ignores
any already-configured path (`detectCodexBinary()` in
`src/services/codex/path.ts`, factored out of `resolveCodexBinary()`'s
auto-detect branch as `findByAutoDetection()`) so it can recover from a
previously persisted path that no longer works — notably an fnm
`fnm_multishells/<pid>_.../bin/codex` symlink from a since-closed shell
session, which `resolveCodexBinary()` would otherwise keep re-validating and
returning as-is once it's configured. Auto-detected paths are additionally
resolved to a stable absolute path via `nsIFile.normalize()` (falling back to
the original path if the resolved target doesn't exist), so what gets
persisted survives the originating shell session ending. A **Browse** button
(and one for the Knowledge Vault directory) uses `zotero-plugin-toolkit`'s
existing `FilePickerHelper` (`ztoolkit.FilePicker`) rather than a hand-rolled
picker.

`AIService.getConfig()`'s body is extracted into a pure
`buildConfigFromService(svc)` helper. `AIService.testConnection(config)` is
added, taking an explicit `ServiceConfig` instead of reading the persisted
default; `chat()` gains an optional `configOverride` for this purpose. The
service editor's Test button builds this config directly from the live form
fields, so it always exercises what's on screen, not the saved default.

The preferences pane is reordered to Knowledge Vault → Codex → Translation
Services → About, with the Codex/Translation-Services descriptions stating
explicitly that Codex powers the reading assistant while Translation
Services power only the popup Translate action. Codex's model override,
context window, cheap model, and Cold Start reasoning effort move into a
collapsed Advanced `<details>`, matching the existing turn-details disclosure
pattern used in the chat sidebar. Service removal requires an in-panel
confirm, modeled on the sidebar's existing session-delete confirm.

`src/modules/preferences.ts` (516 lines) is split into
`src/modules/preferences/{index,status,vault-section,codex-section,services-section,services-editor,services-list,ids}.ts`,
mirroring the sidebar's facade-plus-submodules structure.

## Consequences

- Testing Codex is now guaranteed side-effect-free; applying a detected path
  is visible (the field fills) before it's saved, rather than silent.
- Detect can recover from an already-broken configured path (e.g. a dead fnm
  shell symlink) instead of re-confirming it forever, because it bypasses the
  configured-path check entirely rather than reusing `resolveCodexBinary()`'s
  normal (configured-path-first) resolution order.
- Testing an AI service always reflects the form's current values, whether or
  not they've been persisted yet.
- No dirty-tracking/confirm-discard UI was needed for the service editor —
  debounced persistence made data loss on switch structurally impossible
  instead of guarded against.
- Every section now shares one status vocabulary and one persistence
  mechanism instead of three divergent Save-button implementations.
