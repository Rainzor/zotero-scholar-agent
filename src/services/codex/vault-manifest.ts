export type VaultManifest = {
  schemaVersion: 1;
  knowledgeSurfaceVersion: 1;
  recordProjectionVersion: 2;
};

export const CURRENT_VAULT_MANIFEST: VaultManifest = {
  schemaVersion: 1,
  knowledgeSurfaceVersion: 1,
  recordProjectionVersion: 2,
};

const REQUIRED_GITIGNORE_RULES = [
  "*/code/",
  ".logs/",
  ".generated/",
  "*/figures/local/",
  "*/figures/generated/",
] as const;

export function normalizeVaultManifest(value: unknown): VaultManifest {
  const version =
    value && typeof value === "object"
      ? Number((value as Partial<VaultManifest>).schemaVersion || 0)
      : 0;
  if (version > CURRENT_VAULT_MANIFEST.schemaVersion) {
    throw new Error(
      `Vault schema ${version} is newer than supported schema ${CURRENT_VAULT_MANIFEST.schemaVersion}.`,
    );
  }
  return { ...CURRENT_VAULT_MANIFEST };
}

export function mergeVaultGitignore(existing: string): string {
  const lines = String(existing || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const seen = new Set(lines);
  for (const rule of REQUIRED_GITIGNORE_RULES) {
    if (seen.has(rule)) continue;
    seen.add(rule);
    lines.push(rule);
  }
  return `${lines.join("\n")}\n`;
}
