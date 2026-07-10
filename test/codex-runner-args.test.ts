import { describe, expect, it } from "vitest";
import { buildCodexArgs } from "../src/services/codex/runner";

describe("buildCodexArgs", () => {
  it("passes every attached image to a fresh Codex turn", () => {
    expect(
      buildCodexArgs({
        vaultDir: "/vault",
        prompt: "Analyze",
        images: ["/vault/a.png", "/vault/b.png"],
        sandbox: "workspace-write",
      }),
    ).toEqual([
      "exec",
      "--json",
      "-i",
      "/vault/a.png",
      "-i",
      "/vault/b.png",
      "-C",
      "/vault",
      "-s",
      "workspace-write",
      "Analyze",
    ]);
  });
});
