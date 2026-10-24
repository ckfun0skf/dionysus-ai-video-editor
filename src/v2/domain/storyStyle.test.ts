import { describe, expect, it } from "vitest";
import { validateStoryboard, type StoryDoc, type StoryTextLayer } from "./storyJson";
import { RULES, ruleNumber, storyboardSystemPrompt } from "./storyPrompt";
import { textLayerData } from "./storySend";
import { getPreset } from "../registry";

const doc = (style: unknown, textStyles?: Record<string, unknown>, textStyle?: string) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9", ...(textStyles ? { textStyles } : {}) },
  assets: [],
  shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [], layers: [{ id: "t", type: "text", text: "Hi", startSec: 0, endSec: 5, position: { x: 0.5, y: 0.8 }, ...(textStyle ? { textStyle } : {}), ...(style === undefined ? {} : { style }) }] }],
});
const parse = (raw: unknown) => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return { doc: r.doc as StoryDoc, warnings: r.warnings.map((w) => `${w.path}: ${w.message}`) }; };
const layer = (d: StoryDoc) => d.shots[0].layers![0] as StoryTextLayer;

describe("text style extras (V2-SB-127)", () => {
  it("keeps valid extras and fills missing shadow / background fields from the defaults", () => {
    const style = { italic: true, letterSpacing: 0.2, lineHeight: 1.4, strokeWidth: 0.06, strokeColor: "#000000", shadow: { blur: 0.3 }, background: { color: "#102030" }, effect: "glow@1", effectColor: "#20d5ec" };
    const { doc: d, warnings } = parse(doc(style));
    expect(warnings).toEqual([]);
    expect(layer(d).style).toEqual({ ...style, shadow: { color: "#000000", blur: 0.3, x: 0.03, y: 0.03 }, background: { color: "#102030", opacity: 0.6 }, effect: "glow" });
    expect(layer(parse(doc({ shadow: null, background: null, effect: "none" })).doc).style).toEqual({ shadow: null, background: null, effect: "none" });
  });

  it("warns on and drops bad values; unknown fields warn but pass through", () => {
    const { doc: d, warnings } = parse(doc({ italic: "yes", letterSpacing: 3, lineHeight: 0.2, strokeWidth: -1, strokeColor: "black", shadow: { blur: 5 }, background: "dark", effect: "sparkle", effectColor: 7, glitter: true }));
    expect(layer(d).style).toEqual({ glitter: true });
    const p = "shots[0].layers[0].style";
    expect(warnings).toEqual([
      `${p}.italic: Italic "yes" is ignored: use true or false.`,
      `${p}.letterSpacing: letterSpacing 3 is ignored: use -0.2 to 1 (extra space between letters, in em).`,
      `${p}.lineHeight: lineHeight 0.2 is ignored: use 0.8 to 3 (line height multiplier).`,
      `${p}.strokeWidth: strokeWidth -1 is ignored: use 0 to 0.3 (outline width, as a fraction of the font size).`,
      `${p}.strokeColor: strokeColor "black" is ignored: use a hex value like "#000000".`,
      `${p}.effectColor: effectColor 7 is ignored: use a hex value like "#000000".`,
      `${p}.shadow: shadow is ignored: use { "color": "#000000", "blur": 0-1, "x": -1-1, "y": -1-1 } (blur and offsets are fractions of the font size), or null for none.`,
      `${p}.background: background is ignored: use { "color": "#000000", "opacity": 0-1 }, or null for none.`,
      `${p}.effect: Unknown text effect "sparkle"; ignoring it. Text effects: none, glow, neon, hollow, echo.`,
      `${p}.glitter: Unknown text style field "glitter" has no effect (kept for re-export). Fields: font, size, color, align, bold, italic, letterSpacing, lineHeight, strokeWidth, strokeColor, shadow, background, effect, effectColor.`,
    ]);
  });

  it("validates meta.textStyles the same way and round-trips", () => {
    const raw = doc(undefined, { title: { font: "serif", letterSpacing: 0.25, shadow: { color: "#000000", blur: 0.3, x: 0, y: 0.03 } } }, "title");
    const { doc: d, warnings } = parse(raw);
    expect(warnings).toEqual([]);
    const again = validateStoryboard(JSON.parse(JSON.stringify(d)));
    expect(again.ok && again.doc).toEqual(d);
  });

  it("send: the textStyle, then the inline extras; null clears the style's shadow or background", () => {
    const c = parse(doc({ background: null, strokeWidth: 0.05, strokeColor: "#111111" }, undefined, "caption")).doc;
    const caption = textLayerData(c, layer(c));
    expect(caption).toMatchObject({ bold: true, strokeWidth: 0.05, strokeColor: "#111111" });
    expect(caption.background).toBeUndefined();
    const d = parse(doc({ shadow: { color: "#222222", blur: 0.2, x: 0, y: 0.05 }, letterSpacing: 0.1, italic: true, effect: "neon", effectColor: "#ff00ff" }, undefined, "cinematic")).doc;
    expect(textLayerData(d, layer(d))).toMatchObject({ color: "#f5f1e8", letterSpacing: 0.1, italic: true, shadow: { color: "#222222", blur: 0.2, x: 0, y: 0.05 }, effect: "neon", effectColor: "#ff00ff", size: 0.07 });
  });

  it("ships the cinematic and soft-shadow styles, and the guide has the fields, the effects and a rule with an example that imports cleanly", () => {
    for (const id of ["cinematic", "soft-shadow"]) expect(getPreset("textStyle", id)?.description).toBeTruthy();
    const full = storyboardSystemPrompt();
    expect(full).toContain('"strokeWidth"?: number (outline, fraction of font size, 0-0.3)');
    expect(full).toContain("Text effects — shots[].layers[].style.effect");
    expect(full).toContain(`21. ${RULES[20]}`);
    const rule = RULES[ruleNumber("text-style-extras") - 1];
    const style = JSON.parse(rule.match(/"style": (\{ "color".*?\} \})/)![1]);
    expect(parse(doc(style)).warnings).toEqual([]);
  });
});
