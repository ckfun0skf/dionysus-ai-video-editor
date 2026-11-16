/**
 * P73 (Phase 1 step 1.8 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): the app-created placeholder (an image clip with
 * TEXT_SOURCE and a `placeholder` label, P35) and blank (P36) clips must look and behave the same after placeholder
 * becomes a cross-type clip state (decision 9). A compact golden (one hash per case) recorded on the pre-P73 code covers,
 * for placeholder and blank shapes on the main track and an overlay (with a mask, linked layers, both flags):
 *  - the domain predicates and the clip type caps they read;
 *  - the timeline/inspector UI table entry (fields, body markup, background, name);
 *  - the canvas calls of the shape alone in preview and export, at its start, middle and end;
 *  - export length, placeholder classification and warning, counts-toward-export and the audio plan;
 *  - get_timeline clip JSON and review_lint, and Fill (replace) with every asset kind.
 * The full-fixture goldens (render, timeline, inspector, agent) cover the same clips in context.
 * `PLACEHOLDER_PARITY_DUMP=<dir>` writes the raw values; `UPDATE_PLACEHOLDER_GOLDEN=1` rewrites (intended changes only).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { canChromaKey, clipRange, createProject, hasSound, isStill, slip, TEXT_SOURCE, timelineReview, trackKindFor, type Asset, type Placement, type Project } from "../domain";
import { canMask } from "../domain/mask";
import { canTrack } from "../domain/tracking";
import { audioPlan, classifyPlaceholders, countsTowardExport, exportEndTicks, exportPlaceholderWarning } from "../render/export/plan";
import { clipRendererFor, type ClipDrawHost } from "../render/clipRenderers";
import { clipTypeOf } from "../clipTypes";
import { clipUi } from "./clipTypeUi";
import { needsThumb } from "./TimelineClip";

const GOLDEN = join(__dirname, "__golden__", "placeholderParity.json");
const S = 120_000;
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

const asset = (id: string, kind: Asset["kind"], sec?: number): Asset => ({ id, kind, name: `${kind} asset`, selectedVersionId: `${id}-v`, versions: [{ id: `${id}-v`, createdAt: "", media: { blobKey: id, mime: kind, ...(sec ? { durationTicks: sec * S } : {}), width: 640, height: 360 }, provenance: { source: "import", inputs: [] } }] });
const ph = (id: string, start: number, extra: Partial<Placement> = {}): Placement => ({ id, startTicks: start * S, durationTicks: 2 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", volume: 1, storyShot: `shot-${id}`, placeholder: { label: `Shot ${id} · title — a description` }, ...extra });
const blank = (id: string, start: number, extra: Partial<Placement> = {}): Placement => ({ id, startTicks: start * S, durationTicks: 2 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", blank: { color: "#336699" }, ...extra });

function project(): Project {
  const p = createProject("ph");
  for (const a of [asset("vid", "video", 1), asset("img", "image"), asset("page", "html"), asset("snd", "audio", 3)]) p.assets[a.id] = a;
  const c = p.compositions[p.rootCompositionId];
  const main = c.tracks.find((t) => t.kind === "video")!;
  main.placements = [
    blank("b-main", 0),
    ph("ph-main", 2),
    ph("ph-mask", 4, { mask: { shape: "rect", invert: false, feather: 0, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } as never }),
    ph("ph-both", 6, { blank: { color: "#aa0000" } }),
    { id: "real", startTicks: 8 * S, durationTicks: 2 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "img", versionId: "img-v" }, clipType: "image", volume: 1 },
    ph("ph-tail", 10),
  ];
  c.tracks.push({ id: "ov", kind: "video", name: "Overlay", group: "overlay", placements: [
    blank("b-ov", 0, { transform: { x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 0.8 } as never }),
    blank("b-linked", 2, { storyLink: { anchor: "ph-main" }, link: { parent: "ph-main" } }),
    ph("ph-ov", 4),
  ] } as never);
  return p;
}
const clips = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements.map((pl) => ({ pl, track: t })));

/** A small recording 2D context: every call and property set, numbers rounded. */
function recorder(log: string[]) {
  const f = (v: unknown): string => (typeof v === "number" ? String(Math.round(v * 1e4) / 1e4) : typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(f).join(",")}]` : typeof v);
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: "source-over" };
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, k) {
      if (typeof k !== "string") return undefined;
      if (k === "measureText") return (t: string) => { log.push(`measureText(${f(t)})`); return { width: String(t).length * 6 }; };
      if (k in state) return state[k];
      return (...a: unknown[]) => { log.push(`${k}(${a.map(f).join(",")})`); };
    },
    set(_t, k, v) { if (typeof k === "string") { state[k] = v; log.push(`${k}=${f(v)}`); } return true; },
  });
}

function draws(pl: Placement, track: Project["compositions"][string]["tracks"][number], offline: boolean, t: number): string {
  const r = clipRendererFor(pl);
  if (!r?.draw) return `renderer:${r ? "frame" : "none"}`;
  const log: string[] = [];
  const g = recorder(log);
  const host = { g, width: 640, height: 360, time: t, offline, track, placement: pl, sourceTicks: 0, mix: undefined, tfx: undefined,
    setBox: (b: unknown) => log.push(`setBox(${JSON.stringify(b)})`), paint: (blend: unknown, fn: (x: CanvasRenderingContext2D) => void) => { log.push(`paint(${String(blend)})`); fn(g); },
    blit: (_g: unknown, w: number, h: number, _r: unknown, fn: (x: CanvasRenderingContext2D) => void) => { log.push(`blit(${w},${h})`); fn(g); } } as unknown as ClipDrawHost;
  r.draw(host);
  return log.join("\n");
}

describe("P73 placeholder and blank parity (golden recorded before the move)", () => {
  it("app-made placeholder and blank clips behave and draw as before", () => {
    const out: Record<string, string> = {};
    const dump = process.env.PLACEHOLDER_PARITY_DUMP;
    if (dump) mkdirSync(dump, { recursive: true });
    const put = (k: string, v: unknown) => { const s = (typeof v === "string" ? v : JSON.stringify(v)).replace(/\b[a-z]{2,6}_[0-9a-f]{8}[0-9a-z]*\b/g, "<id>"); out[k] = fnv(s); if (dump) writeFileSync(join(dump, `${k}.txt`), s); };
    const p = project(), c = p.compositions[p.rootCompositionId];
    for (const { pl, track } of clips(p)) {
      if (pl.id === "real") continue;
      const core = clipTypeOf(pl);
      put(`${pl.id}-predicates`, { isStill: isStill(pl), keyable: canChromaKey(pl), sound: hasSound(pl), thumb: needsThumb(pl), range: clipRange.canSetRange(p, pl), slip: slip.slipKind(pl) ?? null, mask: canMask(pl), track: canTrack(pl), trackKind: trackKindFor(pl.clipType), caps: core.caps, coreTrackKind: core.trackKind });
      const u = clipUi(pl);
      const plain = Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v !== "function").map(([k, v]) => [k, v]));
      put(`${pl.id}-ui`, { ...plain, body: u.body ? renderToStaticMarkup(<>{u.body(pl)}</>) : null, background: u.background?.(pl) ?? null, name: u.name(pl, p), title: u.inspectorTitle(pl, p), wave: u.waveform(pl) ?? null });
      for (const offline of [false, true]) for (const at of [0, 0.5, 0.999]) put(`${pl.id}-draw-${offline ? "export" : "preview"}-${at}`, draws(pl, track, offline, pl.startTicks + Math.round(at * pl.durationTicks)));
      put(`${pl.id}-counts`, countsTowardExport(c, pl));
      put(`${pl.id}-json`, timelineReview.clipJson(p, pl));
      for (const a of ["vid", "img", "page", "snd"]) {
        const r = slip.replaceClipAsset(p, pl.id, a, "shorten");
        put(`${pl.id}-fill-${a}`, { error: slip.replaceError(p, pl.id, a) ?? null, ok: r.ok, ...(r.ok ? { after: clips(r.project).find((x) => x.pl.id === pl.id)?.pl ?? null } : { message: r.error }) });
      }
    }
    put("export-end", exportEndTicks(p));
    put("export-classify", (({ middle, trailing }) => ({ middle: middle.map((x) => x.id), trailing: trailing.map((x) => x.id) }))(classifyPlaceholders(p)));
    put("export-warning", exportPlaceholderWarning(p) ?? null);
    put("audio-plan", audioPlan(p));
    put("lint", timelineReview.reviewLint(p).filter((x) => x.kind === "placeholder" || x.kind === "black-frame" || x.kind === "gap"));
    if (process.env.UPDATE_PLACEHOLDER_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(out).replace(/,"/g, ',\n"') + "\n");
    const want = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(out)).toEqual(Object.keys(want));
    for (const k of Object.keys(want)) expect(out[k], k).toBe(want[k]);
  });
});
