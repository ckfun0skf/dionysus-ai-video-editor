/**
 * P71 (Phase 1 step 1.6 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): parity for the storyboard mapping and media-kind
 * detection that move into the clip type cores. Two parts:
 *  1. Frozen copies of the pre-P71 switches (`kindForSlot`, `mediaKindOf`, `mimeOf`, the Sync slot and layer types),
 *     compared with today's functions over many asset, slot and file shapes, so the check is not circular.
 *  2. A golden of what Send, Update and Sync produce for shots and layers of every asset kind (shot clip lengths and
 *     in points, html params, shared clips, version trims, placeholders filled, new shots, layers and cues written back),
 *     recorded on the pre-P71 code. `UPDATE_STORY_GOLDEN=1` rewrites it (only for an intended behaviour change).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Asset, type AssetVersion, type MediaKind, type MediaRef, type Placement, type Project } from "./model";
import * as board from "./storyboard";
import { SHOT_RENDERS, STORY_ASSET_TYPES, validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory, shotClipSpan, updateStory } from "./storySend";
import { syncPlan } from "./storySync";
import { mainTrack } from "./ops";
import { secondsToTicks as s } from "./time";
import { mediaKindOf, mimeOf } from "../persistence/media";

const GOLDEN = join(__dirname, "__golden__", "storyMappingParity.json");

/** Frozen pre-P71 code (storyboard.ts, persistence/media.ts, storySync.ts). */
const LEGACY = {
  kindForSlot: (t: string): MediaKind => (t === "video" ? "video" : t === "audio" ? "audio" : t === "html" ? "html" : "image"),
  mediaKindOf(file: { type: string; name: string }): MediaKind | undefined {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type === "text/html") return "html";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
    if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
    if (["html", "htm"].includes(ext)) return "html";
    return undefined;
  },
  mimeOf(file: { type: string; name: string }): string {
    const M: Record<string, string> = { mov: "video/quicktime", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", html: "text/html", htm: "text/html" };
    return file.type || M[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  },
};

const SLOT_SHAPES = [...STORY_ASSET_TYPES, "scene", "text", "effect", "", "VIDEO", "unknown"];
const MIMES = ["", "video/mp4", "video/quicktime", "video/x-matroska", "image/png", "image/heic", "image/svg+xml", "audio/mpeg", "audio/wav", "text/html", "text/plain", "application/octet-stream", "model/gltf-binary", "application/json", "text/html; charset=utf-8"];
const EXTS = ["mp4", "webm", "mov", "m4v", "MOV", "png", "jpg", "jpeg", "JPG", "gif", "webp", "heic", "svg", "mp3", "wav", "m4a", "aac", "ogg", "flac", "html", "htm", "HTML", "glb", "json", "txt", "mkv"];
const NAMES = [...EXTS.map((e) => `clip.${e}`), ...EXTS.map((e) => `a.b.${e}`), "noext", "", ".mp4", "trailingdot.", "video.mp4.txt", "page.htm.html"];
const FILES = MIMES.flatMap((type) => NAMES.map((name) => ({ type, name })));

describe("P71 storyboard mapping and media-kind detection: frozen pre-P71 switches", () => {
  it("kindForSlot for every storyboard asset type (and unknown strings)", () => {
    for (const t of SLOT_SHAPES) expect(board.kindForSlot(t as never), t).toBe(LEGACY.kindForSlot(t));
  });
  it(`mediaKindOf and mimeOf for ${FILES.length} file shapes`, () => {
    for (const f of FILES) {
      expect(mediaKindOf(f), JSON.stringify(f)).toBe(LEGACY.mediaKindOf(f));
      expect(mimeOf(f), JSON.stringify(f)).toBe(LEGACY.mimeOf(f));
    }
  });
});

// ---- Golden: Send / Update / Sync over shots and layers of every asset kind ----

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const media = (kind: MediaKind, sec?: number, key = `${kind}-${sec ?? 0}`): MediaRef => ({
  blobKey: key, mime: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : kind === "html" ? "text/html" : "image/png",
  ...(sec !== undefined ? { durationTicks: s(sec) } : {}), ...(kind === "audio" ? {} : { width: kind === "image" ? 1000 : 1920, height: 1080 }),
});
const box = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
const NOW = "2026-11-15T00:00:00Z";

function storyDoc(): StoryDoc {
  const d: J = {
    format: "dionysus.storyboard/1",
    meta: { title: "Parity", aspect: "16:9" },
    assets: [
      { id: "bg", name: "Background", type: "image", prompt: "plain blue", qa: [] },
      { id: "logo", name: "Logo", type: "html", prompt: "spinning logo", qa: [] },
      { id: "hero", name: "Hero", type: "character", prompt: "hero sheet", qa: [] },
      { id: "place", name: "Place", type: "location", prompt: "street", qa: [] },
      { id: "key", name: "Key", type: "frame", prompt: "first frame", qa: [] },
      { id: "dust", name: "Dust", type: "video", prompt: "dust specks", qa: [], genDurationSec: 6 },
      { id: "song", name: "Song", type: "audio", prompt: "calm", qa: [] },
      { id: "shared", name: "Shared", type: "video", prompt: "a long take", qa: [] },
    ],
    shots: [
      { id: "s1", title: "AI with layers", durationSec: 5, prompt: "a walk", assets: ["hero"], qa: [], layers: [
        { id: "l-dust", type: "video", asset: "dust", startSec: 0, endSec: 2, box, inSec: 1 },
        { id: "l-dust2", type: "video", asset: "dust", startSec: 1, endSec: 5, box },
        { id: "l-bg", type: "image", asset: "bg", startSec: 1, endSec: 3, box },
        { id: "l-logo", type: "html", asset: "logo", startSec: 0, endSec: 4, box, params: { title: "Hi" } },
        { id: "l-logo0", type: "html", asset: "logo", startSec: 2, endSec: 4, box },
        { id: "l-hero", type: "image", asset: "hero", startSec: 0, endSec: 1, box },
        { id: "l-key", type: "image", asset: "key", startSec: 3, endSec: 5, box },
      ] },
      { id: "s2", title: "Still", durationSec: 4, render: "still", clip: "bg", assets: [], qa: [] },
      { id: "s3", title: "Html", durationSec: 3, render: "html", clip: "logo", params: { title: "Shot", n: 2 }, assets: [], qa: [] },
      { id: "s3b", title: "Html no params", durationSec: 2.5, render: "html", clip: "logo", assets: [], qa: [] },
      { id: "s4", title: "Shared clip", durationSec: 3, prompt: "x", clip: "shared", clipInSec: 1.5, assets: [], qa: [] },
      { id: "s4b", title: "Shared clip past end", durationSec: 9, prompt: "x", clip: "shared", clipInSec: 6, assets: [], qa: [] },
      { id: "s5", title: "Placeholder video", durationSec: 5, prompt: "later", assets: [], qa: [] },
      { id: "s6", title: "Trimmed take", durationSec: 2, prompt: "trim", assets: [], qa: [] },
      { id: "s7", title: "Second still", durationSec: 3.5, render: "still", clip: "bg", assets: [], qa: [] },
      { id: "s8", title: "Placeholder html", durationSec: 4, render: "html", clip: "logo", params: { title: "Late" }, assets: [], qa: [] },
      { id: "s9", title: "Short", durationSec: 0.5, prompt: "z", assets: [], qa: [] },
    ],
    audio: [{ id: "cue1", asset: "song", kind: "music", from: "s1", to: "s3", volume: 0.5 }],
  };
  const r = validateStoryboard(d);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
}

function produced(): Project {
  let p: Project = board.setStoryboard(createProject("parity"), board.storyboardFromDoc(storyDoc()));
  const add = (t: board.Target, m: MediaRef, versionId: string, extra: J = {}) => { p = board.addStoryVersion(p, t, m, { versionId, now: NOW, ...extra }); };
  add({ shot: "s1" }, media("video", 5, "s1"), "v-s1");
  add({ slot: "bg" }, media("image"), "v-bg");
  add({ slot: "logo" }, media("html"), "v-logo");
  add({ slot: "hero" }, media("image", undefined, "hero"), "v-hero");
  add({ slot: "place" }, media("image", undefined, "place"), "v-place");
  add({ slot: "key" }, media("image", undefined, "key"), "v-key");
  add({ slot: "dust" }, media("video", 6, "dust"), "v-dust", { trim: { inTicks: s(0.5), outTicks: s(4) } });
  add({ slot: "song" }, media("audio", 20, "song"), "v-song");
  add({ slot: "shared" }, media("video", 8, "shared"), "v-shared");
  add({ shot: "s6" }, media("video", 7, "s6"), "v-s6", { trim: { inTicks: s(1), outTicks: s(3.5) } });
  add({ shot: "s9" }, media("video", 4, "s9"), "v-s9");
  return p;
}

/** Stable JSON: generated ids numbered in order of appearance. */
function norm(v: unknown): unknown {
  const ids = new Map<string, string>();
  const json = JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x instanceof Set ? [...x] : x));
  return JSON.parse(json.replace(/\b[a-z]{2,6}_[0-9a-f]{8}[0-9a-z]*\b/g, (m) => { if (!ids.has(m)) ids.set(m, `id${ids.size + 1}`); return ids.get(m)!; }));
}
const root = (p: Project) => p.compositions[p.rootCompositionId];
const clipsOf = (p: Project) => root(p).tracks.map((t) => ({ kind: t.kind, name: t.name, placements: t.placements }));

