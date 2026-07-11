import { describe, expect, it } from "vitest";
import { extractCodexPath } from "../src/services/codex/path";

describe("extractCodexPath", () => {
  it("keeps a plain extensionless codex path untouched", () => {
    expect(extractCodexPath("/opt/homebrew/bin/codex")).toBe(
      "/opt/homebrew/bin/codex",
    );
  });

  it("does not truncate a resolved codex.js target", () => {
    const path =
      "/Users/runzewang/.local/share/fnm/node-versions/v24.3.0/installation/lib/node_modules/@openai/codex/bin/codex.js";
    expect(extractCodexPath(path)).toBe(path);
  });

  it("handles .mjs and .cjs entry points", () => {
    expect(extractCodexPath("/usr/local/lib/codex/bin/codex.mjs")).toBe(
      "/usr/local/lib/codex/bin/codex.mjs",
    );
    expect(extractCodexPath("/usr/local/lib/codex/bin/codex.cjs")).toBe(
      "/usr/local/lib/codex/bin/codex.cjs",
    );
  });

  it("extracts the real path out of a pasted terminal transcript", () => {
    const transcript = [
      "$ where codex",
      "/Users/x/.local/state/fnm_multishells/123_456/bin/codex",
      "$ ",
    ].join("\n");
    expect(extractCodexPath(transcript)).toBe(
      "/Users/x/.local/state/fnm_multishells/123_456/bin/codex",
    );
  });

  it("extracts a codex.js path even when embedded in a transcript with trailing text", () => {
    const transcript = "found it at /opt/codex/bin/codex.js\nall good";
    expect(extractCodexPath(transcript)).toBe("/opt/codex/bin/codex.js");
  });

  it("returns an empty string when no codex path is present", () => {
    expect(extractCodexPath("no path here")).toBe("");
  });
});
