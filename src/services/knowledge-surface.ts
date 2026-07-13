import { parse, stringify } from "yaml";

export const PAPER_TIERS = ["L0", "L1", "L2", "L3"] as const;
export type PaperTier = (typeof PAPER_TIERS)[number];

export const PAPER_VALUE_TYPES = [
  "method-advance",
  "transferable-insight",
  "methodology",
  "canon",
] as const;
export type PaperValueType = (typeof PAPER_VALUE_TYPES)[number];

export function valueTypeLabel(valueType: PaperValueType): string {
  if (valueType === "method-advance") return "Method";
  if (valueType === "transferable-insight") return "Insight";
  if (valueType === "methodology") return "Methodology";
  return "Canon";
}

export function valueTypeDescription(valueType: PaperValueType): string {
  if (valueType === "method-advance")
    return "This paper itself advances a method or technique.";
  if (valueType === "transferable-insight")
    return "The value is a transferable insight — not necessarily the method itself.";
  if (valueType === "methodology")
    return "This paper represents a broader methodology worth understanding on its own.";
  return "A foundational, canonical paper that defines terminology or framing for the field.";
}

export const TIER_SECTION_SHAPES = {
  L0: ["Verdict", "Why Stop Here", "Better Pointers", "Library Connections"],
  L1: ["TL;DR", "Contribution", "Method", "Takeaways", "Library Connections"],
  L2: [
    "Contribution",
    "Problem",
    "Method",
    "Insight",
    "Results",
    "Takeaways",
    "Library Connections",
  ],
  L3: [
    "Contribution",
    "Problem",
    "Method",
    "Insight",
    "Results",
    "Takeaways",
    "Library Connections",
  ],
} as const satisfies Record<PaperTier, readonly string[]>;

export type ZoteroCollectionSignal = {
  key: string;
  name: string;
  path: string;
};

export type PaperSignalMetadata = {
  tier: PaperTier;
  valueTypes: PaperValueType[];
  rating: number | null;
  zoteroCollections: ZoteroCollectionSignal[];
  zoteroTags: string[];
  paperKeywords: string[];
  codexKeywords: string[];
};

export type PaperSignalUpdate = Partial<PaperSignalMetadata>;

const DEFAULT_SIGNALS: PaperSignalMetadata = {
  tier: "L1",
  valueTypes: [],
  rating: null,
  zoteroCollections: [],
  zoteroTags: [],
  paperKeywords: [],
  codexKeywords: [],
};

export const KNOWLEDGE_SURFACE_PLUGIN_START =
  "<!-- zotero-agent:paper:start -->";
export const KNOWLEDGE_SURFACE_PLUGIN_END = "<!-- zotero-agent:paper:end -->";

type KnowledgeSurfaceMeta = {
  itemKey: string;
  title: string;
  creators?: string;
  year?: string;
  abstract?: string;
};

export function parseKnowledgeSurface(markdown: string): {
  signals: PaperSignalMetadata;
  body: string;
} {
  const text = String(markdown || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/);
  if (!match) {
    return { signals: { ...DEFAULT_SIGNALS }, body: text };
  }
  let parsed: unknown = {};
  try {
    parsed = parse(match[1]) || {};
  } catch {
    parsed = {};
  }
  return {
    signals: normalizePaperSignals(parsed),
    body: text.slice(match[0].length),
  };
}

export function updateKnowledgeSurfaceSignals(
  markdown: string,
  update: PaperSignalUpdate,
): string {
  const current = parseKnowledgeSurface(markdown);
  const signals = normalizePaperSignals({
    ...current.signals,
    ...update,
  });
  const frontmatter = stringify(signals, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${current.body}`;
}

export function replaceKnowledgeSurfaceSection(
  markdown: string,
  heading: string,
  content: string,
): string {
  const text = String(markdown || "");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^##\\s+${escaped}\\s*\\r?\\n)([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`,
    "m",
  );
  const replacement = `$1\n${String(content || "").trim()}\n\n`;
  if (pattern.test(text)) return text.replace(pattern, replacement);
  return `${text.trimEnd()}\n\n## ${heading}\n\n${String(content || "").trim()}\n`;
}

export function normalizePaperSignals(value: unknown): PaperSignalMetadata {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<PaperSignalMetadata>)
      : {};
  return {
    tier: normalizePaperTier(raw.tier),
    valueTypes: normalizeValueTypes(raw.valueTypes),
    rating: normalizeRating(raw.rating),
    zoteroCollections: normalizeCollections(raw.zoteroCollections),
    zoteroTags: normalizeStrings(raw.zoteroTags),
    paperKeywords: normalizeStrings(raw.paperKeywords),
    codexKeywords: normalizeStrings(raw.codexKeywords),
  };
}

