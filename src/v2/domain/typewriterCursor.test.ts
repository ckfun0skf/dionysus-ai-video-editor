import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT, resolveCursor, textAnimAt, textStyleData, textStylePosition, type TextData } from "./text";
import { parseStoryboard } from "./storyJson";
import { getPreset } from "../registry";
import { textLayerData } from "./storySend";

const S = 120_000;
const td = (p: Record<string, number | string>, text = "SEATTLE 2027"): TextData => ({ ...DEFAULT_TEXT, text, animIn: "typewriter", animInParams: p, animTicks: S });

describe("typewriter cursor (P7-TYPE-CURSOR)", () => {
  it("no cursor by default: the old typewriter frames", () => {
    const a = textAnimAt({ ...DEFAULT_TEXT, text: "Hi", animIn: "typewriter", animTicks: S }, S / 2, 4 * S);
    expect(a.caret).toBeUndefined(); expect(a.display).toBeUndefined(); expect(a.cursor).toBeUndefined(); expect(a.chars).toBeCloseTo(0.5);
  });
  it("a single character is a cursor: solid while typing, then blinks", () => {
    const d = td({ cursor: "|", blink: 2 });
    expect(textAnimAt(d, S / 2, 4 * S).caret).toEqual({ glyph: "|", alpha: 1 });
    expect(textAnimAt(d, S / 2, 4 * S).display).toBeUndefined();
    expect(textAnimAt(d, S + 0.1 * S, 4 * S).caret!.alpha).toBe(1); // first half period on
    expect(textAnimAt(d, S + 0.3 * S, 4 * S).caret!.alpha).toBe(0); // 2 blinks/s = 0.25 s on, 0.25 s off
    expect(textAnimAt(d, S + 0.6 * S, 4 * S).caret!.alpha).toBe(1);
    expect(textAnimAt(td({ cursor: "_", blink: 0 }), 3 * S, 4 * S).caret!.alpha).toBe(1);
  });
  it("after typing: hide and fade", () => {
    expect(textAnimAt(td({ cursor: "|", after: "hide" }), S + 1, 4 * S).caret!.alpha).toBe(0);
    expect(textAnimAt(td({ cursor: "|", after: "fade" }), S + 0.25 * S, 4 * S).caret!.alpha).toBeCloseTo(0.5);
    expect(textAnimAt(td({ cursor: "|", after: "fade" }), 2 * S, 4 * S).caret!.alpha).toBe(0);
  });
  it("several characters scramble each new character, deterministically, then resolve", () => {
    const d = td({ cursor: "0123456789", scramble: 0.3 }, "SEATTLE / YEAR");
    const a = textAnimAt(d, 0.5 * S, 4 * S), b = textAnimAt(d, 0.5 * S, 4 * S);
    expect(a.display).toBe(b.display); // same frame -> same glyphs (preview == export)
    expect([...a.display!].length).toBe(7);
    expect(a.display).toMatch(/^[A-Z0-9]+$/);
    expect(a.display).toMatch(/[0-9]/);
    expect(textAnimAt(d, 0.5 * S + 1, 4 * S).display).toBe(a.display); // same 1/30 s step
    expect(textAnimAt(d, 1.31 * S, 4 * S).display).toBe("SEATTLE / YEAR"); // all resolved
    const spaces = textAnimAt(d, 0.98 * S, 4 * S).display!;
    expect(spaces[7]).toBe(" "); expect(spaces[9]).toBe(" ");
    expect("0123456789").toContain(a.caret!.glyph);
  });
  it("resolveCursor ignores frames without a cursor", () => {
    expect(resolveCursor("x", { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, chars: 1 }, 0, S)).toEqual({});
  });
  it("descriptor: select param with options", () => {
    const d = getPreset("textAnimIn", "typewriter")!;
    expect(d.params.map((p) => p.key)).toEqual(["cursor", "blink", "after", "scramble"]);
    expect(d.params[2]).toMatchObject({ type: "select", options: ["blink", "hide", "fade"], default: "blink" });
  });
});

describe("sci-fi caption preset (P7-CAPTION)", () => {
  it("bundled font, right aligned, scramble cursor, bottom right", () => {
    const d = textStyleData("sci-fi-caption")!;
    expect(d.font).toBe("'Share Tech Mono', ui-monospace, monospace");
    expect(d.align).toBe("right");
    expect(d.animInParams).toMatchObject({ cursor: "0123456789", after: "fade" });
    expect((d as Record<string, unknown>).position).toBeUndefined();
    const p = textStylePosition("sci-fi-caption")!;
    expect(p.x).toBeCloseTo(0.12); expect(p.y).toBeCloseTo(0.4);
    expect(textStylePosition("plain")).toBeUndefined();
  });
});

describe("storyboard anim.inParams", () => {
  const board = (anim: unknown) => JSON.stringify({ format: "dionysus.storyboard/1", meta: { title: "t", aspectRatio: "16:9" }, assets: [], shots: [{ id: "s1", title: "a", durationSec: 4, prompt: "p", layers: [{ id: "l", type: "text", text: "SEATTLE / YEAR 2027", startSec: 0, endSec: 4, position: { x: 0.62, y: 0.9 }, textStyle: "sci-fi-caption", anim }] }] });
  it("parses, warns on unknown select values, and reaches the clip", () => {
    const r = parseStoryboard(board({ in: "typewriter", durationSec: 1.5, inParams: { cursor: "|", after: "fade" } }));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const l = r.doc.shots[0].layers![0];
    expect(l.type === "text" && l.anim?.inParams).toEqual({ cursor: "|", after: "fade" });
    const d = textLayerData(r.doc as never, l as never);
    expect(d.animInParams).toMatchObject({ cursor: "|", after: "fade", scramble: 0.25 });
    const w = parseStoryboard(board({ in: "typewriter", inParams: { after: "explode" } })).warnings.map((x) => `${x.path}: ${x.message}`);
    expect(w.some((x) => /anim\.inParams\.after: .*not one of blink, hide, fade/.test(x))).toBe(true);
  });
});

describe("select params and bundled fonts validation (P7)", async () => {
  const { paramProblems, moduleProblems } = await import("../presets/load");
  it("select needs options including the default", () => {
    expect(paramProblems([{ key: "a", label: "A", description: "pick one option", type: "select", options: ["x", "y"], default: "x" }])).toEqual([]);
    expect(paramProblems([{ key: "a", label: "A", description: "pick one option", type: "select", options: ["x"], default: "z" }]).join()).toMatch(/select needs/);
  });
  it("bundled fonts must quote their family first and list woff2 files", () => {
    const base = { kind: "font", id: "zz", label: "Zz", description: "a bundled test font", width: 0.5 } as const;
    expect(moduleProblems({ ...base, stack: "'Zz', sans-serif", bundled: { family: "Zz", license: "zz-OFL.txt", files: [{ file: "zz-400.woff2", weight: 400 }] } } as never, "font/zz.ts", new Set())).toEqual([]);
    expect(moduleProblems({ ...base, stack: "sans-serif", bundled: { family: "Zz", license: "zz-OFL.txt", files: [{ file: "zz.ttf", weight: 400 }] } } as never, "font/zz.ts", new Set()).join()).toMatch(/bundled font/);
  });
});
