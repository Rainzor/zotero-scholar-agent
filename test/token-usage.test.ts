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
  it("formats Codex context usage with a known window", () => {
    expect(
      formatCodexUsageLine({
        promptTokens: 38200,
        completionTokens: 2100,
        cachedInputTokens: 31000,
        reasoningTokens: 1400,
        effectiveContextWindowTokens: 128000,
        contextUsedPercent: 29.8,
      }),
    ).toBe("Context 38.2k / 128k (29.8%) · cached 31k · out 2.1k · reasoning 1.4k");
  });

  it("does not invent a percent when the window is unknown", () => {
    expect(
      formatCodexUsageLine({
        promptTokens: 38200,
        completionTokens: 2100,
        cachedInputTokens: 31000,
      }),
    ).toBe("Context input 38.2k · cached 31k · out 2.1k · window unknown");
  });
});

describe("buildCodexUsageTitle", () => {
  it("surfaces model and context metadata", () => {
    expect(
      buildCodexUsageTitle({
        modelSlug: "gpt-5.5",
        contextSource: "codex-config",
        contextWindowTokens: 272000,
        effectiveContextWindowTokens: 258400,
      }),
    ).toContain("Model: gpt-5.5");
  });
});
