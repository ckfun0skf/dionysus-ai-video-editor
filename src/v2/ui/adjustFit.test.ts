import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P28-ADJUST-FIT: jsdom has no layout, so pin the CSS rules that make the Adjust range sheet fit a 390×844 phone
// (checked in a real browser: the sheet's last row ends at 777 px of 844 with no scrolling).
const css = readFileSync(new URL("./v2.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("/* P28-ADJUST-FIT"));

describe("P28 Adjust range fits a phone", () => {
  it("the in-sheet video is height-limited and keeps its aspect ratio", () => {
    expect(block).toMatch(/\.v2-slip-preview:not\(\.is-audio\):not\(\.is-mix\) \{[^}]*height: clamp\(72px, 15dvh, 200px\)[^}]*max-height: 28vh[^}]*aspect-ratio: 16 \/ 9/);
    expect(block).toMatch(/@media \(max-height: 700px\)/);
  });
  it("touch targets stay at least 44px", () => {
    expect(block).toMatch(/\.v2-slip-tools \.v2-seg button, \.v2-slip-replace, \.v2-slip-play, \.v2-slip-row \.v2-btn \{ min-height: 44px; \}/);
    expect(block).toMatch(/\.v2-slip \.v2-slip-check \{ min-height: 44px;/);
    for (const m of block.matchAll(/min-height: (\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(44);
  });
});
