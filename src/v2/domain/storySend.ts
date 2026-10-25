/**
 * "Send to timeline" for storyboard format v1.1 (V2-SB-113, spec docs/v2/STORYBOARD_FORMAT.md §5 mapping).
 * Ready shots are appended to the main track in story order, each from its selected version:
 * - ai shots use their clip; html and still shots use their clip slot's asset for the planned shot length;
 * - text layers become text clips, html/image/video layers become overlay clips filling their box;
 * - html shot and layer `params` (V2-HTML-PARAMS) become the clip's per-use param values (`htmlParams`);
 * - `captions: true` writes the dialogue into the shared subtitle layer for the shot's range;
 * - shot effects become effect-layer clips over the shot (or their sub-range);
 * - a connection `transition` becomes `transitionIn` on the `to` clip when the two clips are adjacent;
 * - audio cues (V2-SB-125) go on Voiceover, Music and Sound effects layers with their volume and fades.
 * Every layer, caption and effect clip is linked to the shot clip (see storyLinks). Unknown preset ids fall back:
 * transition → cut, textStyle → plain, text animations and effects → none.
 */
import { DEFAULT_IMAGE_TICKS, newId, TEXT_SOURCE, type Asset, type AssetVersion, type Composition, type Placement, type Project, type Track, type Transform } from "./model";
import { addTrack, groupOf, insertPlacement, isFree, mainTrack } from "./ops";
import { SUBTITLE_STYLE } from "./layerStyle";
import { getPreset, parsePresetRef, type PresetKind } from "../registry";
import { AUDIO_DEFAULTS, DEFAULT_TEXT_SIZE, DEFAULT_TRANSITION_SEC, type AudioKind, TEXT_LINE_HEIGHT, type StoryBox, type StoryLayer, type StoryMediaLayer, type StoryTextLayer, type StoryTextStyle } from "./storyJson";
import { pinOf, sendPlan, versionSpan, type Shot, type Storyboard } from "./storyboard";
import { clampToClip, placeOnFreeTrack } from "./storyLinks";
import { textOf, textStyleData, textStyleFields, type TextData } from "./text";
import { previousAdjacent, setTransition } from "./transitions";
import { secondsToTicks, TICKS_PER_SECOND } from "./time";
import { followKeyframes, type MotionEffect } from "./storyFollow";

/** What one send added, for the confirmation note. */
export interface SendResult { shots: number; layers: number; captions: number; effects: number; transitions: number; skippedLayers: number; audio: number; skippedAudio: number; firstClipId?: string }

/** Audio layer names per cue kind (V2-SB-125): one kind per layer, so voice, music and effects mix separately. */
export const AUDIO_TRACK_NAMES: Record<AudioKind, string> = { voiceover: "Voiceover", music: "Music", sfx: "Sound effects" };

const selectedVersion = (a: Asset): AssetVersion | undefined => a.versions.find((v) => v.id === a.selectedVersionId) ?? a.versions[0];

/** Registry id of a written preset reference (`id` or `id@N`) when the registry has it. */
function presetId(kind: PresetKind, ref: string | undefined): string | undefined {
  const r = ref ? parsePresetRef(ref) : undefined;
  return r && getPreset(kind, r.id) ? r.id : undefined;
}

/** Text clip fields that inline storyboard styles may set (anything else is ignored). */
const STYLE_KEYS = new Set(["font", "size", "color", "align", "bold", "italic", "letterSpacing", "lineHeight", "strokeWidth", "strokeColor", "shadow", "background", "effect", "effectColor"]);
const pickStyle = (s: StoryTextStyle | undefined): Partial<TextData> => (s ? textStyleFields(Object.fromEntries(Object.entries(s).filter(([k]) => STYLE_KEYS.has(k)))) : {});

/**
 * Text clip data for a text layer (spec §2.5): the textStyle (a `meta.textStyles` entry first, else the registry
 * preset, else `plain`), then the inline style on top. Size: `style.size`, else fitted to the box height, else the
 * style's size, else 0.1. Text is not wrapped: line breaks are the author's.
 */
