---
status: accepted
track: both
---

# Unify agent-busy status into one tab-agnostic status bar

## Context

The reader sidebar's Chat and Memory views are a pure CSS `display`
toggle (`switchChatView`); both subtrees always exist in the DOM. Codex
busy-status was nonetheless split across two disconnected, tab-specific
locations: Chat's `showAgentStatus`/`hideAgentStatus` injected an
animated pill _inside the last assistant message bubble_
(`#zoteroagent-chat-messages`), invisible whenever Memory is active;
each of four Memory-panel actions (Build/Repair/PDF-enrichment/Code
analysis) wrote into its own inline `<span>`, invisible whenever Chat is
active. Switching tabs mid-action hid the status text while the shared
`isGenerating` flag kept the composer/controls locked, with no visible
explanation.

Separately, `renderMemoryBrowse` fully wipes and rebuilds
`#zoteroagent-memory-body` — triggered not only by tab switches but by
Zotero's global "tab" notifier (fires ~300ms after _any_ tab event
anywhere in the app), every section re-render, and manual refresh/sort.
The four Memory action starters held closures over the specific
`status`/`button` DOM nodes passed to them at click time; a mid-action
rebuild orphaned those nodes silently (`isSafeBody(body)` checks the
outer pane, not the specific span), so progress writes kept "succeeding"
against a detached node while the freshly rebuilt row showed a frozen,
stale label.

A second, independent race existed in Cancel: the cold-start row's
click handler wrote "Initialization cancelled." synchronously, but the
killed subprocess's promise settled later and its own `catch`/`finally`
— unaware the abort was deliberate — overwrote that with an "...failed"
message. Three action kinds (Code Analysis, Topic Note creation, Tier
Upgrade) had no Cancel UI wired to the shared `abortGeneration` kill
switch at all, despite populating the same `activeCodexProcess` slot.

## Decision

Relocate the existing, already-well-designed animated pill (pulsing
accent dot, shimmer sweep, fade-in — ADR 0009 tokens) out of the
per-message bubble into one persistent status slot mounted in
`.zoteroagent-header-wrap`, which `switchChatView` never toggles. Every
action that reports Codex progress — the prior 6 Chat call sites, the 4
Memory-panel actions, and (newly) Topic Note creation and Tier Upgrade —
routes through this one bar via `src/modules/sidebar/agent-status-bar.ts`.
`showAgentStatus`/`hideAgentStatus` keep their exact signatures and
delegate internally, so the original Chat call sites needed no edits.

The bar tracks an integer token (`slot.dataset.statusToken`), bumped on
every `showBusyStatus`/`showNoticeStatus` call. Each caller captures its
own token and checks `isTokenCurrent` before writing a later update;
`abortGeneration` writes an authoritative "Cancelled." notice, so any
stale write from the aborted operation detects it lost the race and
skips itself. `body.dataset.coldStartBusy` is removed — re-entry is
`isGenerating`, "who owns this status" is the token.

Memory action rows no longer thread `status`/`button` nodes into their
async starters, closing the staleness class of bug structurally: the row
keeps only durable, quality-derived text (re-rendered fresh each time),
while live progress and terminal outcomes go to the bar, which is never
destroyed by `renderMemoryBrowse`. Buttons no longer double as Cancel —
they simply disable while `isGenerating` (extending the existing
`setGenerating` disabled-controls selector), matching the pattern Code
Analysis already used. The one live-mutation this removes —
`PaperTextUnavailableError` flipping a button's own `dataset.action` to
`"enrich-pdf"` in place — is replaced with a module-level
`paperNeedsPdfEnrichment` set, mirroring the existing `codeAnalysisNotices`
precedent that already survives rebuilds correctly.

Cancel is a plain "Stop" text control, reusing the exact word and
treatment already shipped on the composer's Send↔Stop button (both call
`abortGeneration`) — no new icon, keeping one verb for one action.

## Consequences

- Codex busy/notice status is visible regardless of which tab is
  active, and survives `renderMemoryBrowse` rebuilds.
- Code Analysis, Topic Note creation, and Tier Upgrade gain a working
  Cancel for the first time, as a side effect of routing through the
  shared bar rather than new Cancel-specific code.
- The Cancel-vs-failure race is fixed for every action kind that uses
  the token, not just cold start.
- `showAgentStatus`'s old scroll-pinning logic (`isNearBottom`/
  `scrollToBottomIfPinned`) is dropped; the bar sits outside the
  scrolling message list, so nothing needs to stay pinned when it
  appears or disappears.
- `src/modules/sidebar/agent-status-bar.ts` stays untested per this
  project's convention for DOM-builder modules (no jsdom in
  `vitest.config.ts`; `feedback.ts`/`turn-details-view.ts` have no test
  files either); the one pure addition, `AGENT_STATUS_NOTICE_AUTO_DISMISS_MS`
  in `src/services/agent-status.ts`, is covered in `test/agent-status.test.ts`.