export function buildKnowledgeSurfacePluginBlock(
  meta: KnowledgeSurfaceMeta,
  fallbackAbstract = "",
): string {
  const abstract =
    String(meta.abstract || "").trim() ||
    String(fallbackAbstract || "").trim() ||
    "_Source abstract unavailable._";
  const bibliography = [
    `**Title:** ${meta.title || meta.itemKey}`,
    meta.creators ? `**Authors:** ${meta.creators}` : "",
    meta.year ? `**Year:** ${meta.year}` : "",
    `**Item Key:** ${meta.itemKey}`,
  ].filter(Boolean);
  return [
    KNOWLEDGE_SURFACE_PLUGIN_START,
    "## Bibliography",
    "",
    ...bibliography,
    "",
    "## Abstract",
    "",
    abstract,
    KNOWLEDGE_SURFACE_PLUGIN_END,
  ].join("\n");
}

export function refreshKnowledgeSurfacePluginBlock(
  markdown: string,
  meta: KnowledgeSurfaceMeta,
): string {
  const current = parseKnowledgeSurface(markdown);
  const existingBlock = extractMarkedBlock(
    current.body,
    KNOWLEDGE_SURFACE_PLUGIN_START,
    KNOWLEDGE_SURFACE_PLUGIN_END,
  );
  const fallbackAbstract = existingBlock
    ? parseH2Sections(existingBlock).get("Abstract") || ""
    : parseH2Sections(current.body).get("Abstract") || "";
  const replacement = buildKnowledgeSurfacePluginBlock(
    meta,
    fallbackAbstract.replace(/<!--[\s\S]*?-->/g, "").trim(),
  );
  const body = existingBlock
    ? replaceMarkedBlock(
        current.body,
        KNOWLEDGE_SURFACE_PLUGIN_START,
        KNOWLEDGE_SURFACE_PLUGIN_END,
        replacement,
      )
    : `${replacement}\n\n${current.body.trimStart()}`;
  return updateKnowledgeSurfaceSignals(body, current.signals);
}

export function restoreKnowledgeSurfaceOwnership(
  after: string,
  before: string,
  meta: KnowledgeSurfaceMeta,
): string {
  const beforeSignals = parseKnowledgeSurface(before).signals;
  const refreshed = refreshKnowledgeSurfacePluginBlock(after, meta);
  return updateKnowledgeSurfaceSignals(refreshed, beforeSignals);
}

export function replaceKnowledgeSurfaceInterpretation(
  markdown: string,
  interpretationMarkdown: string,
  targetTier: Exclude<PaperTier, "L3">,
): string {
  const current = parseKnowledgeSurface(markdown);
  const end = current.body.indexOf(KNOWLEDGE_SURFACE_PLUGIN_END);
  if (end < 0) {
    throw new Error("Knowledge Surface plugin block is missing.");
  }
  const ownedEnd = end + KNOWLEDGE_SURFACE_PLUGIN_END.length;
  const body = `${current.body.slice(0, ownedEnd).trimEnd()}\n\n${String(
    interpretationMarkdown || "",
  ).trim()}\n`;
  return updateKnowledgeSurfaceSignals(body, {
    ...current.signals,
    tier: targetTier,
  });
}

export function buildTierInterpretationTemplate(tier: PaperTier): string {
  const lines: string[] = [];
  for (const section of TIER_SECTION_SHAPES[tier]) {
    lines.push(`## ${section}`, "");
    if (section === "Library Connections") {
      lines.push("### Semantic Relationships", "");
    }
  }
  return lines.join("\n");
}

export function buildInitialNotesMarkdown(meta: KnowledgeSurfaceMeta): string {
  return [
    `# Reader Thinking: ${meta.title || meta.itemKey}`,
    "",
    `> itemKey: ${meta.itemKey}`,
    "",
    "## Reading Context",
    "",
    "## Actions",
    "",
    "## Thoughts and Critique",
    "",
  ].join("\n");
}

export type PaperNoteSection =
  | "Reading Context"
  | "Actions"
  | "Thoughts and Critique";