export function textLayerData(b: Pick<Storyboard, "meta">, l: StoryTextLayer): TextData {
  const ref = l.textStyle ? parsePresetRef(l.textStyle) : undefined;
  const local = l.textStyle ? b.meta.textStyles?.[l.textStyle] ?? (ref ? b.meta.textStyles?.[ref.id] : undefined) : undefined;
  const base = local ? pickStyle(local) : textStyleData(presetId("textStyle", l.textStyle) ?? "plain") ?? {};
  const inline = pickStyle(l.style);
  const lines = Math.max(1, l.text.split("\n").length);
  const size = typeof l.style?.size === "number" ? l.style.size : l.box ? l.box.height / (lines * TEXT_LINE_HEIGHT) : base.size ?? DEFAULT_TEXT_SIZE;
  const animIn = presetId("textAnimIn", l.anim?.in), animOut = presetId("textAnimOut", l.anim?.out), loop = presetId("textAnimLoop", l.anim?.loop);
  const d: TextData = textOf({ ...base, ...inline, text: l.text, size });
  if (l.box && typeof l.style?.size !== "number") d.lineHeight = TEXT_LINE_HEIGHT;
  if (animIn) d.animIn = animIn;
  if (animOut) d.animOut = animOut;
  if (loop) d.loop = loop;
  if (typeof l.anim?.durationSec === "number" && l.anim.durationSec > 0) d.animTicks = secondsToTicks(l.anim.durationSec);
  return d;
}

/** Transform that puts a text layer's centre on its `position`, or on its `box` centre. */
export function textLayerTransform(l: StoryTextLayer): Partial<Transform> | undefined {
  const c = l.box ? { x: l.box.x + l.box.width / 2, y: l.box.y + l.box.height / 2 } : l.position;
  if (!c) return undefined;
  const x = c.x - 0.5, y = c.y - 0.5;
  return x || y ? { x, y } : undefined;
}

/**
 * Transform that makes a `mw`×`mh` medium fill `box` of a `fw`×`fh` frame. Scale 1 is contain-fit to the frame,
 * so the scale is the box size over that fit (the box keeps the medium's aspect: it fits inside the box).
 */
export function boxTransform(box: StoryBox, mw: number, mh: number, fw: number, fh: number): Partial<Transform> {
  const ma = mw > 0 && mh > 0 ? mw / mh : fw / fh, fa = fw / fh;
  const fitW = ma >= fa ? 1 : ma / fa, fitH = ma >= fa ? fa / ma : 1;
  const scale = Math.min(box.width / fitW, box.height / fitH);
  return { x: box.x + box.width / 2 - 0.5, y: box.y + box.height / 2 - 0.5, scale };
}

/** Clip range of a layer or effect inside a shot clip `len` ticks long (clamped, never dropped). */
function rangeIn(len: number, startSec = 0, endSec?: number): { offset: number; duration: number } {
  const off = Math.max(0, secondsToTicks(startSec));
  const end = endSec === undefined ? len : secondsToTicks(endSec);
  return clampToClip(off, Math.max(1, end - off), len);
}

const plainText = () => (t: Track) => t.kind === "text" && !t.layerStyle;
const overlay = (comp: Composition) => (t: Track) => t.kind === "video" && groupOf(comp, t) === "overlay";
const effects = () => (t: Track) => t.kind === "effect";

/** The shot clip placement for a ready shot: html/still shots get the planned shot length, others as dropped from the library. */
function shotClip(b: Storyboard, asset: Asset, v: AssetVersion, shot: Shot, at: number): Placement {
  const planned = shot.durationSec > 0 ? secondsToTicks(shot.durationSec) : DEFAULT_IMAGE_TICKS;
  // A video clip uses its version's trim (V2-SB-121), else the whole clip.
  const span = !shot.clipSlot && asset.kind === "video" ? versionSpan(b, v) : undefined;
  const durationTicks = shot.clipSlot || asset.kind === "html" ? planned : asset.kind === "image" ? DEFAULT_IMAGE_TICKS : span?.lenTicks ?? v.media.durationTicks ?? DEFAULT_IMAGE_TICKS;
  // V2-HTML-PARAMS: an html shot's per-use param values go onto its clip (only overrides; defaults come from the clip).
  const params = asset.kind === "html" && shot.params && Object.keys(shot.params).length ? { htmlParams: { ...shot.params } } : {};
  return { id: newId("plc"), startTicks: at, durationTicks, sourceInTicks: span?.inTicks ?? 0, source: { kind: "assetVersion", assetId: asset.id, versionId: v.id }, clipType: asset.kind, volume: 1, storyShot: shot.id, ...params };
}

