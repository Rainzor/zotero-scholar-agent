import { describe, expect, it } from "vitest";
import {
  estimateMessagesTokens,
  estimateTokens,
} from "../src/utils/token-estimate";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts ASCII cheaper than CJK", () => {
    const ascii = estimateTokens("abcd"); // 4 * 0.25 * 1.1 = 1.1 → 2
    const cjk = estimateTokens("中文"); // 2 * 1.5 * 1.1 = 3.3 → 4
    expect(ascii).toBeLessThan(cjk);
    expect(ascii).toBe(2);
    expect(cjk).toBe(4);
  });
});

describe("estimateMessagesTokens", () => {
  it("adds a per-message overhead", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const bare =
      estimateTokens("hi") + estimateTokens("hello");
    expect(estimateMessagesTokens(messages)).toBe(bare + 8);
  });
});
