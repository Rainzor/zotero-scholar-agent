import {
  KNOWLEDGE_SURFACE_PLUGIN_END,
  KNOWLEDGE_SURFACE_PLUGIN_START,
  TIER_SECTION_SHAPES,
  parseKnowledgeSurface,
  type PaperTier,
} from "./knowledge-surface";
import { parseSemanticRelationships } from "./codex/vault-format";

export const CORE_KNOWLEDGE_SECTIONS = [
  "TL;DR",
  "Contribution",
  "Problem",
  "Method",
  "Insight",
  "Results",
  "Takeaways",
  "Verdict",
  "Why Stop Here",
  "Better Pointers",
  "Library Connections",
] as const;

export type CoreKnowledgeSection = (typeof CORE_KNOWLEDGE_SECTIONS)[number];

export type KnowledgeQualityReport = {
  status: "passed" | "needs-review" | "failed";
  tier: PaperTier;
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
  codeNotes?: string;
  allowTierChange?: boolean;
}): KnowledgeQualityReport {
  const parsedAfter = parseKnowledgeSurface(options.after);
  const afterBody = parsedAfter.body;
  const tier = inferQualityTier(
    options.after,
    afterBody,
    parsedAfter.signals.tier,
  );
  const beforeBody = parseKnowledgeSurface(options.before || "").body;
  const sections = parseH2Sections(afterBody);
  const missing: CoreKnowledgeSection[] = [];
  const placeholder: CoreKnowledgeSection[] = [];
  const hardFailures: string[] = [];
  const warnings: string[] = [];

  for (const section of TIER_SECTION_SHAPES[tier]) {
    if (!sections.has(section)) {
      missing.push(section);
      continue;
    }
    if (
      section !== "Library Connections" &&
      isPlaceholderContent(sections.get(section) || "")
    ) {
      placeholder.push(section);
    }
  }
  if (missing.length) {
    hardFailures.push(`Missing core sections: ${missing.join(", ")}`);
  }
  if (placeholder.length) {
    hardFailures.push(`Placeholder core sections: ${placeholder.join(", ")}`);
  }
  const requiresPluginBlock =
    hasExplicitTier(options.after) ||
    Boolean(extractPluginBlock(options.before || ""));
  const pluginBlock = extractPluginBlock(options.after);
  if (requiresPluginBlock && !pluginBlock) {
    hardFailures.push(
      "Plugin-owned bibliography/abstract block is missing or malformed.",
    );
  }
  const beforePluginBlock = extractPluginBlock(options.before || "");
  if (
    beforePluginBlock &&
    pluginBlock &&
    normalizeBlock(beforePluginBlock) !== normalizeBlock(pluginBlock)
  ) {
    hardFailures.push(
      "Plugin-owned bibliography/abstract block changed during the turn.",
    );
  }
  const beforeSignals = parseKnowledgeSurface(options.before || "").signals;
  const comparableBeforeSignals = options.allowTierChange
    ? { ...beforeSignals, tier: parsedAfter.signals.tier }
    : beforeSignals;
  if (
    options.before &&
    JSON.stringify(comparableBeforeSignals) !==
      JSON.stringify(parsedAfter.signals)
  ) {
    hardFailures.push("Plugin-owned YAML frontmatter changed during the turn.");
  }
  if (tier === "L3" && !hasSubstantiveCodeNotes(options.codeNotes || "")) {
    hardFailures.push("L3 requires a populated code-notes.md.");
  }

  const abstractText = String(sections.get("Abstract") || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
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

  const beforeLength = stripPluginOwnedContent(beforeBody).trim().length;
  const afterLength = stripPluginOwnedContent(afterBody).trim().length;
  const ratio =
    beforeLength > 0
      ? Number((afterLength / beforeLength).toFixed(3))
      : undefined;
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
    tier,
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

export function isUnbuiltSkeleton(
  quality: Pick<KnowledgeQualityReport, "coreSections">,
): boolean {
  return (
    quality.coreSections.missing.length +
      quality.coreSections.placeholder.length >=
    4
  );
}

function stripPluginOwnedContent(markdown: string): string {
  return String(markdown || "").replace(
    /<!--\s*zotero-agent:paper:start\s*-->[\s\S]*?<!--\s*zotero-agent:paper:end\s*-->/gi,
    "",
  );
}

function inferQualityTier(
  markdown: string,
  body: string,
  parsedTier: PaperTier,
): PaperTier {
  if (hasExplicitTier(markdown)) {
    return parsedTier;
  }
  const sections = parseH2Sections(body);
  return ["Problem", "Insight", "Results"].some((section) =>
    sections.has(section),
  )
    ? "L2"
    : parsedTier;
}

function hasExplicitTier(markdown: string): boolean {
  return /^---[\s\S]*?^tier:\s*L[0-3]\s*$/m.test(String(markdown || ""));
}

function extractPluginBlock(markdown: string): string {
  const text = String(markdown || "");
  const start = text.indexOf(KNOWLEDGE_SURFACE_PLUGIN_START);
  const end = text.indexOf(KNOWLEDGE_SURFACE_PLUGIN_END);
  if (start < 0 || end <= start) return "";
  return text.slice(start, end + KNOWLEDGE_SURFACE_PLUGIN_END.length);
}

function normalizeBlock(value: string): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function hasSubstantiveCodeNotes(markdown: string): boolean {
  const body = String(markdown || "")
    .replace(
      /<!--\s*zotero-agent:code:start\s*-->[\s\S]*?<!--\s*zotero-agent:code:end\s*-->/gi,
      "",
    )
    .replace(/^#.+$/gm, "")
    .replace(/^##.+$/gm, "")
    .trim();
  return body.length >= 40;
}

function extractSemanticRelationshipBlock(markdown: string): string {
  const text = String(markdown || "");
  const libraryHeading = /^##\s+Library Connections\s*$/im.exec(text);
  if (!libraryHeading || typeof libraryHeading.index !== "number") return "";
  const libraryRest = text.slice(
    libraryHeading.index + libraryHeading[0].length,
  );
  const nextH2 = /^##\s+.+$/m.exec(libraryRest);
  const libraryBlock =
    nextH2 && typeof nextH2.index === "number"
      ? libraryRest.slice(0, nextH2.index)
      : libraryRest;
  const heading = /^###\s+Semantic Relationships\s*$/im.exec(libraryBlock);
  if (!heading || typeof heading.index !== "number") return "";
  const rest = libraryBlock.slice(heading.index + heading[0].length);
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