function mediaLayer(p: Project, b: Storyboard, shot: Shot, l: StoryMediaLayer, start: number, dur: number, anchor: string): Placement | undefined {
  const slot = b.slots[l.asset];
  const a = slot?.assetId ? p.assets[slot.assetId] : undefined;
  // A version pinned for this shot wins over the slot's selected one (V2-CUT-05).
  const pin = pinOf(p, shot, l.asset);
  const v = a && ((pin && a.versions.find((x) => x.id === pin)) || selectedVersion(a));
  if (!a || !v || (a.kind !== "image" && a.kind !== "video" && a.kind !== "html")) return undefined;
  const mw = v.media.width ?? p.settings.width, mh = v.media.height ?? p.settings.height;
  const max = a.kind === "video" ? v.media.durationTicks : undefined;
  // V2-SB-133: a video layer starts at its inSec, else at its version's trim (set on upload), else at 0; when that
  // runs past the clip's end it starts earlier so the layer keeps its length.
  const len = max ? Math.min(dur, max) : dur;
  const want = max ? (l.inSec !== undefined ? secondsToTicks(l.inSec) : versionSpan(b, v)?.inTicks ?? 0) : 0;
  const sourceInTicks = max ? Math.max(0, Math.min(want, max - len)) : 0;
  return {
    id: newId("plc"), startTicks: start, durationTicks: len, sourceInTicks,
    source: { kind: "assetVersion", assetId: a.id, versionId: v.id }, clipType: a.kind, volume: 1,
    transform: { ...boxTransform(l.box, mw, mh, p.settings.width, p.settings.height) } as Transform, storyLink: { anchor },
    ...(a.kind === "html" && l.params && Object.keys(l.params).length ? { htmlParams: { ...l.params } } : {}),
  };
}

/** V2-SB-128: the layer's blend mode as a placement field (left out for normal or an unknown id). */
const blendOf = (l: StoryLayer): { blend?: string } => {
  const id = presetId("blend", l.blend);
  return id && id !== "normal" ? { blend: id } : {};
};

/** Keyframe spacing for layers that follow the shot: linear keys every 0.25 s track any built-in motion closely. */
const FOLLOW_STEP_TICKS = TICKS_PER_SECOND / 4;

