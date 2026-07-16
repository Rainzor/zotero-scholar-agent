import { describe, it, expect } from "vitest";
import { TopicSelectionController } from "../src/modules/sidebar/topic-selection";

describe("TopicSelectionController", () => {
  it("starts inactive and empty", () => {
    const c = new TopicSelectionController();
    expect(c.isActive()).toBe(false);
    expect(c.size()).toBe(0);
    expect(c.canCreate()).toBe(false);
  });

  it("enters selection mode without adding papers", () => {
    const c = new TopicSelectionController();
    c.enter();
    expect(c.isActive()).toBe(true);
    expect(c.size()).toBe(0);
  });

  it("toggles paper membership on and off", () => {
    const c = new TopicSelectionController();
    c.enter();
    c.toggle("AAA", true);
    c.toggle("BBB", true);
    expect(c.has("AAA")).toBe(true);
    expect(c.size()).toBe(2);
    c.toggle("AAA", false);
    expect(c.has("AAA")).toBe(false);
    expect(c.size()).toBe(1);
  });

  it("requires at least two papers to create", () => {
    const c = new TopicSelectionController();
    c.enter();
    c.toggle("AAA", true);
    expect(c.canCreate()).toBe(false);
    c.toggle("BBB", true);
    expect(c.canCreate()).toBe(true);
  });

  it("cancel clears selection and leaves selection mode", () => {
    const c = new TopicSelectionController();
    c.enter();
    c.toggle("AAA", true);
    c.toggle("BBB", true);
    c.cancel();
    expect(c.isActive()).toBe(false);
    expect(c.size()).toBe(0);
    expect(c.keys()).toEqual([]);
  });

  it("clear empties selection but stays in selection mode", () => {
    const c = new TopicSelectionController();
    c.enter();
    c.toggle("AAA", true);
    c.clear();
    expect(c.isActive()).toBe(true);
    expect(c.size()).toBe(0);
  });

  it("keys returns the selected item keys", () => {
    const c = new TopicSelectionController();
    c.enter();
    c.toggle("AAA", true);
    c.toggle("BBB", true);
    expect(c.keys().sort()).toEqual(["AAA", "BBB"]);
  });
});
