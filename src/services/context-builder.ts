import { estimateTokens } from "../utils/token-estimate";

export type PromptMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type BuildContextOptions = {
  systemMessage: PromptMessage;
  currentMessage: PromptMessage;
  history: PromptMessage[];
  maxContextTokens: number;
  outputReserve?: number;
};

const DROPPED_SUMMARY_MARKER = "[Dropped History Summary]";

export function buildContextMessages(
  options: BuildContextOptions,
): PromptMessage[] {
  const {
    systemMessage,
    currentMessage,
    history,
    maxContextTokens,
    outputReserve = 4096,
  } = options;

  const systemTokens = estimateTokens(systemMessage.content || "") + 4;
  const currentTokens = estimateTokens(currentMessage.content || "") + 4;
  const fixedCost = systemTokens + currentTokens + outputReserve;
  let historyBudget = maxContextTokens - fixedCost;
  if (historyBudget <= 0) {
    return [systemMessage, currentMessage];
  }

  const included: PromptMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgCost = estimateTokens(msg.content || "") + 4;
    if (historyBudget - msgCost < 0) break;
    historyBudget -= msgCost;
    included.unshift(msg);
  }

  const droppedCount = history.length - included.length;
  if (droppedCount > 0) {
    const droppedSummary = buildCondensedSummary(
      history.slice(0, droppedCount),
    );
    const summaryCost = estimateTokens(droppedSummary) + 4;
    if (historyBudget >= summaryCost) {
      included.unshift({
        role: "assistant",
        content: droppedSummary,
      });
    }
  }

  return [systemMessage, ...included, currentMessage];
}

export function truncateDocContext(text: string, maxTokens: number): string {
  if (!text || maxTokens <= 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;

  const suffix =
    "\n\n[... Document content truncated to fit model context window ...]";
  let left = 0;
  let right = text.length;
  let best = "";
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candidate = `${text.slice(0, mid)}${suffix}`;
    if (estimateTokens(candidate) <= maxTokens) {
      best = candidate;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return best || suffix;
}

function buildCondensedSummary(messages: PromptMessage[]): string {
  const lines = [
    `${DROPPED_SUMMARY_MARKER} Earlier turns were trimmed to fit context:`,
  ];
  for (const msg of messages) {
    const role =
      msg.role === "user"
        ? "User"
        : msg.role === "assistant"
          ? "Assistant"
          : "System";
    const normalized = (msg.content || "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const clipped =
      normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
    lines.push(`- ${role}: ${clipped}`);
  }
  return lines.join("\n");
}
