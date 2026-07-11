# UI, Preferences, and Knowledge Status Delivery Plan

> Status: proposed. Each phase requires explicit confirmation before implementation.
>
> Scope: Zotero Agent reader sidebar, preferences window, and main item-tree
> knowledge status. This plan preserves the Codex + Knowledge Vault
> architecture and multi-session behavior.

## Delivery Status

| Phase                                                   | State       |
| ------------------------------------------------------- | ----------- |
| 1. Theme and Layout Foundation                          | Confirmed   |
| 2. Sidebar Reading Flow and Safe Session Actions        | Confirmed   |
| 3. Preferences Information Architecture and Reliability | Confirmed   |
| 4. Main Item-Tree Knowledge Status and Batch Loop       | Not started |

## Decisions Locked for This Plan

- Do not perform the sidebar-wide Chinese localization or full Fluent migration
  in this delivery. Existing locale resources and current pending localization
  edits remain untouched.
- Keep the Knowledge Vault as the source of truth. The main item tree receives
  a cached projection only and never reads the Vault while rendering a cell.
- Use the ItemTreeManager column as the primary knowledge-status surface.
  Automatically writing Zotero tags is deferred and, if added later, must be
  opt-in and disabled by default.
- Preserve existing uncommitted work, especially Cold Start reasoning effort
  support in preferences, the queue, and sidebar.

## Phase 1: Theme and Layout Foundation

### Goal

Make the sidebar and preferences window inherit Zotero light/dark themes
reliably and establish one compact visual language.

### Changes

- Define namespaced semantic CSS tokens for surfaces, text, borders, accent,
  success, warning, danger, code, radii, and type sizes.
- Map tokens to Zotero semantic variables. Component rules must not introduce
  independent hard-coded light-theme colors.
- Split the reader stylesheet by responsibility and add a scoped preferences
  stylesheet. Remove the scaffold `.makeItRed` rule.
- Replace preference-page inline layout dimensions with responsive grid/flex
  rules that allow narrow windows and long localized labels.
- Apply shared button, focus, hover, status, list-selection, and dark-mode
  styling to the sidebar and preferences page.

### Acceptance

- Sidebar and preferences remain readable in Zotero light and dark themes.
- No horizontal overflow at a narrow preferences window width.
- New UI rules use semantic tokens; direct component color literals are
  restricted to token fallbacks and externally required assets.

### Confirmation Gate

Review the resulting theme and layout before behavior changes begin.

## Phase 2: Sidebar Reading Flow and Safe Session Actions

### Goal

Make the paper answer the visual priority and protect destructive session and
message operations.

### Changes

- Render assistant turns as: header, answer, keyword suggestions, trust chips,
  one unified expandable process area, and message metadata/actions.
- Combine reasoning, Codex activity, deterministic checks, and relationship
  details into the process area. Relevant trust chips open and focus their
  corresponding detail section.
- Add a new-session empty state with the paper title and prompt suggestions
  that fill, but do not send, the composer.
- Consolidate all sidebar iconography into the existing SVG icon system and
  reduce avatar visual weight.
- Move rename and delete session actions into an overflow menu. Rename occurs
  inline; session deletion is confirmed in-panel.
- Add a short undo toast for message and session deletions. ChatStore deletion
  receipts restore only when the intervening session state is still compatible.
- Show Edit & resend truncation impact before the user resubmits a message.
- Use a 44px auto-growing composer and simplify model labels to avoid
  duplicated display-name/slug text.
- Make context previews, menus, details, and icon controls keyboard-accessible.
- Extract sidebar responsibilities into cohesive internal modules while
  preserving the existing sidebar facade exports.

### Acceptance

- Completed assistant turns show no more than one process container, and the
  answer appears before all process detail.
- A destructive action can be cancelled or undone without a native prompt or
  confirm dialog.
- The sidebar remains usable at narrow reader-pane widths with keyboard only.

### Confirmation Gate

