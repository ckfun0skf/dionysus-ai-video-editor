/** Schema 3.0 domain model (MVP subset). Pure data; see docs/v2/MODULE_DESIGN.md §5. */
import type { TextData } from "./text";
import type { Storyboard } from "./storyboard";
/** 3.1 (V2-CUT-01): optional `storyboard`. Older schemas upgrade via persistence/schema MIGRATIONS. */
export const SCHEMA = "dionysus/3.1" as const;

/** `html`: a sandboxed HTML page (libraries opt-in via render/htmlLibs) rendered per frame from clip time (see render/htmlClip). */
export type MediaKind = "video" | "image" | "audio" | "html" | "text" | "effect";
/** `effect` tracks hold effect clips (V2-101): time ranges that apply a registry preset to the main-track render. */
export type TrackKind = "video" | "audio" | "text" | "effect";

export interface MediaRef {
  blobKey: string;
  mime: string;
  durationTicks?: number;
  width?: number;
  height?: number;
  thumbKey?: string;
  /** Audio made in the Audio editor: blob key of its `dionysus.audioclip/1` JSON (blobKey is the rendered WAV). */
  specKey?: string;
}

export interface AssetVersion {
  id: string;
  createdAt: string;
  media: MediaRef;
  provenance: { source: "import" | "manual-generation" | "provider" | "derived" | "legacy"; promptText?: string; inputs: { assetId: string; versionId: string }[] };
}

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string;
  versions: AssetVersion[];
  selectedVersionId?: string;
}

export type SourceRef = { kind: "assetVersion"; assetId: string; versionId: string };

export interface Placement {
  id: string;
  startTicks: number;
  durationTicks: number;
  sourceInTicks: number;
  source: SourceRef;
  clipType: MediaKind;
  volume?: number;
  /**
   * Owned child: the embedded source audio of a video placement. It is part of the placement, so it
   * follows every move/trim/split/delete. `muted` is set by Extract Audio (audio then lives on an audio track).
   */
  linkedAudio?: LinkedAudio;
  /** Visual transform (video/image). Absent = identity. */
  transform?: Transform;
  /** Playback speed (0.25..4, default 1). Timeline duration = source span / speed. */
  speed?: number;
  /** Play the source span backwards. */
  reverse?: boolean;
  /** Freeze frame: holds the single source frame at sourceInTicks for the whole duration. */
  freeze?: boolean;
  /** Fade in/out length in ticks: ramps opacity (visual) and volume (audio) from/to 0. */
  fadeInTicks?: number;
  fadeOutTicks?: number;
  /**
   * Set when a storyboard version swap shortened a trimmed clip to fit a shorter version: the trimmed
   * length to restore on a later swap, valid only while the clip is still `clampedTo` long from `inTicks`.
   */
  storyTrim?: { durationTicks: number; clampedTo: number; inTicks: number };
  /** Per-property keyframes; `t` is ticks from the clip start. Linear between keys, held outside. */
  keyframes?: Partial<Record<KeyframeProp, Keyframe[]>>;
  /** Transition from the clip that ends where this one starts (see domain/transitions). */
  /** `kind` is a transition preset id from the registry. */
  /** `params`: the transition preset's own params (V2-SB-130), only those changed from the descriptor defaults. */
  transitionIn?: { kind: string; durationTicks: number; params?: Record<string, number | string> };
  /** Text clips (`clipType: "text"`): content and style. Their `source` is TEXT_SOURCE (no media). */
  text?: TextData;
  /**
   * Blend mode (V2-SB-128): a `blend` registry preset id (screen, multiply, overlay…) for how this visual clip mixes
   * with the layers under it. Absent = normal.
   */
  blend?: string;
  /**
   * P3B-12: chroma key (green screen) for a visual media clip (video, image, html): pixels close to `color` turn
   * transparent. `range` 0–1 is the tolerance, `spill` 0–1 removes the key colour's tint from the edges. `off` keeps
   * the settings but draws the clip unkeyed. Rendered by render/chromaKey in preview and export alike.
   */
  chromaKey?: ChromaKey;
  /**
   * P3B-11: an `audioFx` registry preset (echo, telephone, radio…) on this clip's sound, `amount` 0–1 its intensity.
   * Built by render/audioFx into the same Web Audio graph in preview and export.
   */
  audioFx?: { preset: string; amount: number };
  /** Effect clips (`clipType: "effect"`): a `videoEffect` registry preset id and its params. Source is TEXT_SOURCE. */
  effect?: { preset: string; params?: Record<string, number | string> };
  /**
   * HTML clips (V2-HTML-PARAMS): per-use values for the params the clip's manifest exposes (param key → value). Only
   * overrides are stored; ctx.params is the manifest defaults with these on top (see resolveHtmlParams). Keys the
   * current version doesn't declare are kept (a later version may declare them) but not passed to the clip.
   */
  htmlParams?: Record<string, number | string | boolean>;
  /**
   * Storyboard linked item (V2-SB-113): a layer, caption or effect clip sent with a shot. It follows the shot clip
   * `anchor` on version swaps (see domain/storyLinks). `want` remembers the offset/length before a clamp.
   */
  /** Storyboard shot this clip was sent as (V2-CUT-02): lets shots that share a clip asset be sent once each. */
  storyShot?: string;
  /** Storyboard audio cue this clip was sent as (P1-AUDIO): a cue is placed once, even when its shots were sent earlier. */
  storyCue?: string;
  storyLink?: { anchor: string; want?: { offset: number; duration: number; clampedOffset: number; clampedDuration: number } };
}

