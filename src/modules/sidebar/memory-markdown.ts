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

function findSectionHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1].charAt(0);
      fence = fence === marker ? "" : fence || marker;
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
