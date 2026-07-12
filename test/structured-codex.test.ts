import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildStructuredCodexArgs,
  captureStructuredFinalMessage,
  parseStructuredCodexContent,
} from "../src/services/codex/structured";
import { parseCodexEventLine } from "../src/services/codex/events";

describe("structured Codex turns", () => {
  it("builds a searched, ephemeral, read-only exec invocation", () => {
    expect(
      buildStructuredCodexArgs({
        vaultDir: "/vault",
        prompt: "Return JSON.",
        schemaPath: "/vault/.generated/schemas/note.json",
        model: "gpt-5.6-terra",
        reasoningEffort: "high",
        webSearch: true,
        ephemeral: true,
        sandbox: "read-only",
      }),
    ).toEqual([
      "--search",
      "exec",
      "--json",
      "-c",
      'model_reasoning_effort="high"',
      "--model",
      "gpt-5.6-terra",
      "-C",
      "/vault",
      "-s",
      "read-only",
      "--ephemeral",
      "--output-schema",
      "/vault/.generated/schemas/note.json",
      "Return JSON.",
    ]);
  });

  it("parses a schema-shaped JSON final response", () => {
    expect(
      parseStructuredCodexContent(
        '```json\n{"section":"Actions","markdown":"- Re-run the baseline.","summary":"Action captured."}\n```',
      ),
    ).toEqual({
      section: "Actions",
      markdown: "- Re-run the baseline.",
      summary: "Action captured.",
    });
  });

  it("rejects non-JSON output", () => {
    expect(() => parseStructuredCodexContent("Saved the note.")).toThrow(
      /valid JSON/i,
    );
  });

  it("uses only the final agent message from a structured Codex turn", () => {
    const lines = readFileSync(
      new URL(
        "./fixtures/codex-structured-multiple-messages.jsonl",
        import.meta.url,
      ),
      "utf8",
    )
      .trim()
      .split("\n");
    let finalMessage = "";
    for (const line of lines) {
      const event = parseCodexEventLine(line);
      if (event) {
        finalMessage = captureStructuredFinalMessage(finalMessage, event);
      }
    }

    expect(parseStructuredCodexContent(finalMessage)).toEqual({
      section: "Actions",
      markdown:
        "- Stage I: inherit the video prior.\n- Stage II: train a bidirectional world model.\n- Stage III: distill a causal student.",
      summary: "Organized the three-stage training path.",
    });
  });
});
