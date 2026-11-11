import { describe, expect, it } from "vitest";
import { needsCssRotate, preferredPreviewOrient, previewOrientFallback, toggleOrient } from "./previewOrient";

describe("fullscreen orientation", () => {
  it("suggests landscape for wide projects and portrait for tall ones", () => {
    expect(preferredPreviewOrient(1920, 1080)).toBe("landscape");
    expect(preferredPreviewOrient(21, 9)).toBe("landscape");
    expect(preferredPreviewOrient(1080, 1920)).toBe("portrait");
    expect(preferredPreviewOrient(9, 16)).toBe("portrait");
    expect(preferredPreviewOrient(100, 100)).toBe("landscape");
  });

  it("locks when the API exists, otherwise CSS-rotates", () => {
    expect(previewOrientFallback({ canLock: true })).toBe("lock");
    expect(previewOrientFallback({ canLock: false })).toBe("css-rotate");
    expect(toggleOrient("landscape")).toBe("portrait");
    expect(toggleOrient("portrait")).toBe("landscape");
  });

  it("CSS-rotates only when the viewport does not already match the wanted orientation", () => {
    expect(needsCssRotate("landscape", 390, 844)).toBe(true);
    expect(needsCssRotate("landscape", 844, 390)).toBe(false);
    expect(needsCssRotate("portrait", 844, 390)).toBe(true);
    expect(needsCssRotate("portrait", 390, 844)).toBe(false);
  });
});