/** Linked layers, captions and effects for one shot clip. */
function addLinked(p: Project, b: Storyboard, comp: Composition, shot: Shot, clip: Placement, res: SendResult): Composition {
  let c = comp;
  const anchor = clip.id;
  // V2-SB-126: the shot's motion (effects only move the main-track picture) is baked into layers that follow the shot.
  const motion: MotionEffect[] = (shot.effects ?? []).flatMap((e) => {
    const preset = presetId("videoEffect", e.preset);
    return preset ? [{ preset, params: e.params, ...rangeIn(clip.durationTicks, e.startSec, e.endSec) }] : [];
  });
  const follow = (l: StoryLayer, r: { offset: number; duration: number }, t: Partial<Transform> | undefined) =>
    l.follow === "shot" ? followKeyframes(motion, r.offset, r.duration, { x: t?.x ?? 0, y: t?.y ?? 0, scale: t?.scale ?? 1 }, FOLLOW_STEP_TICKS) : undefined;
  for (const l of shot.layers ?? [] as StoryLayer[]) {
    const r = rangeIn(clip.durationTicks, l.startSec, l.endSec);
    const start = clip.startTicks + r.offset;
    if (l.type === "text") {
      const t0 = textLayerTransform(l);
      const t = l.opacity !== undefined ? { ...t0, opacity: l.opacity } : t0;
      const keyframes = follow(l, r, t);
      const pl: Placement = { id: newId("plc"), startTicks: start, durationTicks: r.duration, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: textLayerData(b, l), ...(t ? { transform: t as Transform } : {}), ...(keyframes ? { keyframes } : {}), ...blendOf(l), storyLink: { anchor } };
      c = placeOnFreeTrack(c, pl, plainText());
      res.layers += 1;
    } else {
      const pl = mediaLayer(p, b, shot, l, start, r.duration, anchor);
      if (!pl) { res.skippedLayers += 1; continue; }
      if (l.opacity !== undefined) pl.transform = { ...pl.transform, opacity: l.opacity } as Transform;
      Object.assign(pl, blendOf(l));
      const keyframes = follow(l, { offset: r.offset, duration: pl.durationTicks }, pl.transform);
      if (keyframes) pl.keyframes = keyframes;
      c = placeOnFreeTrack(c, pl, overlay(c));
      res.layers += 1;
    }
  }
  if (shot.captions && shot.dialogue?.trim()) {
    const cue: Placement = { id: newId("plc"), startTicks: clip.startTicks, durationTicks: clip.durationTicks, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: { text: shot.dialogue.trim() } as TextData, storyLink: { anchor } };
    const shared = c.tracks.find((t) => t.kind === "text" && t.layerStyle?.subtitle && isFree(t, cue.startTicks, cue.durationTicks));
    if (shared) c = insertPlacement(c, shared.id, cue);
    else c = placeOnFreeTrack(c, cue, () => false, { name: "Subtitles", layerStyle: SUBTITLE_STYLE });
    res.captions += 1;
  }
  for (const e of shot.effects ?? []) {
    const preset = presetId("videoEffect", e.preset);
    if (!preset) continue;
    const r = rangeIn(clip.durationTicks, e.startSec, e.endSec);
    const params = e.params && Object.keys(e.params).length ? { ...e.params } : undefined;
    const pl: Placement = { id: newId("plc"), startTicks: clip.startTicks + r.offset, durationTicks: r.duration, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "effect", effect: { preset, ...(params ? { params } : {}) }, storyLink: { anchor } };
    c = placeOnFreeTrack(c, pl, effects());
    res.effects += 1;
  }
  return c;
}

/**
 * Audio cues (V2-SB-125) whose `from` shot was sent now. A cue starts `atSec` into that shot's clip and ends at the end
 * of the `to` shot's clip, after `durationSec`, or with the audio, whichever comes first (never looped). A cue that fits
 * inside its first shot is linked to it (it follows the shot); a cue across shots stays where it was placed.
 */
function addAudio(p: Project, b: Storyboard, comp: Composition, sent: { shot: Shot; clip: Placement }[], res: SendResult): Composition {
  let c = comp;
  const clips = new Map(sent.map((x) => [x.shot.id, x.clip]));
  for (const cue of b.audio ?? []) {
    const first = clips.get(cue.from);
    if (!first) continue;
    const slot = b.slots[cue.asset];
    const a = slot?.assetId ? p.assets[slot.assetId] : undefined;
    const v = a && selectedVersion(a);
    if (!a || !v || a.kind !== "audio") { res.skippedAudio += 1; continue; }
    const start = first.startTicks + Math.max(0, secondsToTicks(cue.atSec ?? 0));
    const last = cue.to ? clips.get(cue.to) : undefined;
    const media = v.media.durationTicks;
    let end = last && last.startTicks >= first.startTicks ? last.startTicks + last.durationTicks : undefined;
    if (cue.durationSec !== undefined) end = Math.min(end ?? Infinity, start + secondsToTicks(cue.durationSec));
    if (end === undefined) end = media ? start + media : first.startTicks + first.durationTicks;
    if (media) end = Math.min(end, start + media);
    if (end <= start) { res.skippedAudio += 1; continue; }
    const dur = end - start, d = AUDIO_DEFAULTS[cue.kind];
    const fade = (sec: number) => Math.min(dur, Math.max(0, secondsToTicks(sec)));
    const fadeIn = fade(cue.fadeInSec ?? d.fadeInSec), fadeOut = fade(cue.fadeOutSec ?? d.fadeOutSec);
    const inside = end <= first.startTicks + first.durationTicks;
    const pl: Placement = {
      id: newId("plc"), startTicks: start, durationTicks: dur, sourceInTicks: 0, source: { kind: "assetVersion", assetId: a.id, versionId: v.id },
      clipType: "audio", volume: cue.volume ?? d.volume, ...(fadeIn ? { fadeInTicks: fadeIn } : {}), ...(fadeOut ? { fadeOutTicks: fadeOut } : {}),
      ...(inside ? { storyLink: { anchor: first.id } } : {}),
    };
    const name = AUDIO_TRACK_NAMES[cue.kind];
    c = placeOnFreeTrack(c, pl, (t) => t.kind === "audio" && t.name === name, { name });
    res.audio += 1;
  }
  return c;
}