function scenarios(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 1. shotClipSpan for every asset kind × shot shape × media length × version trim.
  const p0 = produced(), b0 = p0.storyboard!;
  const spans: unknown[] = [];
  for (const kind of ["video", "image", "audio", "html", "text", "effect", "scene3d"] as MediaKind[]) {
    for (const dur of [undefined, 0, 2, 6]) for (const trim of [undefined, { inTicks: s(1), outTicks: s(3) }]) {
      const v: AssetVersion = { id: "vx", createdAt: NOW, media: media(kind, dur, "x") } as AssetVersion;
      const asset = { id: "ax", kind, name: "x", versions: [v], selectedVersionId: "vx" } as Asset;
      const b = structuredClone(b0); b.versions.vx = { inputs: [], ...(trim ? { trim } : {}) };
      for (const shot of [
        { durationSec: 5 }, { durationSec: 0 }, { durationSec: 3, render: "html" }, { durationSec: 3, render: "still" },
        { durationSec: 3, clipSlot: "shared" }, { durationSec: 3, clipSlot: "shared", clipInSec: 1 }, { durationSec: 9, clipSlot: "shared", clipInSec: 5 },
        { durationSec: 2, render: "still", clipSlot: "bg" },
      ]) spans.push([kind, dur, !!trim, shot, shotClipSpan(b, asset, v, { id: "sx", title: "x", description: "", prompt: "", assets: [], qa: [], ...shot } as never)]);
    }
  }
  out.shotClipSpan = spans;
  // 2. Send.
  const sent = sendStory(p0);
  out.send = { result: sent.result, tracks: clipsOf(sent.project), assets: sent.project.assets };
  // 3. Update: fill the placeholders (video shorter than the placeholder, html with params) and pick a new trim.
  let p = sent.project;
  p = board.addStoryVersion(p, { shot: "s5" }, media("video", 2, "s5"), { versionId: "v-s5", now: NOW });
  p = board.addStoryVersion(p, { slot: "logo" }, media("html", undefined, "logo2"), { versionId: "v-logo2", now: NOW });
  const up = updateStory(p);
  out.update = { result: up.result, tracks: clipsOf(up.project) };
  // 4. Sync back: edits on sent clips, new main clips and overlay clips of every kind.
  const q = structuredClone(up.project), c = root(q), main = mainTrack(c)!;
  const byShot = (id: string) => main.placements.find((x) => x.storyShot === id)!;
  byShot("s6").durationTicks = s(1.5); byShot("s6").sourceInTicks = s(1.25);
  byShot("s4").sourceInTicks = s(2);
  byShot("s2").durationTicks = s(2);
  // Loose timeline assets (no storyboard slot yet): Sync makes an upload slot of the matching type for each.
  for (const kind of ["video", "image", "audio", "html"] as MediaKind[]) {
    const id = `loose-${kind}`;
    q.assets[id] = { id, kind, name: `Loose ${kind}`, versions: [{ id: `lv-${kind}`, createdAt: NOW, media: media(kind, kind === "image" || kind === "html" ? undefined : 6, id), provenance: { source: "import", inputs: [] } }], selectedVersionId: `lv-${kind}` };
  }
  const endOfMain = Math.max(...main.placements.map((x) => x.startTicks + x.durationTicks));
  const ref = (id: string) => { const a = Object.values(q.assets).find((x) => x.versions.some((v) => v.id === id))!; return { assetId: a.id, versionId: id }; };
  let at = endOfMain;
  for (const [i, [clipType, vid]] of ([["video", "v-dust"], ["image", "v-hero"], ["html", "v-logo"], ["image", "v-place"], ["video", "lv-video"], ["image", "lv-image"], ["html", "lv-html"]] as const).entries()) {
    const pl: Placement = { id: `new-main-${i}`, startTicks: at, durationTicks: s(2), sourceInTicks: 0, source: { kind: "assetVersion", ...ref(vid) }, clipType, volume: 1 };
    main.placements.push(pl); at += s(2);
  }
  const s1 = byShot("s1");
  const overlay = c.tracks.find((t) => t.kind === "video" && t.id !== main.id)!;
  const extra: [Placement["clipType"], string][] = [["video", "v-s6"], ["image", "v-key"], ["html", "v-logo"], ["image", "v-bg"], ["video", "lv-video"], ["image", "lv-image"], ["html", "lv-html"]];
  extra.forEach(([clipType, vid], i) => overlay.placements.push({ id: `new-ov-${i}`, startTicks: s1.startTicks + s(0.25 * i), durationTicks: s(0.2), sourceInTicks: 0, source: { kind: "assetVersion", ...ref(vid) }, clipType, volume: 1, link: { parent: s1.id }, transform: { x: 0.1 * i, y: 0, scale: 0.5 } as never }));
  const audioTrack = c.tracks.find((t) => t.kind === "audio") ?? (c.tracks.push({ id: "aud", kind: "audio", name: "Audio", placements: [] } as never), c.tracks.at(-1)!);
  audioTrack.placements.push({ id: "new-sfx", startTicks: s1.startTicks + s(1), durationTicks: s(1), sourceInTicks: 0, source: { kind: "assetVersion", ...ref("v-song") }, clipType: "audio", volume: 0.8 });
  audioTrack.placements.push({ id: "new-sfx2", startTicks: s1.startTicks + s(2.5), durationTicks: s(1), sourceInTicks: 0, source: { kind: "assetVersion", ...ref("lv-audio") }, clipType: "audio", volume: 1 });
  const sy = syncPlan(q);
  out.sync = { changes: sy.changes, storyboard: sy.project.storyboard, tracks: clipsOf(sy.project) };
  return norm(out) as Record<string, unknown>;
}

describe("P71 storyboard mapping golden (recorded before the move)", () => {
  it("Send, Update and Sync produce the same project and storyboard", () => {
    const got = scenarios();
    expect(SHOT_RENDERS).toEqual(["ai", "html", "still"]);
    if (process.env.UPDATE_STORY_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + "\n");
    const want = JSON.parse(readFileSync(GOLDEN, "utf8"));
    for (const k of Object.keys(want)) expect(got[k], k).toEqual(want[k]);
    expect(Object.keys(got)).toEqual(Object.keys(want));
  });
});