export function insertPaperNoteEntry(
  markdown: string,
  entry: {
    section: PaperNoteSection;
    date: string;
    author: "user" | "agent, user-confirmed";
    content: string;
    actionId?: string;
  },
): string {
  const source = String(markdown || "").trimEnd();
  const heading = `## ${entry.section}`;
  const start = source.indexOf(heading);
  if (start < 0) {
    throw new Error(`Reader Thinking section is missing: ${entry.section}`);
  }
  const contentStart = start + heading.length;
  const nextHeadingMatch = source.slice(contentStart).match(/\n##\s+[^\n]+\n?/);
  const insertAt = nextHeadingMatch
    ? contentStart + (nextHeadingMatch.index || 0)
    : source.length;
  const block = [
    "",
    `### ${entry.date} [${entry.author}]`,
    entry.actionId ? `<!-- action-id: ${entry.actionId} -->` : "",
    "",
    String(entry.content || "").trim(),
    "",
  ]
    .filter((line, index, lines) => line || lines[index - 1] !== "")
    .join("\n");
  return (
    `${source.slice(0, insertAt).trimEnd()}\n${block}${source
      .slice(insertAt)
      .replace(/^\n*/, "\n")}`.trimEnd() + "\n"
  );
}

export function migrateKnowledgeSurfaceV2(options: {
  markdown: string;
  meta: KnowledgeSurfaceMeta;
  migratedAt: string;
  existingNotes?: string;
}): {
  memoryMarkdown: string;
  notesMarkdown: string;
  tier: PaperTier;
} {
  const current = parseKnowledgeSurface(options.markdown);
  if (
    current.body.includes(KNOWLEDGE_SURFACE_PLUGIN_START) &&
    current.body.includes(KNOWLEDGE_SURFACE_PLUGIN_END)
  ) {
    const existingNotes = String(options.existingNotes || "").trim();
    return {
      memoryMarkdown: updateKnowledgeSurfaceSignals(options.markdown, {
        ...current.signals,
      }),
      notesMarkdown: existingNotes
        ? `${existingNotes}\n`
        : buildInitialNotesMarkdown(options.meta),
      tier: current.signals.tier,
    };
  }

  const sections = parseH2Sections(current.body);
  const legacyAbstract = sections.get("Abstract") || "";
  const readerThinking = sections.get("Reader Thinking") || "";
  const tier: PaperTier = TIER_SECTION_SHAPES.L2.every((section) =>
    section === "Library Connections"
      ? sections.has(section)
      : hasSubstantiveContent(sections.get(section) || ""),
  )
    ? "L2"
    : "L1";
  const interpretation =
    tier === "L2"
      ? buildMigratedL2Interpretation(sections)
      : buildMigratedL1Interpretation(sections);
  const body = [
    `# ${options.meta.title || options.meta.itemKey}`,
    "",
    `> itemKey: ${options.meta.itemKey}`,
    "",
    buildKnowledgeSurfacePluginBlock(options.meta, legacyAbstract),
    "",
    interpretation,
  ].join("\n");
  const memoryMarkdown = updateKnowledgeSurfaceSignals(body, {
    ...current.signals,
    tier,
  });
  const notesMarkdown = migrateReaderThinkingToNotes(
    options.existingNotes,
    options.meta,
    readerThinking,
    options.migratedAt,
  );
  return { memoryMarkdown, notesMarkdown, tier };
}

function buildMigratedL2Interpretation(sections: Map<string, string>): string {
  const preserved = buildPreservedLegacyMaterial(sections);
  return [
    ...["Contribution", "Problem", "Method", "Insight", "Results", "Takeaways"],
    "Library Connections",
  ]
    .map((heading) => {
      const content = cleanLegacySection(sections.get(heading) || "", heading);
      if (heading === "Library Connections") {
        return `## ${heading}\n\n${content || "### Semantic Relationships"}`;
      }
      return `## ${heading}\n\n${
        heading === "Takeaways"
          ? [content, preserved].filter(Boolean).join("\n\n")
          : content
      }`;
    })
    .join("\n\n");
}

function buildMigratedL1Interpretation(sections: Map<string, string>): string {
  const advanced = ["Problem", "Insight", "Results"]
    .map((heading) => {
      const content = cleanLegacySection(sections.get(heading) || "", heading);
      return content ? `### ${heading}\n\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const takeaway = cleanLegacySection(
    sections.get("Takeaways") || "",
    "Takeaways",
  );
  const preserved = buildPreservedLegacyMaterial(sections);
  return [
    `## TL;DR\n\n${cleanLegacySection(
      sections.get("Contribution") || "",
      "Contribution",
    )}`,
    `## Contribution\n\n${cleanLegacySection(sections.get("Contribution") || "", "Contribution")}`,
    `## Method\n\n${cleanLegacySection(sections.get("Method") || "", "Method")}`,
    `## Takeaways\n\n${[takeaway, advanced, preserved]
      .filter(Boolean)
      .join("\n\n")}`,
    `## Library Connections\n\n${
      cleanLegacySection(
        sections.get("Library Connections") || "",
        "Library Connections",
      ) || "### Semantic Relationships"
    }`,
  ].join("\n\n");
}

