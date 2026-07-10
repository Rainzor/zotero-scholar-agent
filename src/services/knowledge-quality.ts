import { parseKnowledgeSurface } from "./knowledge-surface";
import { parseSemanticRelationships } from "./codex/vault-format";

export const CORE_KNOWLEDGE_SECTIONS = [
  "Abstract",
  "Contribution",
  "Problem",
  "Method",
  "Insight",
  "Results",
  "Takeaways",
] as const;

export type CoreKnowledgeSection = (typeof CORE_KNOWLEDGE_SECTIONS)[number];

export type KnowledgeQualityReport = {
  status: "passed" | "needs-review" | "failed";
  checkedAt: string;
  hardFailures: string[];
  warnings: string[];
  coreSections: {
    missing: CoreKnowledgeSection[];
    placeholder: CoreKnowledgeSection[];
  };
  abstract: {
    status: "unchanged" | "changed" | "source-unavailable" | "missing";
  };
  relationships: {
    candidates: number;
    parsed: number;
  };
  growth: {
    ratio?: number;
    reviewRequired: boolean;
  };
};

export function evaluateKnowledgeSurface(options: {
  before?: string;
  after: string;
  sourceAbstract?: string;
  itemKey?: string;
  checkedAt?: string;
}): KnowledgeQualityReport {
  const afterBody = parseKnowledgeSurface(options.after).body;
  const beforeBody = parseKnowledgeSurface(options.before || "").body;
  const sections = parseH2Sections(afterBody);
  const missing: CoreKnowledgeSection[] = [];
  const placeholder: CoreKnowledgeSection[] = [];
  const hardFailures: string[] = [];
  const warnings: string[] = [];

  for (const section of CORE_KNOWLEDGE_SECTIONS) {
    if (!sections.has(section)) {
      missing.push(section);
      continue;
    }
    if (isPlaceholderContent(sections.get(section) || "")) {
      placeholder.push(section);
    }
  }
  if (missing.length) {
    hardFailures.push(`Missing core sections: ${missing.join(", ")}`);
  }
  if (placeholder.length) {
    hardFailures.push(
      `Placeholder core sections: ${placeholder.join(", ")}`,
    );
  }

  const abstractText = String(sections.get("Abstract") || "").trim();
  const abstract = evaluateAbstract(abstractText, options.sourceAbstract);
  if (abstract.status === "missing") {
    hardFailures.push("Abstract is missing.");
  } else if (abstract.status === "changed") {
    warnings.push("Abstract differs materially from the source abstract.");
  } else if (abstract.status === "source-unavailable") {
    warnings.push("Source abstract is unavailable for fidelity checking.");
  }

  const relationshipBlock = extractSemanticRelationshipBlock(afterBody);
  const candidateLines =
    relationshipBlock.match(/^\s*-\s+\[[a-z_]+\]\s+.+$/gim) || [];
  const parsedRelationships = parseSemanticRelationships(
    relationshipBlock,
    options.itemKey || "CURRENT",
    options.checkedAt || new Date().toISOString(),
  );
  if (parsedRelationships.length < candidateLines.length) {
    hardFailures.push("One or more Semantic Relationship lines are malformed.");
  }

  const beforeLength = beforeBody.trim().length;
  const afterLength = afterBody.trim().length;
  const ratio =
    beforeLength > 0 ? Number((afterLength / beforeLength).toFixed(3)) : undefined;
  const growthReviewRequired =
    beforeLength >= 200 && typeof ratio === "number" && ratio > 1.25;
  if (growthReviewRequired) {
    warnings.push("Knowledge Surface grew by more than 25% in one turn.");
  }

  return {
    status: hardFailures.length
      ? "failed"
      : warnings.length
        ? "needs-review"
        : "passed",
    checkedAt: options.checkedAt || new Date().toISOString(),
    hardFailures,
    warnings,
    coreSections: { missing, placeholder },
    abstract,
    relationships: {
      candidates: candidateLines.length,
      parsed: parsedRelationships.length,
    },
    growth: {
      ratio,
      reviewRequired: growthReviewRequired,
    },
  };
}

function extractSemanticRelationshipBlock(markdown: string): string {
  const text = String(markdown || "");
  const heading = /^###\s+Semantic Relationships\s*$/im.exec(text);
  if (!heading || typeof heading.index !== "number") return "";
  const rest = text.slice(heading.index + heading[0].length);
  const nextHeading = /^#{2,3}\s+.+$/m.exec(rest);
  return nextHeading && typeof nextHeading.index === "number"
    ? rest.slice(0, nextHeading.index)
    : rest;
}

function parseH2Sections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const pattern = /^##\s+(.+?)\s*$/gm;
  const matches = Array.from(markdown.matchAll(pattern));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const title = String(match[1] || "").trim();
    const start = Number(match.index || 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? Number(matches[index + 1].index || markdown.length)
        : markdown.length;
    sections.set(title, markdown.slice(start, end).trim());
  }
  return sections;
}

function isPlaceholderContent(content: string): boolean {
  const normalized = String(content || "")
    .replace(/^###\s+.*$/gm, "")
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    normalized === "tbd" ||
    normalized === "todo" ||
    normalized === "_not yet distilled._" ||
    normalized === "not yet distilled."
  );
}

function evaluateAbstract(
  abstractText: string,
  sourceAbstract?: string,
): KnowledgeQualityReport["abstract"] {
  if (!abstractText) return { status: "missing" };
  const source = normalizeComparisonText(sourceAbstract || "");
  if (!source) return { status: "source-unavailable" };
  const candidate = normalizeComparisonText(abstractText);
  return {
    status:
      candidate === source ||
      candidate.includes(source) ||
      source.includes(candidate)
        ? "unchanged"
        : "changed",
  };
}

function normalizeComparisonText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
