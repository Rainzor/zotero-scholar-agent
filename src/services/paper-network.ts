import {
  getPaperVaultPaths,
  listVaultPapers,
  type PaperVaultMeta,
} from "./codex/vault";
import {
  type PaperRecordProjection,
  type SemanticRelationship,
} from "./codex/vault-format";

export type PaperBacklink = {
  source: PaperVaultMeta;
  relationship: SemanticRelationship;
};

export function collectPaperBacklinks(
  records: Array<{
    paper: PaperVaultMeta;
    relationships: SemanticRelationship[];
  }>,
  targetItemKey: string,
): PaperBacklink[] {
  return records
    .flatMap(({ paper, relationships }) =>
      relationships
        .filter((relationship) => relationship.targetItemKey === targetItemKey)
        .map((relationship) => ({ source: paper, relationship })),
    )
    .sort((a, b) =>
      String(a.source.title || a.source.itemKey).localeCompare(
        String(b.source.title || b.source.itemKey),
      ),
    );
}

export async function listPaperBacklinks(
  targetItemKey: string,
): Promise<PaperBacklink[]> {
  const papers = await listVaultPapers();
  const records = await Promise.all(
    papers
      .filter((paper) => paper.itemKey !== targetItemKey)
      .map(async (paper) => {
        const paths = await getPaperVaultPaths(paper.itemKey);
        return {
          paper,
          relationships: await readProjectedRelationships(paths.recordPath),
        };
      }),
  );
  return collectPaperBacklinks(records, targetItemKey);
}

async function readProjectedRelationships(
  recordPath: string,
): Promise<SemanticRelationship[]> {
  try {
    const ioUtils = (globalThis as any).IOUtils;
    if (!ioUtils || !(await ioUtils.exists(recordPath))) return [];
    const parsed = JSON.parse(
      String(await ioUtils.readUTF8(recordPath)),
    ) as Partial<PaperRecordProjection>;
    return Array.isArray(parsed.relationships) ? parsed.relationships : [];
  } catch {
    return [];
  }
}
