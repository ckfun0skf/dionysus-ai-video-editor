// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CUSTOM_ICONS, ICONS, Ic } from "./Icon";

describe("Ic", () => {
  it("renders a lucide svg for known keys and plain text otherwise", () => {
    expect(renderToStaticMarkup(<Ic g="✂" />)).toMatch(/^<svg[^>]*data-icon="✂"/);
    expect(renderToStaticMarkup(<Ic g="Hi" />)).toBe("Hi");
  });
  it("covers every glyph used by toolbars", () => {
    for (const g of ["✎", "♫", "＋", "T", "▭", "⤢", "✂", "🗑", "⤧", "⏩", "☑", "🔇", "🔊", "↶", "↷", "▶", "❚❚", "⛶", "✕", "☰"]) expect(ICONS[g], g).toBeTruthy();
  });
  it("P32: every literal icon key in the bars, sheets and layer controls resolves to an SVG (no emoji fallback)", () => {
    const keys = new Set<string>();
    for (const f of ["V2App.tsx", "Timeline.tsx", "ActionGrid.tsx"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      for (const re of [/\btool\("([^"]+)"/g, /\bA\("[^"]+", "([^"]+)"/g, /\bicon: "([^"]+)"/g, /<Ic g="([^"]+)"/g]) for (const m of src.matchAll(re)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(30);
    for (const k of keys) expect(ICONS[k] ?? CUSTOM_ICONS[k], k).toBeTruthy();
  });
  it("P32: the merge icon is a currentColor line icon on the lucide grid", () => {
    const svg = renderToStaticMarkup(<Ic g="merge" />);
    expect(svg).toMatch(/viewBox="0 0 24 24"/); expect(svg).toMatch(/stroke="currentColor"/); expect(svg).toMatch(/stroke-width="1.75"/); expect(svg).toMatch(/fill="none"/);
  });
});
