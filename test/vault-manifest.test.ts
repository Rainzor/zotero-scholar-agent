import { describe, expect, it } from "vitest";
import {
  CURRENT_VAULT_MANIFEST,
  mergeVaultGitignore,
  normalizeVaultManifest,
} from "../src/services/codex/vault-manifest";

describe("Vault manifest", () => {
  it("normalizes missing and legacy manifests to the current schema", () => {
    expect(normalizeVaultManifest(null)).toEqual(CURRENT_VAULT_MANIFEST);
    expect(
      normalizeVaultManifest({
        schemaVersion: 1,
        knowledgeSurfaceVersion: 0,
      }),
    ).toEqual(CURRENT_VAULT_MANIFEST);
  });

  it("merges required ignores without removing user rules", () => {
    expect(mergeVaultGitignore("custom.tmp\n*/code/\n")).toBe(
      [
        "custom.tmp",
        "*/code/",
        ".logs/",
        ".generated/",
        "*/figures/local/",
        "*/figures/generated/",
        "",
      ].join("\n"),
    );
  });

  it("refuses to downgrade a newer Vault schema", () => {
    expect(() => normalizeVaultManifest({ schemaVersion: 2 })).toThrow(
      "newer than supported",
    );
  });
});
