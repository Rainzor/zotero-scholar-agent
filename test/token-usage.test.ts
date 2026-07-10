import { describe, expect, it } from "vitest";
import {
  buildCodexUsageTitle,
  formatCodexUsageLine,
  formatTokenCount,
} from "../src/utils/token-usage";

describe("formatTokenCount", () => {
  it("uses compact token units", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1200)).toBe("1.2k");
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });
});

describe("formatCodexUsageLine", () => {
  it("formats compact per-turn usage without claiming context occupancy", () => {
    expect(
      formatCodexUsageLine({
        promptTokens: 38200,
        completionTokens: 2100,
        cachedInputTokens: 31000,
        reasoningTokens: 1400,
        effectiveContextWindowTokens: 128000,
        contextUsedPercent: 29.8,
      }),
    ).toBe("in 38.2k · cache 31k · out 2.1k · think 1.4k");
  });

  it("uses the same simple labels when the window is unknown", () => {
    expect(
      formatCodexUsageLine({
        promptTokens: 38200,
        completionTokens: 2100,
        cachedInputTokens: 31000,
      }),
    ).toBe("in 38.2k · cache 31k · out 2.1k");
  });
});

describe("buildCodexUsageTitle", () => {
  it("surfaces model and context metadata", () => {
    const title = buildCodexUsageTitle({
      promptTokens: 38200,
      cachedInputTokens: 31000,
      completionTokens: 2100,
      reasoningTokens: 1400,
      contextUsedPercent: 29.8,
      modelSlug: "gpt-5.5",
      contextSource: "codex-config",
      contextWindowTokens: 272000,
      effectiveContextWindowTokens: 258400,
    });
    expect(title).toContain("Turn input (cumulative): 38200");
    expect(title).toContain("Context usage: unavailable");
    expect(title).toContain("Model: gpt-5.5");
  });
});
