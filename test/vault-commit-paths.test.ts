import { describe, expect, it } from "vitest";
import { normalizeVaultCommitPaths } from "../src/services/codex/vault";

describe("normalizeVaultCommitPaths", () => {
  it("normalizes and deduplicates action-owned Vault paths", () => {
    expect(
      normalizeVaultCommitPaths([
        "./KEY/notes.md",
        "KEY//conversations/chat-1.md",
        "KEY/notes.md",
      ]),
    ).toEqual(["KEY/notes.md", "KEY/conversations/chat-1.md"]);
  });

  it("rejects paths that can escape the Vault", () => {
    expect(() => normalizeVaultCommitPaths(["../notes.md"])).toThrow(
      /invalid vault commit path/i,
    );
    expect(() => normalizeVaultCommitPaths(["/tmp/notes.md"])).toThrow(
      /invalid vault commit path/i,
    );
    expect(() => normalizeVaultCommitPaths([":(glob)**"])).toThrow(
      /invalid vault commit path/i,
    );
    expect(() => normalizeVaultCommitPaths(["."])).toThrow(
      /invalid vault commit path/i,
    );
  });
});