/** Placeholder source of text clips: they reference no asset. */
export const TEXT_SOURCE: SourceRef = { kind: "assetVersion", assetId: "", versionId: "" };
/** Clips that hold one picture (no source time): images and text. */
export const isStill = (p: Pick<Placement, "clipType">) => p.clipType === "image" || p.clipType === "text" || p.clipType === "effect";
/** Default length of a new effect clip. */
export const DEFAULT_EFFECT_TICKS = 3 * 120_000;

/** `volume` (P3B-11): the volume envelope, a gain multiplier 0–2 on top of `volume` and the fades (audio and video clips). */
export type KeyframeProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
/** The keyed transform properties (everything but the volume envelope). */
export type TransformKeyProp = Exclude<KeyframeProp, "volume">;
export interface ChromaKey { color: string; range: number; spill: number; off?: boolean }
/** Defaults of a new chroma key: pure green, medium tolerance, some spill suppression. */
export const CHROMA_DEFAULT: ChromaKey = { color: "#00ff00", range: 0.4, spill: 0.5 };
/** Clips a chroma key can apply to. */
export const canChromaKey = (p: Pick<Placement, "clipType">) => p.clipType === "video" || p.clipType === "image" || p.clipType === "html";
/** Clips with sound a volume curve and audio effects can apply to. */
export const hasSound = (p: Pick<Placement, "clipType">) => p.clipType === "audio" || p.clipType === "video";
/** 0..2 volume-envelope multiplier at absolute time `t` (1 without keys). */
export function volumeKeyAt(p: Placement, t: number): number { return evalKeys(p.keyframes?.volume, t - p.startTicks) ?? 1; }
export interface Keyframe { t: number; v: number }

/** Piecewise-linear value of sorted keys at offset `t`; undefined when there are no keys. */
export function evalKeys(keys: Keyframe[] | undefined, t: number): number | undefined {
  if (!keys?.length) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1);
  }
  return keys[keys.length - 1].v;
}

/** 0..1 fade multiplier at absolute time `t`. */
export function fadeAt(p: Placement, t: number): number {
  const o = t - p.startTicks;
  let g = 1;
  if (p.fadeInTicks) g = Math.min(g, Math.max(0, o / p.fadeInTicks));
  if (p.fadeOutTicks) g = Math.min(g, Math.max(0, (p.durationTicks - o) / p.fadeOutTicks));
  return g;
}

/** Effective transform at absolute time `t`: static transform overridden by keyframes, opacity × fade. */
export function transformAt(p: Placement, t: number): Transform {
  const base = transformOf(p);
  const o = t - p.startTicks;
  const out = { ...base };
  for (const k of ["x", "y", "scale", "rotation", "opacity"] as const) { const v = evalKeys(p.keyframes?.[k], o); if (v !== undefined) out[k] = v; }
  out.opacity *= fadeAt(p, t);
  return out;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
/** Source time shown at absolute timeline time `t` (accounts for speed, reverse and freeze). */
export function sourceAt(p: Placement, t: number): number {
  if (p.freeze || isStill(p)) return p.sourceInTicks;
  const s = p.speed ?? 1;
  const o = Math.min(Math.max(0, t - p.startTicks), p.durationTicks);
  return p.reverse ? p.sourceInTicks + Math.max(0, Math.round((p.durationTicks - o) * s) - 1) : p.sourceInTicks + Math.round(o * s);
}

/**
 * x/y: offset of the clip centre from the frame centre, as a fraction of frame width/height.
 * scale: 1 = contain-fit. rotation: degrees clockwise. opacity: 0..1. crop: fraction trimmed per edge.
 */
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; crop: { l: number; t: number; r: number; b: number } }
export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 } };
export function transformOf(p: Placement): Transform { return { ...IDENTITY_TRANSFORM, ...p.transform, crop: { ...IDENTITY_TRANSFORM.crop, ...p.transform?.crop } }; }

/** Clamp a transform patch into valid ranges (crop leaves at least 5% of each axis). */
export function clampTransform(t: Transform): Transform {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
  const l = c(t.crop.l, 0, 0.95), tt = c(t.crop.t, 0, 0.95);
  return { x: c(t.x, -2, 2), y: c(t.y, -2, 2), scale: c(t.scale, 0.05, 10), rotation: c(t.rotation, -360, 360), opacity: c(t.opacity, 0, 1), crop: { l, t: tt, r: c(t.crop.r, 0, 0.95 - l), b: c(t.crop.b, 0, 0.95 - tt) } };
}

