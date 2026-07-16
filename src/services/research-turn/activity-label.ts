export function formatActivityLabel(command: string): string {
  const clean = unwrapShellCommand(command);
  if (!clean) return "Run command";

  const sed = clean.match(
    /^sed\s+(?:-[A-Za-z]+\s+)*["']?(\d+)\s*,\s*(\d+)p["']?\s+(.+)$/,
  );
  if (sed) {
    return `Read ${fileName(sed[3])} (lines ${sed[1]}–${sed[2]})`;
  }

  const rg = clean.match(/^rg\s+(?:-[\w-]+\s+)*["']([^"']+)["']\s+(.+)$/);
  if (rg) return `Search ${fileName(rg[2])} for "${rg[1]}"`;

  const cat = clean.match(/^cat\s+(.+)$/);
  if (cat) return `Read ${fileName(firstArgument(cat[1]))}`;

  const ls = clean.match(/^ls(?:\s+-[\w-]+)*\s*(.*)$/);
  if (ls) {
    const target = firstArgument(ls[1]);
    return target ? `List files in ${fileName(target)}` : "List files";
  }

  if (/^git\s+status\b/.test(clean)) return "Check git status";
  if (/^git\s+diff\b/.test(clean)) return "Review git changes";
  if (/^git\b/.test(clean)) return "Run git command";

  return `Run command: ${truncate(clean, 160)}`;
}

function unwrapShellCommand(command: string): string {
  const clean = String(command || "")
    .replace(/\s+/g, " ")
    .trim();
  const match = clean.match(/^(?:\S*\/)?(?:zsh|bash|sh)\s+-lc\s+(["'])(.*)\1$/);
  return (match ? match[2] : clean).trim();
}

function firstArgument(value: string): string {
  const clean = String(value || "").trim();
  const quoted = clean.match(/^["']([^"']+)["']/);
  return quoted?.[1] || clean.split(/\s+/)[0] || "";
}

function fileName(value: string): string {
  const clean = String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.at(-1) || clean || "file";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}
