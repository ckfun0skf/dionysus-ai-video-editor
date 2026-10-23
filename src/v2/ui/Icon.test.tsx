// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICONS, Ic } from "./Icon";

describe("Ic", () => {
  it("renders a lucide svg for known keys and plain text otherwise", () => {
    expect(renderToStaticMarkup(<Ic g="✂" />)).toMatch(/^<svg[^>]*data-icon="✂"/);
    expect(renderToStaticMarkup(<Ic g="Hi" />)).toBe("Hi");
  });
  it("covers every glyph used by toolbars", () => {
    for (const g of ["✎", "♫", "＋", "T", "▭", "⤢", "✂", "🗑", "⤧", "⏩", "☑", "🔇", "🔊", "↶", "↷", "▶", "❚❚", "⛶", "✕", "☰"]) expect(ICONS[g], g).toBeTruthy();
  });
});