export interface LinkedAudio { muted?: boolean }

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  /** Video tracks only: "text" puts stickers/HTML in the Text & Stickers group (interleaved with text). */
  group?: "overlay" | "text";
  /** V2-103: shared style of a text layer; clips store only overrides (see domain/layerStyle). */
  layerStyle?: import("./layerStyle").LayerStyle;
  placements: Placement[];
}

export interface Composition {
  id: string;
  name: string;
  /** index 0 = top visual layer */
  tracks: Track[];
  /** Timed text cues drawn over the picture (V2-030). */
  subtitles?: Subtitle[];
}

export interface Subtitle { id: string; startTicks: number; durationTicks: number; text: string }

export interface Project {
  schema: typeof SCHEMA;
  id: string;
  name: string;
  /** `background` (V2-106): canvas fill behind every layer, default black. Optional so 3.0 projects stay valid. */
  settings: { width: number; height: number; fps: number; background?: string };
  rootCompositionId: string;
  assets: Record<string, Asset>;
  compositions: Record<string, Composition>;
  meta: { createdAt: string; updatedAt: string };
  /** Storyboard workspace (3.1); absent until the user imports one. */
  storyboard?: Storyboard;
  /** P5: the Series this project is an episode of (Series live in local storage, see domain/series.ts). */
  seriesId?: string;
}

/** Default still-image duration when placed on the timeline. */
export const DEFAULT_IMAGE_TICKS = 3 * 120_000;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}${counter.toString(36)}`;
}

export function createProject(name = "Untitled project", now = new Date().toISOString()): Project {
  const compId = newId("comp");
  return {
    schema: SCHEMA,
    id: newId("proj"),
    name,
    settings: { width: 1920, height: 1080, fps: 30 },
    rootCompositionId: compId,
    assets: {},
    compositions: {
      [compId]: {
        id: compId,
        name: "Master Timeline",
        tracks: [
          { id: newId("trk"), kind: "video", name: "Video 1", placements: [] },
          { id: newId("trk"), kind: "audio", name: "Audio 1", placements: [] },
        ],
      },
    },
    meta: { createdAt: now, updatedAt: now },
  };
}

export function trackKindFor(kind: MediaKind): TrackKind {
  return kind === "audio" ? "audio" : kind === "text" ? "text" : kind === "effect" ? "effect" : "video";
}

export function compositionDuration(comp: Composition): number {
  let end = 0;
  for (const t of comp.tracks) for (const p of t.placements) end = Math.max(end, p.startTicks + p.durationTicks);
  for (const s of comp.subtitles ?? []) end = Math.max(end, s.startTicks + s.durationTicks);
  return end;
}

export function findPlacement(comp: Composition, placementId: string): { track: Track; placement: Placement; index: number } | undefined {
  for (const track of comp.tracks) {
    const index = track.placements.findIndex((p) => p.id === placementId);
    if (index >= 0) return { track, placement: track.placements[index], index };
  }
  return undefined;
}

export function versionOf(project: Project, ref: SourceRef): AssetVersion | undefined {
  return project.assets[ref.assetId]?.versions.find((v) => v.id === ref.versionId);
}

/**
 * V2-SB-133: the latest source in point of a video clip that still fits its length (media length minus the span the
 * clip plays), or undefined when the clip has no slip (not video, a freeze frame, or unknown media length).
 */
export function sourceInMax(project: Project, p: Placement): number | undefined {
  if (p.clipType !== "video" || p.freeze) return undefined;
  const media = versionOf(project, p.source)?.media.durationTicks;
  if (!media) return undefined;
  return Math.max(0, media - Math.round(p.durationTicks * (p.speed ?? 1)));
}

/** Validates structural invariants; returns list of problems (empty = valid). */
export function validateComposition(comp: Composition): string[] {
  const errors: string[] = [];
  for (const t of comp.tracks) {
    const sorted = [...t.placements].sort((a, b) => a.startTicks - b.startTicks);
    sorted.forEach((p, i) => {
      if (![p.startTicks, p.durationTicks, p.sourceInTicks].every(Number.isInteger)) errors.push(`${p.id}: non-integer ticks`);
      if (p.durationTicks <= 0) errors.push(`${p.id}: non-positive duration`);
      if (p.startTicks < 0) errors.push(`${p.id}: negative start`);
      if (p.sourceInTicks < 0) errors.push(`${p.id}: negative source in`);
      if (trackKindFor(p.clipType) !== t.kind) errors.push(`${p.id}: ${p.clipType} on ${t.kind} track`);
      const next = sorted[i + 1];
      if (next && p.startTicks + p.durationTicks > next.startTicks) errors.push(`${p.id} overlaps ${next.id}`);
    });
  }
  return errors;
}
