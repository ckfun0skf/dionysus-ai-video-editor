import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accumulateSkip, clampTime, createAutohide, formatSkipIndicator, FS_AUTOHIDE_MS, FS_SKIP_SEC,
  resolveFsTap, shouldAutohide, skipDeltaSec, tapSide,
} from "./previewFs";

describe("fullscreen preview gestures", () => {
  it("treats the left half as −5s and the right half as +5s", () => {
    expect(tapSide(10, 100)).toBe("left");
    expect(tapSide(49, 100)).toBe("left");
    expect(tapSide(50, 100)).toBe("right");
    expect(tapSide(90, 100)).toBe("right");
    expect(skipDeltaSec("left")).toBe(-FS_SKIP_SEC);
    expect(skipDeltaSec("right")).toBe(FS_SKIP_SEC);
  });

  it("a second tap inside the delay is a double-tap; a late tap starts a new wait", () => {
    const first = resolveFsTap(undefined, 1000, 20, 10, 200);
    expect(first.kind).toBe("wait");
    const dbl = resolveFsTap(first.pending, 1000 + 200, 24, 12, 200);
    expect(dbl).toMatchObject({ kind: "double", side: "left", deltaSec: -5, pending: undefined });
    const late = resolveFsTap(first.pending, 1000 + 400, 24, 12, 200);
    expect(late.kind).toBe("wait");
  });

  it("right-half double-tap skips forward and consecutive skips accumulate", () => {
    const a = resolveFsTap(undefined, 0, 180, 10, 200);
    const b = resolveFsTap(a.pending, 100, 190, 12, 200);
    expect(b).toMatchObject({ kind: "double", side: "right", deltaSec: 5 });
    expect(accumulateSkip(b.kind === "double" ? b.deltaSec : 0, "right")).toBe(10);
    expect(accumulateSkip(-5, "left")).toBe(-10);
    expect(formatSkipIndicator(10)).toBe("+10s");
    expect(formatSkipIndicator(-5)).toBe("−5s");
  });

  it("clamps seeks to 0..duration", () => {
    expect(clampTime(-3, 20)).toBe(0);
    expect(clampTime(25, 20)).toBe(20);
    expect(clampTime(8, 20)).toBe(8);
    expect(clampTime(5, 0)).toBe(0);
  });
});

describe("fullscreen control auto-hide", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("hides after 3s while playing, and stays visible while paused or scrubbing", () => {
    expect(shouldAutohide({ visible: true, playing: true, scrubbing: false })).toBe(true);
    expect(shouldAutohide({ visible: true, playing: false, scrubbing: false })).toBe(false);
    expect(shouldAutohide({ visible: true, playing: true, scrubbing: true })).toBe(false);
    expect(shouldAutohide({ visible: false, playing: true, scrubbing: false })).toBe(false);

    const hide = vi.fn();
    const h = createAutohide(hide);
    h.ping({ visible: true, playing: true, scrubbing: false });
    vi.advanceTimersByTime(FS_AUTOHIDE_MS - 1);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);

    hide.mockClear();
    h.ping({ visible: true, playing: false, scrubbing: false });
    vi.advanceTimersByTime(FS_AUTOHIDE_MS + 50);
    expect(hide).not.toHaveBeenCalled();

    h.ping({ visible: true, playing: true, scrubbing: true });
    vi.advanceTimersByTime(FS_AUTOHIDE_MS + 50);
    expect(hide).not.toHaveBeenCalled();
    h.clear();
  });
});
