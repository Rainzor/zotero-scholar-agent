/**
 * Pure state for the Memory toolbar's two mutually-exclusive text affordances:
 * an instant local list filter (browse view) and a full-text Vault search
 * (search view). Keeping the transition rules here — rather than scattered
 * across DOM event handlers — makes the "filter and search never both apply,
 * and the selection UI only shows while browsing" invariants testable.
 */
export type MemoryView = "browse" | "search";

export interface MemorySearchState {
  view: MemoryView;
  filterText: string;
  searchQuery: string;
}

export type MemoryAction =
  | { type: "filter"; text: string }
  | { type: "openSearch" }
  | { type: "search"; query: string }
  | { type: "closeSearch" };

export const initialMemorySearchState: MemorySearchState = {
  view: "browse",
  filterText: "",
  searchQuery: "",
};

export function nextMemorySearchState(
  state: MemorySearchState,
  action: MemoryAction,
): MemorySearchState {
  switch (action.type) {
    case "filter":
      // Filtering is browse-only; typing in the filter always returns to browse
      // and clears any active search query.
      return { view: "browse", filterText: action.text, searchQuery: "" };
    case "openSearch":
      return { view: "search", filterText: "", searchQuery: "" };
    case "search":
      // An empty query collapses search mode back to a clean browse view.
      return action.query.trim()
        ? { view: "search", filterText: "", searchQuery: action.query }
        : { view: "browse", filterText: "", searchQuery: "" };
    case "closeSearch":
      return { view: "browse", filterText: "", searchQuery: "" };
    default:
      return state;
  }
}

/** The topic-selection UI (checkboxes, sticky bar) only shows while browsing. */
export function isSelectionAllowed(state: MemorySearchState): boolean {
  return state.view === "browse";
}
