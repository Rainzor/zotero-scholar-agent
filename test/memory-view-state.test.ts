import { describe, it, expect } from "vitest";
import {
  initialMemorySearchState,
  nextMemorySearchState,
  isSelectionAllowed,
  type MemorySearchState,
} from "../src/modules/sidebar/memory-view-state";

describe("nextMemorySearchState", () => {
  it("starts in browse with no filter or query", () => {
    expect(initialMemorySearchState).toEqual({
      view: "browse",
      filterText: "",
      searchQuery: "",
    });
  });

  it("filtering stays in browse and clears any search query", () => {
    const searching: MemorySearchState = {
      view: "search",
      filterText: "",
      searchQuery: "flow matching",
    };
    const next = nextMemorySearchState(searching, {
      type: "filter",
      text: "magi",
    });
    expect(next).toEqual({ view: "browse", filterText: "magi", searchQuery: "" });
  });

  it("opening search clears the filter and enters search view", () => {
    const filtered: MemorySearchState = {
      view: "browse",
      filterText: "gaussian",
      searchQuery: "",
    };
    const next = nextMemorySearchState(filtered, { type: "openSearch" });
    expect(next).toEqual({ view: "search", filterText: "", searchQuery: "" });
  });

  it("a non-empty search keeps search view and records the query", () => {
    const next = nextMemorySearchState(initialMemorySearchState, {
      type: "search",
      query: "causal video",
    });
    expect(next).toEqual({
      view: "search",
      filterText: "",
      searchQuery: "causal video",
    });
  });

  it("an empty search collapses back to browse", () => {
    const searching: MemorySearchState = {
      view: "search",
      filterText: "",
      searchQuery: "old",
    };
    const next = nextMemorySearchState(searching, { type: "search", query: "  " });
    expect(next).toEqual({ view: "browse", filterText: "", searchQuery: "" });
  });

  it("closing search returns to a clean browse view", () => {
    const searching: MemorySearchState = {
      view: "search",
      filterText: "",
      searchQuery: "x",
    };
    expect(nextMemorySearchState(searching, { type: "closeSearch" })).toEqual({
      view: "browse",
      filterText: "",
      searchQuery: "",
    });
  });
});

describe("isSelectionAllowed", () => {
  it("allows topic selection only while browsing", () => {
    expect(isSelectionAllowed({ view: "browse", filterText: "", searchQuery: "" })).toBe(
      true,
    );
    expect(isSelectionAllowed({ view: "search", filterText: "", searchQuery: "q" })).toBe(
      false,
    );
  });
});
