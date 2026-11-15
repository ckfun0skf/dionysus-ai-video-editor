// @vitest-environment jsdom
/**
 * P67 render parity: every 2D-canvas call the Player makes for the fixture project (src/v2/__fixtures__/renderParity.ts),
 * in preview (`offline = false`) and export (`offline = true`, the path `renderAt` and the MP4 exporter use) at every
 * fixture time, hashed and compared with a golden recorded before the clip renderers moved out of player.ts.
 * Any change to what is drawn, in which order, with which state (alpha, transform, composite, filter, font, colours)
 * changes a hash. Regenerate only for an intended look change: UPDATE_RENDER_GOLDEN=1 npx vitest run src/v2/render/renderParity.test.ts
 *
 * jsdom has no real canvas: a recording 2D context stands in. Media (image/video/html) blobs are absent here, so
 * those clips take their "not loaded yet" path; the PR's Chrome pixel comparison covers them with real files.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryStorage } from "../persistence";
import { Player } from "./player";
import { RENDER_PARITY_SIZE, RENDER_PARITY_TIMES, renderParityProject } from "../__fixtures__/renderParity";

const GOLDEN = resolve(__dirname, "__golden__/renderParity.json");
const UPDATE = process.env.UPDATE_RENDER_GOLDEN === "1";
/** Set RENDER_PARITY_DUMP=<existing dir> to write each frame's call log there (diff two runs to find a change). */
const DUMP = process.env.RENDER_PARITY_DUMP;

const log: string[] = [];
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => { if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o)!; };

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e4) / 1e4) : String(v);
  if (typeof v === "string" || typeof v === "boolean" || v == null) return JSON.stringify(v);
  if (typeof HTMLCanvasElement !== "undefined" && v instanceof HTMLCanvasElement) return `canvas#${idOf(v)}(${v.width}x${v.height})`;
  if (typeof Element !== "undefined" && v instanceof Element) return `<${v.tagName.toLowerCase()}>`;
  if (Array.isArray(v)) return `[${v.map(fmt).join(",")}]`;
  if (typeof v === "object") return (v as { __tag?: string }).__tag ?? "{obj}";
  return typeof v;
}

const DEFAULTS: Record<string, unknown> = {
  globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "#000000", strokeStyle: "#000000", filter: "none",
  font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
  shadowBlur: 0, shadowColor: "rgba(0, 0, 0, 0)", shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true,
  imageSmoothingQuality: "low", miterLimit: 10, lineDashOffset: 0, direction: "inherit", letterSpacing: "0px",
};

function recorder(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const cid = idOf(canvas);
  let state: Record<string, unknown> = { ...DEFAULTS };
  const stack: Record<string, unknown>[] = [];
  let dash: number[] = [];
  const rec = (name: string, args: unknown[]) => log.push(`c${cid}.${name}(${args.map(fmt).join(",")})`);
  const tagged = (tag: string) => ({ __tag: tag, addColorStop: (...a: unknown[]) => rec(`${tag}.addColorStop`, a), setTransform: () => undefined });
  const special: Record<string, (...a: unknown[]) => unknown> = {
    save: () => { rec("save", []); stack.push({ ...state }); },
    restore: () => { rec("restore", []); state = stack.pop() ?? state; },
    measureText: (t) => { rec("measureText", [t]); const w = String(t).length * 6; return { width: w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }; },
    getImageData: (...a) => { rec("getImageData", a); const w = Math.max(1, Number(a[2]) | 0), h = Math.max(1, Number(a[3]) | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    createImageData: (...a) => { rec("createImageData", a); const w = Math.max(1, Number(a[0]) | 0), h = Math.max(1, Number(a[1]) | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    createLinearGradient: (...a) => { rec("createLinearGradient", a); return tagged("linear"); },
    createRadialGradient: (...a) => { rec("createRadialGradient", a); return tagged("radial"); },
    createConicGradient: (...a) => { rec("createConicGradient", a); return tagged("conic"); },
    createPattern: (...a) => { rec("createPattern", a); return tagged("pattern"); },
    getTransform: () => { rec("getTransform", []); return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true, inverse() { return this; } }; },
    setLineDash: (d) => { rec("setLineDash", [d]); dash = [...(d as number[])]; },
    getLineDash: () => [...dash],
    isPointInPath: () => false,
  };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === "canvas") return canvas;
      if (typeof prop !== "string") return undefined;
      if (prop in special) return special[prop];
      if (prop in state) return state[prop];
      return (...a: unknown[]) => { rec(prop, a); };
    },
    set(_t, prop, v) { if (typeof prop === "string") { state[prop] = v; log.push(`c${cid}.${prop}=${fmt(v)}`); } return true; },
  });
}

/** FNV-1a 32-bit over the log lines. */
function hash(lines: string[]): string {
  let h = 0x811c9dc5;
  for (const line of lines) for (let i = 0; i < line.length + 1; i++) { h ^= i < line.length ? line.charCodeAt(i) : 10; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

type Golden = Record<string, { calls: number; hash: string }>;

describe("P67 render parity: Player draw calls equal the pre-P67 golden", () => {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      if (!contexts.has(this)) contexts.set(this, recorder(this));
      return contexts.get(this)! as never;
    } as never);
  });
  afterAll(() => { vi.restoreAllMocks(); });

  const results: Golden = {};
  for (const mode of ["preview", "export"] as const) {
    it(`${mode}: every fixture time draws exactly as before`, () => {
      const project = renderParityProject();
      const player = new Player(project, createMemoryStorage().blobs, { kind: "wall", now: () => 0 } as never);
      player.offline = mode === "export";
      const canvas = document.createElement("canvas");
      canvas.width = RENDER_PARITY_SIZE.width; canvas.height = RENDER_PARITY_SIZE.height;
      player.canvas = canvas;
      const golden: Golden = !UPDATE && existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {};
      for (const t of RENDER_PARITY_TIMES) {
        player.time = Math.round(t * 120_000);
        log.length = 0;
        player.draw();
        const key = `${mode}@${t}`;
        results[key] = { calls: log.length, hash: hash(log) };
        if (DUMP) writeFileSync(resolve(DUMP, `${key}.log`), `${log.join("\n")}\n`);
        expect(log.length, `${key} drew nothing`).toBeGreaterThanOrEqual(2);
        if (!UPDATE) expect(results[key], `${key} differs from the golden (re-run with UPDATE_RENDER_GOLDEN=1 only for an intended change)`).toEqual(golden[key]);
      }
      player.dispose();
    });
  }
  it("covers every clip type and host feature in the fixture", () => {
    const p = renderParityProject();
    const all = p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);
    const kinds = new Set(all.map((x) => (x.placeholder ? "placeholder" : x.blank ? "blank" : x.clipType)));
    expect([...kinds].sort()).toEqual(["blank", "effect", "html", "image", "placeholder", "text", "video"]);
    expect(all.some((x) => x.mask) && all.some((x) => x.transitionIn) && all.some((x) => x.chromaKey) && all.some((x) => x.blend)).toBe(true);
    expect(p.compositions[p.rootCompositionId].tracks.map((t) => t.captionStyle?.mode).filter(Boolean).sort()).toEqual(["word-highlight", "word-pop"]);
  });
  afterAll(() => { if (UPDATE) writeFileSync(GOLDEN, `${JSON.stringify(Object.fromEntries(Object.entries(results).sort()), null, 1)}\n`); });
});