function buildPreservedLegacyMaterial(sections: Map<string, string>): string {
  const known = new Set([
    "Bibliography",
    "Abstract",
    "Contribution",
    "Problem",
    "Method",
    "Insight",
    "Results",
    "Takeaways",
    "Reader Thinking",
    "Library Connections",
  ]);
  const preserved: string[] = [];
  const evidence = String(sections.get("Evidence Pointers") || "").trim();
  if (evidence) {
    preserved.push(`### Legacy evidence notes\n\n${evidence}`);
  }
  for (const [heading, content] of sections) {
    if (
      known.has(heading) ||
      heading === "Evidence Pointers" ||
      !content.trim()
    ) {
      continue;
    }
    preserved.push(`### ${heading}\n\n${content.trim()}`);
  }
  return preserved.length
    ? `### Preserved Legacy Material\n\n${preserved.join("\n\n")}`
    : "";
}

function migrateReaderThinkingToNotes(
  existingNotes: string | undefined,
  meta: KnowledgeSurfaceMeta,
  readerThinking: string,
  migratedAt: string,
): string {
  const existing = String(existingNotes || "").trim();
  const initial = buildInitialNotesMarkdown(meta).trimEnd();
  const content = String(readerThinking || "").trim();
  const base = existing || initial;
  if (!content || base.includes(content)) return `${base}\n`;
  return `${base}\n\n### ${migratedAt} [user]\n\n${content}\n`;
}

function parseH2Sections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = Array.from(
    String(markdown || "").matchAll(/^##\s+(.+?)\s*$/gm),
  );
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = Number(match.index || 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? Number(matches[index + 1].index || markdown.length)
        : markdown.length;
    const title = String(match[1] || "").trim();
    const content = markdown.slice(start, end).trim();
    const existing = sections.get(title);
    sections.set(
      title,
      existing && content ? `${existing}\n\n${content}` : existing || content,
    );
  }
  return sections;
}

function extractMarkedBlock(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) return "";
  return text.slice(startIndex, endIndex + end.length);
}

function replaceMarkedBlock(
  text: string,
  start: string,
  end: string,
  replacement: string,
): string {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex <= startIndex) return text;
  return `${text.slice(0, startIndex)}${replacement}${text.slice(endIndex + end.length)}`;
}

function cleanLegacySection(content: string, heading: string): string {
  let cleaned = String(content || "").trim();
  if (heading === "Library Connections") {
    cleaned = cleaned.replace(/^###\s+Explicit Citations\s*$/gm, "").trim();
  }
  return cleaned;
}

function hasSubstantiveContent(content: string): boolean {
  const normalized = String(content || "")
    .replace(/^#{3,}\s+.*$/gm, "")
    .trim()
    .toLowerCase();
  return Boolean(
    normalized &&
    normalized !== "tbd" &&
    normalized !== "todo" &&
    normalized !== "_not yet distilled._" &&
    normalized !== "not yet distilled.",
  );
}

function normalizePaperTier(value: unknown): PaperTier {
  const tier = String(value || "").trim();
  return (PAPER_TIERS as readonly string[]).includes(tier)
    ? (tier as PaperTier)
    : "L1";
}

function normalizeValueTypes(value: unknown): PaperValueType[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(PAPER_VALUE_TYPES);
  const seen = new Set<string>();
  const result: PaperValueType[] = [];
  for (const entry of value) {
    const normalized = String(entry || "").trim();
    if (!allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized as PaperValueType);
  }
  return result;
}

function normalizeRating(value: unknown): number | null {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

function normalizeCollections(value: unknown): ZoteroCollectionSignal[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: ZoteroCollectionSignal[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Partial<ZoteroCollectionSignal>;
    const key = String(raw.key || "").trim();
    const name = String(raw.name || "").trim();
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      name,
      path: String(raw.path || name).trim() || name,
    });
  }
  return result;
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = String(entry || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}
