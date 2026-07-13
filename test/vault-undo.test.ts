import { describe, expect, it } from "vitest";
import { canUndoVaultAction } from "../src/services/codex/vault";

describe("canUndoVaultAction", () => {
  it("allows undo only when HEAD is the action commit", () => {
    expect(canUndoVaultAction("abc", "abc")).toEqual({ allowed: true });
    expect(canUndoVaultAction("newer", "abc")).toEqual({
      allowed: false,
      reason: "Vault has newer updates.",
    });
  });
});
