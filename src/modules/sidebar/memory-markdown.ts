type MarkdownHeading = {
  index: number;
  level: 2 | 3;
};

export function filterEmptyMarkdownSections(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const headings = findSectionHeadings(lines);
  const headingIndexes = new Set(headings.map((heading) => heading.index));
  const remove = new Set<number>();

  for (const heading of headings) {
    const end = findSectionEnd(headings, heading, lines.length);
    const hasContent = lines
      .slice(heading.index + 1, end)
      .some((line, offset) => {
        const lineIndex = heading.index + offset + 1;
        return line.trim() && !headingIndexes.has(lineIndex);
      });
    if (hasContent) continue;

    remove.add(heading.index);
    for (let index = heading.index + 1; index < end; index += 1) {
      if (lines[index].trim()) break;
      remove.add(index);
    }
  }

  return lines
    .filter((_, index) => !remove.has(index))
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "");
}

export function prepareMemoryMarkdown(markdown: string): string {
  return prepareMarkdownDocument(markdown, "knowledge");
}

export function prepareNotesMarkdown(markdown: string): string {
  return prepareMarkdownDocument(markdown, "notes");
}

export function prepareCodeNotesMarkdown(markdown: string): string {
  return prepareMarkdownDocument(markdown, "code");
}

type MemoryDocumentKind = "knowledge" | "notes" | "code";

function prepareMarkdownDocument(
  markdown: string,
  kind: MemoryDocumentKind,
): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const visible: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let seenVisibleContent = false;
  let inPaperPluginBlock = false;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!fence && fenceMatch) {
      fence = {
        marker: fenceMatch[1].charAt(0) as "`" | "~",
        length: fenceMatch[1].length,
      };
      visible.push(line);
      seenVisibleContent = true;
      continue;
    }
    if (
      fence &&
      new RegExp(
        `^\\s*${escapeRegex(fence.marker)}{${fence.length},}\\s*$`,
      ).test(line)
    ) {
      fence = null;
      visible.push(line);
      continue;
    }
    if (fence) {
      visible.push(line);
      continue;
    }

    if (/^\s*<!--\s*zotero-agent:paper:start\s*-->\s*$/i.test(line)) {
      inPaperPluginBlock = true;
      continue;
    }
    if (/^\s*<!--\s*zotero-agent:paper:end\s*-->\s*$/i.test(line)) {
      inPaperPluginBlock = false;
      continue;
    }
    if (
      isInternalMemoryLine(line, kind, seenVisibleContent, inPaperPluginBlock)
    ) {
      continue;
    }
    visible.push(line);
    if (line.trim()) seenVisibleContent = true;
  }

  return filterEmptyMarkdownSections(
    collapseVisibleBlankLines(visible).join("\n"),
  );
}

function isInternalMemoryLine(
  line: string,
  kind: MemoryDocumentKind,
  seenVisibleContent: boolean,
  inPaperPluginBlock: boolean,
): boolean {
  const leadingDocumentMetadata =
    !seenVisibleContent &&
    (/^\s*#\s+\S/.test(line) || /^\s*>?\s*item\s*key\s*:\s*\S/i.test(line));
  const actionMarker =
    kind === "notes" && /^\s*<!--\s*action-id:\s*[^>]+-->\s*$/i.test(line);
  const knownPluginMarker =
    /^\s*<!--\s*zotero-agent:(?:code:(?:start|end))\s*-->\s*$/i.test(line);
  return (
    leadingDocumentMetadata ||
    actionMarker ||
    knownPluginMarker ||
    (kind === "knowledge" &&
      inPaperPluginBlock &&
      /^\s*\*\*item\s*key:\*\*\s*\S/i.test(line))
  );
}

function collapseVisibleBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let previousBlank = false;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!fence && fenceMatch) {
      fence = {
        marker: fenceMatch[1].charAt(0) as "`" | "~",
        length: fenceMatch[1].length,
      };
      result.push(line);
      previousBlank = false;
      continue;
    }
    if (
      fence &&
      new RegExp(
        `^\\s*${escapeRegex(fence.marker)}{${fence.length},}\\s*$`,
      ).test(line)
    ) {
      fence = null;
      result.push(line);
      previousBlank = false;
      continue;
    }
    const blank = !line.trim();
    if (!fence && blank && previousBlank) continue;
    result.push(line);
    previousBlank = !fence && blank;
  }
  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSectionHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!fence && fenceMatch) {
      fence = {
        marker: fenceMatch[1].charAt(0) as "`" | "~",
        length: fenceMatch[1].length,
      };
      continue;
    }
    if (
      fence &&
      new RegExp(
        `^\\s*${escapeRegex(fence.marker)}{${fence.length},}\\s*$`,
      ).test(line)
    ) {
      fence = null;
      continue;
    }
    if (fence) continue;

    const match = line.match(/^(#{2,3})\s+\S/);
    if (match) headings.push({ index, level: match[1].length as 2 | 3 });
  }
  return headings;
}

function findSectionEnd(
  headings: MarkdownHeading[],
  heading: MarkdownHeading,
  lineCount: number,
): number {
  return (
    headings.find(
      (candidate) =>
        candidate.index > heading.index && candidate.level <= heading.level,
    )?.index || lineCount
  );
}
