import { describe, expect, it } from "vitest";
import {
  buildMessageScrollAnchor,
  captureMessageScrollAnchor,
  isNearBottom,
  restoreMessageScrollAnchor,
  scrollToBottomIfPinned,
} from "../src/modules/sidebar/scroll";

function scrollable(overrides: Partial<HTMLElement> = {}): HTMLElement {
  return {
    scrollHeight: 1000,
    scrollTop: 600,
    clientHeight: 300,
    ...overrides,
  } as HTMLElement;
}

describe("sidebar scroll preservation", () => {
  it("keeps the reader's position when they are not near the bottom", () => {
    const element = scrollable();

    scrollToBottomIfPinned(element, isNearBottom(element));

    expect(element.scrollTop).toBe(600);
  });

  it("follows new content when the reader was at the bottom", () => {
    const element = scrollable({ scrollTop: 700 });

    scrollToBottomIfPinned(element, isNearBottom(element));

    expect(element.scrollTop).toBe(1000);
  });

  it("keeps a visible message at the same relative offset after a rebuild", () => {
    const container = {
      scrollHeight: 2000,
      scrollTop: 600,
      clientHeight: 300,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [
        {
          dataset: { messageAnchor: "assistant-123" },
          getBoundingClientRect: () => ({ top: 140, bottom: 340 }),
        },
      ],
      querySelector: () => ({
        getBoundingClientRect: () => ({ top: 190 }),
      }),
    } as unknown as HTMLElement;

    const anchor = captureMessageScrollAnchor(container);
    restoreMessageScrollAnchor(container, anchor);

    expect(container.scrollTop).toBe(650);
  });

  it("builds a stable anchor from the message timestamp", () => {
    expect(
      buildMessageScrollAnchor(
        { role: "assistant", timestamp: 1_725_000_000_000 },
        7,
      ),
    ).toBe("assistant-1725000000000");
  });

  it("builds a content-stable anchor for legacy messages", () => {
    const message = {
      role: "assistant",
      content: "Legacy answer without a timestamp",
      model: "Codex",
    };

    expect(buildMessageScrollAnchor(message, 2)).toBe(
      buildMessageScrollAnchor(message, 9),
    );
  });
});
