import type { TokenUsage } from "../addon";

export function formatCodexUsageLine(usage: TokenUsage): string {
  const input = usage.promptTokens || 0;
  const output = usage.completionTokens || 0;
  const cached = usage.cachedInputTokens || 0;
  const reasoning = usage.reasoningTokens || 0;
  const window =
    usage.effectiveContextWindowTokens || usage.contextWindowTokens || 0;

  const parts: string[] = [];
  if (window > 0 && input > 0) {
    const percent =
      typeof usage.contextUsedPercent === "number"
        ? formatPercent(usage.contextUsedPercent)
        : formatPercent((input / window) * 100);
    parts.push(`Context ${formatTokenCount(input)} / ${formatTokenCount(window)} (${percent})`);
  } else if (input > 0) {
    parts.push(`Context input ${formatTokenCount(input)}`);
  }

  if (cached > 0) parts.push(`cached ${formatTokenCount(cached)}`);
  if (output > 0) parts.push(`out ${formatTokenCount(output)}`);
  if (reasoning > 0) parts.push(`reasoning ${formatTokenCount(reasoning)}`);
  if (!window && input > 0) parts.push("window unknown");

  if (parts.length) return parts.join(" · ");

  const total = usage.totalTokens ?? input + output;
  return total > 0 ? `Tokens: ${formatTokenCount(total)}` : "";
}

export function buildCodexUsageTitle(usage?: TokenUsage): string {
  if (!usage) return "";
  const source = usage.contextSource || "unknown";
  const model = usage.modelSlug ? `Model: ${usage.modelSlug}` : "Model: unknown";
  const rawWindow = usage.contextWindowTokens
    ? `Raw context window: ${usage.contextWindowTokens}`
    : "Raw context window: unknown";
  const effectiveWindow = usage.effectiveContextWindowTokens
    ? `Effective context window: ${usage.effectiveContextWindowTokens}`
    : "Effective context window: unknown";
  return [model, rawWindow, effectiveWindow, `Source: ${source}`].join("\n");
}

export function formatTokenCount(value: number): string {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1_000_000) return `${trimFixed(n / 1_000_000)}M`;
  if (n >= 1000) return `${trimFixed(n / 1000)}k`;
  return String(Math.round(n));
}

function formatPercent(value: number): string {
  return `${trimFixed(value)}%`;
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
