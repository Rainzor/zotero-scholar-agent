export function extractPaperKeywords(text: string): string[] {
  const firstPage = String(text || "").split(/\[page\s+2\]/i)[0];
  const match = firstPage.match(
    /^(?:key\s*words|keywords|index terms)\s*[:—-]\s*(.+)$/im,
  );
  return normalizeKeywords(match?.[1]?.split(/[;,|]/) || []);
}

export function extractKeywordSuggestions(content: string): {
  content: string;
  suggestions: string[];
} {
  const text = String(content || "");
  const suggestions: string[] = [];
  const cleaned = text.replace(
    /<!--\s*keyword-suggestions\s*:\s*([\s\S]*?)-->/gi,
    (_marker, values: string) => {
      suggestions.push(...String(values || "").split(/[;,|]/));
      return "";
    },
  );
  return {
    content: cleaned.trim(),
    suggestions: normalizeKeywords(suggestions),
  };
}

function normalizeKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const keyword = String(value || "").trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}
