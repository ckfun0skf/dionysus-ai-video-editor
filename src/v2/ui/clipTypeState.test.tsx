/**
 * P73 (Phase 1 step 1.8 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md, decision 9 and §6): placeholder is a clip state any
 * type can have, handled by the host before any plugin; a clipType this build does not register loads, keeps its data
 * on save, draws a slate, exports black and silent (warned first) and has a safe inspector.
 * The app-made image placeholder and blank are pinned to the pre-P73 code by placeholderParity.test.tsx.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createProject, hasSound, isStill, slip, TEXT_SOURCE, timelineReview, validateComposition, type Asset, type MediaKind, type Placement, type Project, type Track, type TrackKind } from "../domain";
import { clipTypeOf, coreOf, isKnownClipType, isPlaceholder, placeholderAccepts, variantOf } from "../clipTypes";
import { clipRendererFor, type ClipDrawHost } from "../render/clipRenderers";
import { PLACEHOLDER_RENDERER } from "../render/placeholderSlate";
import { audioPlan, classifyPlaceholders, countsTowardExport, exportEndTicks, exportPlaceholderWarning, exportUnknownTypeWarning, unknownTypeClips } from "../render/export/plan";
import { migrateProject } from "../persistence/schema";
import { createIndexedDbStorage } from "../persistence/indexeddb";
import { Engine, cmd } from "../engine";
import { clipUi, PLACEHOLDER_UI, UNKNOWN_CLIP_UI } from "./clipTypeUi";
import { needsThumb } from "./TimelineClip";

const S = 120_000;
const TYPES = ["video", "image", "audio", "html", "text", "effect", "scene3d"] as const;
const asset = (id: string, kind: Asset["kind"], sec?: number): Asset => ({ id, kind, name: `${kind} file`, selectedVersionId: `${id}-v`, versions: [{ id: `${id}-v`, createdAt: "", media: { blobKey: id, mime: kind, ...(sec ? { durationTicks: sec * S } : {}) }, provenance: { source: "import", inputs: [] } }] });
const ph = (id: string, clipType: string, start = 0): Placement => ({ id, startTicks: start * S, durationTicks: 2 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: clipType as MediaKind, placeholder: { label: `Shot ${id}` } });
const trackFor = (clipType: string): TrackKind => coreOf(clipType).trackKind;
const BLACK = ["save()", "setTransform(1,0,0,1,0,0)", 'fillStyle="#000"', "fillRect(0,0,640,360)", "restore()"];
const texts = (log: string[]) => log.filter((l) => l.startsWith("fillText(")).map((l) => l.split(",")[0]);

function draw(pl: Placement, kind: TrackKind, offline: boolean): string[] {
  const log: string[] = [];
  const g = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, k) => (k === "measureText" ? (t: string) => ({ width: String(t).length * 6 }) : typeof k === "string" ? (...a: unknown[]) => { log.push(`${k}(${a.map((x) => JSON.stringify(x)).join(",")})`); } : undefined),
    set: (_t, k, v) => { log.push(`${String(k)}=${JSON.stringify(v)}`); return true; },
  });
  const track = { id: "t", kind, name: "t", placements: [pl] } as Track;
  const host = { g, width: 640, height: 360, time: pl.startTicks, offline, track, placement: pl, sourceTicks: 0, mix: undefined, tfx: undefined, setBox: () => undefined, paint: (_b: unknown, fn: (x: CanvasRenderingContext2D) => void) => fn(g), blit: () => undefined } as unknown as ClipDrawHost;
  clipRendererFor(pl)!.draw!(host);
  return log;
}

/** A project with one track per kind and a placeholder of every type on its intended track. */
function placeholderProject(): Project {
  const p = createProject("ph-all");
  for (const a of [asset("vid", "video", 5), asset("img", "image"), asset("page", "html", 5), asset("snd", "audio", 5)]) p.assets[a.id] = a;
  const kinds: TrackKind[] = ["video", "audio", "text", "effect"];
  p.compositions[p.rootCompositionId].tracks = kinds.map((k) => ({ id: `t-${k}`, kind: k, name: k, placements: TYPES.filter((t) => trackFor(t) === k).map((t, i) => ph(`ph-${t}`, t, i * 2)) }));
  return p;
}

