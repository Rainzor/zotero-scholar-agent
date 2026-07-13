import { describe, expect, it } from "vitest";
import {
  getCommandMenuItems,
  insertCommandTemplate,
} from "../src/modules/sidebar/command-menu";

describe("command menu", () => {
  it("shows the available action commands when the composer starts with slash", () => {
    expect(getCommandMenuItems("/")).toEqual([
      {
        command: "/note",
        description: "Organize Reader Thinking",
        template: "/note ",
      },
      {
        command: "/rate",
        description: "Set paper rating",
        template: "/rate ",
      },
      {
        command: "/depth",
        description: "Set L0, L1, or L2 depth",
        template: "/depth ",
      },
    ]);
  });

  it("filters commands and inserts a template without submitting", () => {
    expect(getCommandMenuItems("/no")).toHaveLength(1);
    expect(getCommandMenuItems("/de")).toHaveLength(1);
    expect(insertCommandTemplate("prefix", 0, 6, "/note ")).toEqual({
      value: "/note ",
      cursor: 6,
    });
  });

  it("does not open for ordinary text or an embedded slash", () => {
    expect(getCommandMenuItems("question /")).toEqual([]);
    expect(getCommandMenuItems("question")).toEqual([]);
  });
});
