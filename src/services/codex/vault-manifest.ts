import { WORKFLOW_SKILL_VERSION } from "./workflow-skills";

export type VaultManifest = {
  schemaVersion: 1;
  knowledgeSurfaceVersion: 2;
  recordProjectionVersion: 3;
  workflowSkillVersion: number;
};

export const CURRENT_VAULT_MANIFEST: VaultManifest = {
  schemaVersion: 1,
  knowledgeSurfaceVersion: 2,
  recordProjectionVersion: 3,
  workflowSkillVersion: WORKFLOW_SKILL_VERSION,
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

export function isCurrentVaultManifest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<VaultManifest>;
  return (
    Number(manifest.schemaVersion) === CURRENT_VAULT_MANIFEST.schemaVersion &&
    Number(manifest.knowledgeSurfaceVersion) ===
      CURRENT_VAULT_MANIFEST.knowledgeSurfaceVersion &&
    Number(manifest.recordProjectionVersion) ===
      CURRENT_VAULT_MANIFEST.recordProjectionVersion &&
    Number(manifest.workflowSkillVersion) ===
      CURRENT_VAULT_MANIFEST.workflowSkillVersion
  );
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