describe("P73 placeholder as a cross-type clip state (decision 9)", () => {
  it("variantOf no longer returns placeholder; clipTypeOf gives the host state for every type", () => {
    for (const t of TYPES) {
      const p = ph("x", t);
      expect(isPlaceholder(p)).toBe(true);
      expect(variantOf(p), t).toBe(t);
      const core = clipTypeOf(p);
      expect(core.id, t).toBe("placeholder");
      // Keeps its intended type: the track kind and (for pickers) its clipType.
      expect(core.trackKind, t).toBe(trackFor(t));
      expect(core.caps, t).toMatchObject({ sourceTime: false, still: true, sound: false, thumb: false, asset: "none", visual: coreOf(t).caps.visual });
      expect([hasSound(p), isStill(p), needsThumb(p)], t).toEqual([false, true, false]);
    }
    expect(clipTypeOf(ph("x", "image"))).toBe(clipTypeOf(ph("y", "image"))); // cached per intended type
  });

  it("the player draws the shared slate before any plugin: slate in preview, black in export, nothing for audio / effect", () => {
    for (const t of TYPES) {
      const p = ph("p1", t);
      expect(clipRendererFor(p), t).toBe(PLACEHOLDER_RENDERER);
      const preview = draw(p, trackFor(t), false), exp = draw(p, trackFor(t), true);
      if (!coreOf(t).caps.visual) { expect([preview, exp], t).toEqual([[], []]); continue; }
      expect(texts(preview), t).toEqual(['fillText("Shot p1"', 'fillText("NOT GENERATED"']);
      expect(preview[preview.indexOf('fillStyle="#111214"') + 1], t).toBe("fillRect(0,0,640,360)");
      expect(exp, t).toEqual(BLACK);
    }
  });

  it("the timeline shows the placeholder card for every type; the inspector and Fill follow the intended type", () => {
    for (const t of TYPES) {
      const p = ph("p1", t), u = clipUi(p);
      expect(u.id, t).toBe("placeholder");
      expect(u.kindClass, t).toBe("is-placeholder");
      expect(renderToStaticMarkup(<>{u.body!(p)}</>), t).toContain('<span class="v2-ph-label">Shot p1</span><span class="v2-ph-state">Not generated</span>');
      expect(u.extraTools.includes("fill"), t).toBe(coreOf(t).caps.asset === "media");
      expect(u.inspectorTabs.includes("chroma"), t).toBe(coreOf(t).caps.keyable);
      expect([u.speed, u.volume], t).toEqual([false, false]);
    }
    expect(clipUi(ph("p", "image"))).toBe(PLACEHOLDER_UI);
    expect(clipUi(ph("p", "audio")).inspectorIcon).toBe("♫");
  });

  it("Fill offers matching assets: the image placeholder any picture, a typed one its own kind", () => {
    const kinds: MediaKind[] = ["video", "image", "audio", "html"];
    expect(kinds.filter(placeholderAccepts("image"))).toEqual(["video", "image", "html"]);
    for (const t of ["video", "audio", "html"] as const) expect(kinds.filter(placeholderAccepts(t)), t).toEqual([t]);
    const p = placeholderProject();
    expect(slip.replaceError(p, "ph-image", "snd")).toBe("Asset snd is audio; placeholder ph-image needs a video, image or html clip.");
    expect(slip.replaceError(p, "ph-video", "img")).toBe("Asset img is image; placeholder ph-video needs a video clip.");
    expect(slip.replaceError(p, "ph-audio", "vid")).toBe("Asset vid is video; placeholder ph-audio needs an audio clip.");
    for (const [id, a] of [["ph-image", "vid"], ["ph-video", "vid"], ["ph-audio", "snd"], ["ph-html", "page"]] as const) {
      const r = slip.replaceClipAsset(p, id, a, "shorten");
      expect(r.ok, id).toBe(true);
      const after = r.ok ? r.project.compositions[r.project.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === id)! : undefined;
      expect(after?.placeholder, id).toBeUndefined();
      expect(after?.clipType, id).toBe(p.assets[a].kind);
      if (r.ok) expect(Object.values(r.project.compositions).flatMap(validateComposition), id).toEqual([]);
    }
  });

  it("export: every placeholder is warned about, never mixed, and does not count toward the length", () => {
    const p = placeholderProject(), c = p.compositions[p.rootCompositionId];
    expect(Object.values(p.compositions).flatMap(validateComposition)).toEqual([]);
    for (const pl of c.tracks.flatMap((t) => t.placements)) expect(countsTowardExport(c, pl), pl.id).toBe(false);
    expect(exportEndTicks(p)).toBe(0);
    expect(classifyPlaceholders(p).trailing.map((x) => x.id).sort()).toEqual(TYPES.map((t) => `ph-${t}`).sort());
    expect(exportPlaceholderWarning(p)?.title).toBe("7 shots are not generated yet");
    // Even a placeholder that still points at an audio asset is silent.
    c.tracks.find((t) => t.kind === "audio")!.placements[0].source = { kind: "assetVersion", assetId: "snd", versionId: "snd-v" };
    expect(audioPlan(p)).toEqual([]);
  });
});

