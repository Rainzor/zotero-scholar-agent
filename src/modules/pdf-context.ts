export async function getFullText(itemId: number): Promise<string> {
  try {
    const fullText = await Zotero.PDFWorker.getFullText(itemId, null);
    return trimReferences((fullText?.text as string) || "");
  } catch {
    return "";
  }
}

function trimReferences(content: string) {
  if (!content) return "";
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) =>
    /^(references|bibliography|参考文献|acknowledgements?)$/i.test(line.trim()),
  );
  return (index >= 0 ? lines.slice(0, index) : lines).join("\n").trim();
}