Review a completed research turn, empty session, rename, delete/undo, and
Edit & resend behavior in Zotero before moving to preferences.

## Phase 3: Preferences Information Architecture and Reliability

### Goal

Explain the two AI paths, remove accidental data loss, and make configuration
changes predictable.

### Changes

- Reorder sections as Knowledge Vault, Codex, Translation Services, and About.
- Explain that Codex powers the reading assistant while Translation Services
  power the translation quick action only.
- Keep Codex path and availability testing visible. Place model override,
  context window, cheap model, and Cold Start reasoning effort under collapsed
  Advanced settings.
- Replace manual Save controls with debounced immediate persistence and a
  single inline status presentation.
- Persist the selected translation-service editor as fields change, preventing
  a service switch from silently discarding edits.
- Add `AIService.testConnection(service)` so Test validates the currently
  edited service rather than the global default service.
- Make Codex detection read-only. A detected executable path is applied only
  through an explicit user action.
- Add native file and directory pickers for the Codex executable and Knowledge
  Vault path.
- Add API key visibility toggle, service-row hover/selection states, a visual
  default marker, and in-panel service removal confirmation.

### Acceptance

- Editing a non-default service and pressing Test exercises that service.
- Switching services never drops an already-entered field value.
- Testing Codex does not mutate persisted configuration.
- Preferences use one save-feedback pattern and work in both themes.

### Confirmation Gate

Review the new user journey from selecting a Vault through testing Codex and
configuring a translation service.

## Phase 4: Main Item-Tree Knowledge Status and Batch Loop

### Goal

Expose Paper Knowledge Record completeness in Zotero's main list without
putting Vault I/O on the item-tree render path.

### Changes

- Add a `KnowledgeStatusIndex` module with a small interface:
  `initialize()`, `getForItem()`, `refresh()`, and `subscribe()`.
- Scan the Vault asynchronously at startup. Read `record.json.quality` as the
  primary completeness projection; use `memory.md` only when a projection is
  absent. Index both the PDF attachment and its parent library item.
- Overlay Cold Start queue state on the durable status. Pending/running jobs
  display as queued/building; failed or cancelled jobs fall back to their
  durable completeness state with failure detail available in the tooltip.
- Register a `Knowledge` ItemTreeManager column for the main tree. The
  synchronous data provider reads only the in-memory index and returns a
  sortable status weight:
  no record, incomplete, queued/building, complete.
- Render compact status dots or a building icon with a tooltip. Register the
  column as visible by default and retain normal Zotero column-picker control.
- Batch tree refreshes across windows after index changes while maintaining the
  current selection.
- Invalidate affected index entries after a Cold Start result, a completed
  research turn that changes the Knowledge Surface, and queue transitions.
- Update the batch menu to enqueue only no-record or incomplete papers, state
  the selected/eligible counts, and hide Cancel when no queue job is active.
- Keep ProgressWindow for detailed batch progress; the list column becomes the
  persistent per-paper progress signal.

### Acceptance

- Rendering or sorting the main item tree never performs Vault filesystem I/O.
- Sorting groups papers by missing, incomplete, in-progress, and complete
  status.
- Queue transitions update the row indicator without losing item selection.
- Batch build skips already complete Paper Knowledge Records by default.

### Confirmation Gate

Review status semantics, default column visibility, sorting, and batch-menu
counts with a library containing complete, incomplete, and queued papers.

## Architecture Records and Verification

- Add ADRs only in the confirmed phase that introduces the decision:
  - Sidebar/pref semantic theme and interaction model.
  - KnowledgeStatusIndex and ItemTreeManager cached-projection model.
- Unit tests cover deletion receipts, process-detail view models, service test
  target selection, immediate persistence, knowledge-status classification,
  queue overlays, parent/attachment lookup, and batch eligibility.
- Each confirmed phase runs `npm test`, `npm run build`, and targeted formatter
  and lint checks. Zotero light/dark manual verification is required for every
  UI phase.