describe("P73 unknown clip types (§6)", () => {
  const custom = { scene: { camera: [0, 1, 2], lights: 3 }, futureField: "kept" };
  const unknownProject = (): Project => {
    const p = createProject("unknown-types");
    p.assets.vid = asset("vid", "video", 5);
    const c = p.compositions[p.rootCompositionId];
    const v = c.tracks.find((t) => t.kind === "video")!, a = c.tracks.find((t) => t.kind === "audio")!;
    v.placements.push({ id: "u-video", startTicks: 0, durationTicks: 2 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "vid", versionId: "vid-v" }, clipType: "scene3d" as MediaKind, volume: 1, ...custom } as Placement);
    a.placements.push({ id: "u-audio", startTicks: 0, durationTicks: 2 * S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "spatialmix" as MediaKind, ...custom } as Placement);
    return p;
  };
  const clip = (p: Project, id: string) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.id === id)!;

  it("loads (on any track), keeps every field on save and load, and stays editable", async () => {
    const p = unknownProject();
    expect(isKnownClipType("scene3d")).toBe(false);
    expect(Object.values(p.compositions).flatMap(validateComposition)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const store = createIndexedDbStorage(`p73-${Math.random()}`);
    await store.projects.save(p);
    const loaded = (await store.projects.load(p.id))!;
    expect(loaded.compositions).toEqual(p.compositions);
    const e = new Engine(loaded);
    const videoTrack = loaded.compositions[loaded.rootCompositionId].tracks.find((t) => t.kind === "video")!.id;
    expect(e.dispatch(cmd.movePlacement("u-video", videoTrack, 3 * S))).toBe(true);
    expect(clip(e.getState().project, "u-video")).toMatchObject({ startTicks: 3 * S, clipType: "scene3d", ...custom });
    await store.projects.save(e.getState().project);
    expect((await store.projects.load(p.id))!.compositions).toEqual(e.getState().project.compositions);
  });

  it("draws a slate naming the type in preview, black in export, nothing on an audio track", () => {
    const p = unknownProject(), vid = clip(p, "u-video"), aud = clip(p, "u-audio");
    expect(clipRendererFor(vid)?.id).toBe("unknown");
    expect(texts(draw(vid, "video", false))).toEqual(['fillText("Unknown clip type “scene3d”"', 'fillText("NEEDS A NEWER VERSION"']);
    expect(draw(vid, "video", true)).toEqual(BLACK);
    expect(draw(aud, "audio", false)).toEqual([]);
  });

  it("is silent in export, warned about, and reported to the agent", () => {
    const p = unknownProject();
    expect(hasSound(clip(p, "u-video"))).toBe(false);
    expect(audioPlan(p)).toEqual([]);
    expect(unknownTypeClips(p).map((x) => x.id).sort()).toEqual(["u-audio", "u-video"]);
    expect(exportUnknownTypeWarning(p)).toEqual({ title: "2 clips have types this version can't play", body: "They export as black frames without sound: clip type “scene3d”, “spatialmix”. Their data is kept; open the project in a version that has these types, or export anyway." });
    expect(exportUnknownTypeWarning(createProject("none"))).toBeUndefined();
    expect(timelineReview.clipJson(p, clip(p, "u-video"))).toMatchObject({ id: "u-video", type: "scene3d", unknown: true });
    expect(timelineReview.clipJson(p, { ...clip(p, "u-video"), clipType: "video" })).not.toHaveProperty("unknown");
  });

  it("has a safe UI: a card naming the type, an info-only inspector, no type tools", () => {
    const pl = { id: "u", startTicks: 0, durationTicks: S, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "scene3d" } as unknown as Placement;
    const u = clipUi(pl);
    expect(u).toBe(UNKNOWN_CLIP_UI);
    expect(u.inspectorTabs).toEqual(["unknown"]);
    expect(u.inspectorTitle(pl, createProject("x"))).toBe("Unknown clip type “scene3d”");
    expect([u.speed, u.volume, u.timeTools, u.inOutFrames, u.linkedAudio, u.editor, u.extraTools]).toEqual([false, false, false, false, false, undefined, []]);
    expect(renderToStaticMarkup(<>{u.body!(pl)}</>)).toContain('<span class="v2-ph-label">scene3d</span><span class="v2-ph-state">Unknown type</span>');
    // An unknown-type placeholder is a placeholder first.
    expect(clipUi({ ...pl, placeholder: { label: "Shot 9" } }).id).toBe("placeholder");
  });
});
