import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "../src/utils/debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays invocation until the wait elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced("a");
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith("a");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on repeated calls and only fires with the latest args", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced("a");
    vi.advanceTimersByTime(300);
    debounced("b");
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledWith("b");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel discards a pending call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush invokes a pending call immediately", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced("a");
    debounced.flush();
    expect(fn).toHaveBeenCalledWith("a");
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);
    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
