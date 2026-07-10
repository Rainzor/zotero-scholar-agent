import { describe, expect, it } from "vitest";
import {
  enrichUsageWithContext,
  parseCodexModelCatalog,
  parseTopLevelTomlString,
  selectCatalogModel,
} from "../src/services/codex/context-window";

describe("parseCodexModelCatalog", () => {
  it("parses model context metadata from noisy Codex output", () => {
    const catalog = parseCodexModelCatalog(
      [
        "WARNING: proceeding anyway",
        JSON.stringify({
          models: [
            {
              slug: "gpt-5.5",
              display_name: "GPT-5.5",
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast" },
                { effort: "medium", description: "Balanced" },
                { effort: "high", description: "Deep" },
              ],
              context_window: 272000,
              max_context_window: 1000000,
              effective_context_window_percent: 95,
              priority: 0,
              visibility: "list",
            },
          ],
        }),
      ].join("\n"),
    );

    expect(catalog).toEqual([
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { effort: "low", description: "Fast" },
          { effort: "medium", description: "Balanced" },
          { effort: "high", description: "Deep" },
        ],
        contextWindowTokens: 272000,
        maxContextWindowTokens: 1000000,
        effectiveContextWindowPercent: 95,
        priority: 0,
        visibility: "list",
      },
    ]);
  });

  it("returns an empty catalog for invalid JSON", () => {
    expect(parseCodexModelCatalog("not-json")).toEqual([]);
  });
});

describe("parseTopLevelTomlString", () => {
  it("reads only top-level model from config.toml", () => {
    expect(
      parseTopLevelTomlString(
        [
          "# comment",
          'model = "gpt-5.5" # trailing comment',
          "",
          "[profiles.proxy]",
          'model = "other"',
        ].join("\n"),
        "model",
      ),
    ).toBe("gpt-5.5");
  });

  it("ignores model values inside sections", () => {
    expect(
      parseTopLevelTomlString(["[profiles.proxy]", 'model = "other"'].join("\n"), "model"),
    ).toBe("");
  });
});

describe("selectCatalogModel", () => {
  const catalog = [
    { slug: "slow", contextWindowTokens: 32000, priority: 10 },
    { slug: "gpt-5.5", displayName: "GPT-5.5", contextWindowTokens: 272000, priority: 0 },
  ];

  it("prefers an exact configured slug", () => {
    expect(selectCatalogModel(catalog, "slow")?.slug).toBe("slow");
  });

  it("falls back to the highest-priority model with a context window", () => {
    expect(selectCatalogModel(catalog)?.slug).toBe("gpt-5.5");
  });
});

describe("enrichUsageWithContext", () => {
  it("adds model metadata without treating cumulative turn input as context occupancy", () => {
    const usage = enrichUsageWithContext(
      {
        promptTokens: 25840,
        completionTokens: 100,
        totalTokens: 25940,
        cachedInputTokens: 12000,
        reasoningTokens: 80,
      },
      {
        modelSlug: "gpt-5.5",
        contextWindowTokens: 272000,
        effectiveContextWindowTokens: 258400,
        contextSource: "codex-config",
      },
    );
    expect(usage).toMatchObject({
      contextWindowTokens: 272000,
      effectiveContextWindowTokens: 258400,
      contextSource: "codex-config",
      modelSlug: "gpt-5.5",
    });
    expect(usage?.contextUsedPercent).toBeUndefined();
  });
});
