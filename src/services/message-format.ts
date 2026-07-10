import type { ChatMessage } from "../addon";

/**
 * Compact machine-context rendering of one visible chat message, shared by the
 * research prompt (fresh-thread injection) and the Context Digest prompt.
 */
export function formatVisibleMessage(
  index: number,
  message: ChatMessage,
): string {
  const content = String(message.content || "").trim();
  const reasoning = String(message.reasoning || "").trim();
  if (!content && !reasoning) return "";
  const role = message.role === "user" ? "User" : "Assistant";
  const parts = [`[${index}] ${role}:`];
  if (message.contextPapers?.length) {
    parts.push(
      `@ papers: ${message.contextPapers
        .map((paper) => `${paper.title || paper.itemKey} (${paper.itemKey})`)
        .join(", ")}`,
    );
  }
  if (content) parts.push(content);
  if (reasoning) parts.push(`Reasoning summary:\n${summarizeText(reasoning)}`);
  if (message.activities?.length) {
    parts.push(
      `Tool outcomes: ${message.activities
        .map((activity) =>
          [
            activity.command,
            activity.status ? `status=${activity.status}` : "",
            typeof activity.exitCode === "number"
              ? `exit=${activity.exitCode}`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join("; ")}`,
    );
  }
  if (message.usage?.contextUsedPercent) {
    parts.push(`Context usage: ${message.usage.contextUsedPercent}%`);
  }
  return parts.join("\n");
}

export function summarizeText(text: string, max = 360): string {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}