/** Append every ready shot to the root composition with its linked items. Returns the project unchanged if none is ready. */
export function sendStory(p: Project): { project: Project; result: SendResult } {
  const result: SendResult = { shots: 0, layers: 0, captions: 0, effects: 0, transitions: 0, skippedLayers: 0, audio: 0, skippedAudio: 0 };
  const b = p.storyboard;
  const ready = sendPlan(p).filter((s) => s.state === "ready");
  if (!b || !ready.length) return { project: p, result };
  let comp = p.compositions[p.rootCompositionId];
  let tid = mainTrack(comp)?.id;
  if (!tid) { tid = newId("trk"); comp = addTrack(comp, "video", tid); }
  let at = Math.max(0, ...comp.tracks.find((t) => t.id === tid)!.placements.map((x) => x.startTicks + x.durationTicks));
  const sent: { shot: Shot; clip: Placement }[] = [];
  for (const s of ready) {
    const shot = b.shots[s.shotId], asset = p.assets[s.assetId!], v = selectedVersion(asset);
    if (!v) continue;
    const clip = shotClip(b, asset, v, shot, at);
    comp = insertPlacement(comp, tid, clip);
    sent.push({ shot, clip });
    at += clip.durationTicks;
  }
  result.shots = sent.length;
  result.firstClipId = sent[0]?.clip.id;
  // Transitions: on the `to` clip, only when the `from` shot's clip ends exactly where it starts. Clamped to half the shorter clip.
  for (const conn of b.connections) {
    const kind = conn.transition && presetId("transition", conn.transition.preset);
    const to = kind ? sent.find((x) => x.shot.id === conn.to) : undefined;
    const fi = b.order.indexOf(conn.from);
    if (!kind || !to || fi < 0 || b.order[fi + 1] !== conn.to) continue;
    const main = comp.tracks.find((t) => t.id === tid)!;
    const prev = previousAdjacent(main, to.clip);
    const fromAsset = b.shots[conn.from]?.assetId;
    if (!prev || !fromAsset || prev.source.assetId !== fromAsset) continue;
    const sec = conn.transition!.params?.durationSec;
    const want = secondsToTicks(typeof sec === "number" && sec > 0 ? sec : DEFAULT_TRANSITION_SEC);
    const durationTicks = Math.max(1, Math.min(want, Math.floor(Math.min(prev.durationTicks, to.clip.durationTicks) / 2)));
    // V2-SB-130: the transition's own params (everything but durationSec) ride on the clip, editable in the inspector.
    const { durationSec: _d, ...own } = conn.transition!.params ?? {};
    comp = setTransition(comp, to.clip.id, { kind, durationTicks, ...(Object.keys(own).length ? { params: own } : {}) });
    result.transitions += 1;
  }
  for (const { shot, clip } of sent) comp = addLinked(p, b, comp, shot, clip, result);
  comp = addAudio(p, b, comp, sent, result);
  return { project: { ...p, compositions: { ...p.compositions, [p.rootCompositionId]: comp } }, result };
}
