/**
 * "Send to timeline" for storyboard format v1.1 (V2-SB-113, spec docs/v2/STORYBOARD_FORMAT.md §5 mapping).
 * Ready shots are appended to the main track in story order, each from its selected version:
 * - ai shots use their clip; html and still shots use their clip slot's asset for the planned shot length;
 * - text layers become text clips, html/image/video layers become overlay clips filling their box;
 * - html shot and layer `params` (V2-HTML-PARAMS) become the clip's per-use param values (`htmlParams`);
 * - `captions: true` writes the dialogue into the shared subtitle layer for the shot's range;
 * - shot effects become effect-layer clips over the shot (or their sub-range);
 * - a connection `transition` becomes `transitionIn` on the `to` clip when the two clips are adjacent;
 * - audio cues (V2-SB-125) go on Voiceover, Music, Sound effects, Ambience, Stings and Dialogue layers with their
 *   volume and fades; music with `loop` and ambience repeat to fill their span (V2-SB-135).
 * Every layer, caption and effect clip is linked to the shot clip (see storyLinks). Unknown preset ids fall back:
 * transition → cut, textStyle → plain, text animations and effects → none.
 */
import { CHROMA_DEFAULT, DEFAULT_IMAGE_TICKS, newId, TEXT_SOURCE, type Asset, type AssetVersion, type Composition, type Placement, type Project, type Track, type Transform } from "./model";
import { addTrack, groupOf, insertPlacement, isFree, mainTrack } from "./ops";
import { SUBTITLE_STYLE } from "./layerStyle";
import { getPreset, parsePresetRef, type PresetKind } from "../registry";
import { AUDIO_DEFAULTS, audioLoops, DEFAULT_TEXT_SIZE, DEFAULT_TRANSITION_SEC, type AudioKind, type StoryAudio, TEXT_LINE_HEIGHT, type StoryBox, type StoryLayer, type StoryMediaLayer, type StoryTextLayer, type StoryTextStyle } from "./storyJson";
import { pinOf, sendPlan, syncPlacements, versionSpan, type Shot, type Storyboard } from "./storyboard";
import { clampToClip, placeOnFreeTrack } from "./storyLinks";
import { textOf, textStyleData, textStyleFields, type TextData } from "./text";
import { previousAdjacent, setTransition } from "./transitions";
import { secondsToTicks, TICKS_PER_SECOND } from "./time";
import { followKeyframes, type MotionEffect } from "./storyFollow";

/** What one send added, for the confirmation note. */
export interface SendResult { shots: number; layers: number; captions: number; effects: number; transitions: number; skippedLayers: number; audio: number; skippedAudio: number; firstClipId?: string }

/** Audio layer names per cue kind (V2-SB-125): one kind per layer, so voice, music and effects mix separately. */
export const AUDIO_TRACK_NAMES: Record<AudioKind, string> = { voiceover: "Voiceover", music: "Music", sfx: "Sound effects", ambience: "Ambience", sting: "Stings", dialogue: "Dialogue" };

/** The caption text of a shot: its dialogue lines' words (no speaker names or "(O.S.)" marks, V2-SB-135), else its text. */
export const captionText = (shot: Shot): string => (shot.lines?.length ? shot.lines.map((l) => l.text).join("\n") : shot.dialogue ?? "").trim();

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
  if (animIn) { if (animIn !== d.animIn) delete d.animInParams; d.animIn = animIn; }
  if (l.anim?.inParams && d.animIn) d.animInParams = { ...d.animInParams, ...l.anim.inParams };
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
    transform: { ...boxTransform(l.box, mw, mh, p.settings.width, p.settings.height) } as Transform, storyLink: { anchor }, storyLayer: l.id, ...(l.link === false ? {} : { link: { parent: anchor } }),
    ...(a.kind === "html" && l.params && Object.keys(l.params).length ? { htmlParams: { ...l.params } } : {}),
    ...(l.chromaKey ? { chromaKey: { ...CHROMA_DEFAULT, ...l.chromaKey } } : {}),
  };
}

/**
 * P3B-11: a cue's volume curve (keys in cue seconds → clip-offset ticks; a looped copy `offset` ticks into the cue
 * keeps the curve's timing) and its audio effect (unknown preset ids are left out; the id stays in the storyboard).
 */
function cueSound(cue: StoryAudio, offset: number): Pick<Placement, "keyframes" | "audioFx"> {
  const out: Pick<Placement, "keyframes" | "audioFx"> = {};
  if (cue.volumeKeys?.length) out.keyframes = { volume: cue.volumeKeys.map((k) => ({ t: secondsToTicks(k.t) - offset, v: k.v })) };
  const preset = cue.fx && presetId("audioFx", cue.fx.preset);
  if (preset) out.audioFx = { preset, amount: cue.fx!.amount ?? 1 };
  return out;
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
  // P6-FX-SCOPE: only main-track effects move the shot under its layers ("all" moves the layers too; "overlay" only them).
  const motion: MotionEffect[] = (shot.effects ?? []).filter((e) => (e.applyTo ?? "main") === "main").flatMap((e) => {
    const preset = presetId("videoEffect", e.preset);
    return preset ? [{ preset, params: e.params, ...rangeIn(clip.durationTicks, e.startSec, e.endSec) }] : [];
  });
  const follow = (l: StoryLayer, r: { offset: number; duration: number }, t: Partial<Transform> | undefined) =>
    l.follow === "shot" ? followKeyframes(motion, r.offset, r.duration, { x: t?.x ?? 0, y: t?.y ?? 0, scale: t?.scale ?? 1 }, FOLLOW_STEP_TICKS) : undefined;
  for (const l of (shot.layers ?? [] as StoryLayer[]).filter((x) => !x.removedFromTimeline)) {
    const r = rangeIn(clip.durationTicks, l.startSec, l.endSec);
    const start = clip.startTicks + r.offset;
    if (l.type === "text") {
      const t0 = textLayerTransform(l);
      const t = l.opacity !== undefined ? { ...t0, opacity: l.opacity } : t0;
      const keyframes = follow(l, r, t);
      const pl: Placement = { id: newId("plc"), startTicks: start, durationTicks: r.duration, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: textLayerData(b, l), ...(t ? { transform: t as Transform } : {}), ...(keyframes ? { keyframes } : {}), ...blendOf(l), storyLink: { anchor }, storyLayer: l.id, ...(l.link === false ? {} : { link: { parent: anchor } }) };
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
  if (shot.captions && captionText(shot)) {
    const cue: Placement = { id: newId("plc"), startTicks: clip.startTicks, durationTicks: clip.durationTicks, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: { text: captionText(shot) } as TextData, storyLink: { anchor }, storyLayer: "captions", link: { parent: anchor } };
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
    const pl: Placement = { id: newId("plc"), startTicks: clip.startTicks + r.offset, durationTicks: r.duration, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "effect", effect: { preset, ...(params ? { params } : {}), ...(e.applyTo && e.applyTo !== "main" ? { applyTo: e.applyTo } : {}) }, storyLink: { anchor }, link: { parent: anchor } };
    c = placeOnFreeTrack(c, pl, effects());
    res.effects += 1;
  }
  return c;
}

/**
 * Audio cues (V2-SB-125) whose `from` shot was sent now. A cue starts `atSec` into that shot's clip and ends at the end
 * of the `to` shot's clip, after `durationSec`, or with the audio, whichever comes first. A looping cue (music with
 * `loop`, ambience unless `loop: false`, V2-SB-135) instead repeats the audio back to back until its end (the end of
 * `from` when it has no `to` or `durationSec`): fade in on the first copy, fade out on the last, which is trimmed.
 * A cue that fits inside its first shot is linked to it (it follows the shot); a cue across shots stays where it was placed.
 */
function addAudio(p: Project, b: Storyboard, comp: Composition, sent: { shot: Shot; clip: Placement }[], res: SendResult): Composition {
  let c = comp;
  // P1-AUDIO: cues are placed once each, against the shot clips sent now or by an earlier send, so audio uploaded
  // after its shots were sent still lands on the timeline.
  const clips = shotClips(c);
  for (const x of sent) clips.set(x.shot.id, x.clip);
  const done = placedCues(p, b, c);
  for (const cue of b.audio ?? []) {
    if (cue.removedFromTimeline) continue;
    const first = clips.get(cue.from);
    if (!first || done.has(cue.id)) continue;
    const slot = b.slots[cue.asset];
    const a = slot?.assetId ? p.assets[slot.assetId] : undefined;
    const v = a && selectedVersion(a);
    if (!a || !v || a.kind !== "audio") { res.skippedAudio += 1; continue; }
    const start = first.startTicks + Math.max(0, secondsToTicks(cue.atSec ?? 0));
    const last = cue.to ? clips.get(cue.to) : undefined;
    // P2C (item 4): an audio version trimmed in the storyboard plays its trimmed part.
    const span = versionSpan(b, v);
    const media = span?.lenTicks ?? v.media.durationTicks;
    let end = last && last.startTicks >= first.startTicks ? last.startTicks + last.durationTicks : undefined;
    if (cue.durationSec !== undefined) end = Math.min(end ?? Infinity, start + secondsToTicks(cue.durationSec));
    const loops = audioLoops(cue) && !!media;
    if (end === undefined) end = media && !loops ? start + media : first.startTicks + first.durationTicks;
    if (media && !loops) end = Math.min(end, start + media);
    if (end <= start) { res.skippedAudio += 1; continue; }
    const d = AUDIO_DEFAULTS[cue.kind];
    const inside = end <= first.startTicks + first.durationTicks;
    const name = AUDIO_TRACK_NAMES[cue.kind];
    // One placement, or back-to-back copies of the media for a looping cue.
    const pieces: { at: number; dur: number }[] = [];
    for (let at = start; at < end; at += loops ? media : end) pieces.push({ at, dur: Math.min(end, loops ? at + media : end) - at });
    let track: string | undefined;
    pieces.forEach((x, i) => {
      const fade = (sec: number) => Math.min(x.dur, Math.max(0, secondsToTicks(sec)));
      const fadeIn = i === 0 ? fade(cue.fadeInSec ?? d.fadeInSec) : 0, fadeOut = i === pieces.length - 1 ? fade(cue.fadeOutSec ?? d.fadeOutSec) : 0;
      const pl: Placement = {
        id: newId("plc"), startTicks: x.at, durationTicks: x.dur, sourceInTicks: span?.inTicks ?? 0, source: { kind: "assetVersion", assetId: a.id, versionId: v.id },
        clipType: "audio", volume: cue.volume ?? d.volume, ...(fadeIn ? { fadeInTicks: fadeIn } : {}), ...(fadeOut ? { fadeOutTicks: fadeOut } : {}),
        storyCue: cue.id, ...(inside ? { storyLink: { anchor: first.id }, ...(cue.link === false ? {} : { link: { parent: first.id } }) } : {}),
        ...cueSound(cue, x.at - start),
      };
      // Keep the copies of a loop on one layer.
      const same = track && c.tracks.find((t) => t.id === track && isFree(t, pl.startTicks, pl.durationTicks));
      if (same) c = insertPlacement(c, same.id, pl);
      else { c = placeOnFreeTrack(c, pl, (t) => t.kind === "audio" && t.name === name, { name }); track = c.tracks.find((t) => t.placements.some((q) => q.id === pl.id))?.id; }
    });
    res.audio += 1;
  }
  return c;
}

/** Story shot clips on the root composition by shot id (the first one in time when a shot was sent twice). */
function shotClips(comp: Composition): Map<string, Placement> {
  const m = new Map<string, Placement>();
  for (const pl of comp.tracks.flatMap((t) => t.placements).sort((a, b) => a.startTicks - b.startTicks)) if (pl.storyShot && !m.has(pl.storyShot)) m.set(pl.storyShot, pl);
  return m;
}

/**
 * Cue ids already on the timeline: a clip names its cue (`storyCue`), or, for cues sent before P1-AUDIO, an unnamed
 * audio clip of the cue's asset exists.
 */
function placedCues(p: Project, b: Storyboard, comp: Composition): Set<string> {
  const all = comp.tracks.flatMap((t) => t.placements);
  const named = new Set(all.flatMap((pl) => (pl.storyCue ? [pl.storyCue] : [])));
  const loose = new Set(all.filter((pl) => pl.clipType === "audio" && !pl.storyCue).map((pl) => pl.source.assetId));
  return new Set((b.audio ?? []).filter((cue) => named.has(cue.id) || (!!b.slots[cue.asset]?.assetId && loose.has(b.slots[cue.asset]!.assetId!) && !!p.assets[b.slots[cue.asset]!.assetId!])).map((cue) => cue.id));
}

/** Audio cues that "Send to timeline" would place now: their asset is uploaded, their first shot is on the timeline or ready, and they are not placed yet. */
export function pendingAudio(p: Project): string[] {
  const b = p.storyboard;
  if (!b?.audio?.length) return [];
  const comp = p.compositions[p.rootCompositionId];
  const shots = new Set([...shotClips(comp).keys(), ...sendPlan(p).filter((s) => s.state === "ready").map((s) => s.shotId)]);
  const done = placedCues(p, b, comp);
  return b.audio.filter((cue) => {
    const id = b.slots[cue.asset]?.assetId, a = id ? p.assets[id] : undefined;
    return !cue.removedFromTimeline && !done.has(cue.id) && shots.has(cue.from) && a?.kind === "audio" && a.versions.length > 0;
  }).map((cue) => cue.id);
}

/** Append every ready shot to the root composition with its linked items. Returns the project unchanged if none is ready. */
export function sendStory(p: Project): { project: Project; result: SendResult } {
  const result: SendResult = { shots: 0, layers: 0, captions: 0, effects: 0, transitions: 0, skippedLayers: 0, audio: 0, skippedAudio: 0 };
  const b = p.storyboard;
  const ready = sendPlan(p).filter((s) => s.state === "ready");
  if (!b || (!ready.length && !pendingAudio(p).length)) return { project: p, result };
  let comp = p.compositions[p.rootCompositionId];
  let tid = mainTrack(comp)?.id;
  if (!tid && ready.length) { tid = newId("trk"); comp = addTrack(comp, "video", tid); }
  let at = Math.max(0, ...(comp.tracks.find((t) => t.id === tid)?.placements ?? []).map((x) => x.startTicks + x.durationTicks));
  const sent: { shot: Shot; clip: Placement }[] = [];
  for (const s of ready) {
    const shot = b.shots[s.shotId], asset = p.assets[s.assetId!], v = selectedVersion(asset);
    if (!v) continue;
    const clip = shotClip(b, asset, v, shot, at);
    comp = insertPlacement(comp, tid!, clip);
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
  return { project: recordSent({ ...p, compositions: { ...p.compositions, [p.rootCompositionId]: comp } }), result };
}

/** P2A: what a shot sends besides its clip (layers, captions, effects, html params), for change detection. */
export const shotSignature = (s: Shot): string => JSON.stringify([s.layers ?? [], s.captions ? captionText(s) : "", s.effects ?? [], s.render === "html" ? s.params ?? {} : {}]);
const cueSignature = (cue: NonNullable<Storyboard["audio"]>[number]): string => JSON.stringify(cue);

/** Record signatures for shots and cues on the timeline; `force` ids are overwritten, others only filled in. */
export function recordSent(p: Project, force: Set<string> = new Set()): Project {
  const b = p.storyboard;
  if (!b) return p;
  const comp = p.compositions[p.rootCompositionId];
  const shots = { ...b.sent?.shots }, cues = { ...b.sent?.cues };
  for (const id of shotClips(comp).keys()) if (b.shots[id] && (force.has(id) || !(id in shots))) shots[id] = shotSignature(b.shots[id]);
  const placed = new Set(comp.tracks.flatMap((t) => t.placements.flatMap((pl) => (pl.storyCue ? [pl.storyCue] : []))));
  for (const cue of b.audio ?? []) if (placed.has(cue.id) && (force.has(`cue:${cue.id}`) || !(cue.id in cues))) cues[cue.id] = cueSignature(cue);
  return { ...p, storyboard: { ...b, sent: { shots, cues } } };
}

const dropPlacements = (c: Composition, drop: (pl: Placement) => boolean): Composition => ({ ...c, tracks: c.tracks.map((t) => (t.placements.some(drop) ? { ...t, placements: t.placements.filter((pl) => !drop(pl)) } : t)) });

/** "Send to timeline" in Update mode adds; this also counts what was refreshed in place. */
export interface UpdateResult extends SendResult { clips: number; refreshed: number; cues: number }

/** Shots sent before, audio cues edited since, and clips whose shot now uses another asset: what Update would redo. */
export function updatePlan(p: Project): { clips: string[]; refreshed: string[]; cues: string[] } {
  const b = p.storyboard, out = { clips: [] as string[], refreshed: [] as string[], cues: [] as string[] };
  if (!b) return out;
  const comp = p.compositions[p.rootCompositionId];
  for (const [id, clip] of shotClips(comp)) {
    const s = b.shots[id];
    if (!s || s.skipped) continue;
    const a = s.assetId ? p.assets[s.assetId] : undefined;
    if (a && selectedVersion(a) && clip.source.assetId !== a.id) out.clips.push(id);
    const sig = b.sent?.shots[id];
    if (sig !== undefined && sig !== shotSignature(s)) out.refreshed.push(id);
  }
  const placed = new Set(comp.tracks.flatMap((t) => t.placements.flatMap((pl) => (pl.storyCue ? [pl.storyCue] : []))));
  for (const cue of b.audio ?? []) { const sig = b.sent?.cues[cue.id]; if (placed.has(cue.id) && sig !== undefined && sig !== cueSignature(cue)) out.cues.push(cue.id); }
  return out;
}

/**
 * P2A "Update timeline": apply only what changed since the last send. Clips whose shot now uses another asset (made as
 * html or still instead, or re-imported) switch to it in place; shots whose layers, captions, effects or html params
 * were edited get their linked items rebuilt; edited audio cues are placed again; then new shots and new audio are
 * appended as before. Replaced clip versions already follow the board (syncPlacements); this re-syncs any that lag.
 */
export function updateStory(p: Project): { project: Project; result: UpdateResult } {
  const b = p.storyboard;
  const plan = updatePlan(p);
  const base: UpdateResult = { shots: 0, layers: 0, captions: 0, effects: 0, transitions: 0, skippedLayers: 0, audio: 0, skippedAudio: 0, clips: 0, refreshed: 0, cues: 0 };
  if (!b) return { project: p, result: base };
  let q = p;
  // Re-sync story clips to their selected versions (a version may have been picked while the clip was elsewhere).
  for (const id of new Set(Object.values(b.shots).map((s) => s.assetId).filter((x): x is string => !!x && !!p.assets[x]))) q = syncPlacements(q, id);
  let comp = q.compositions[q.rootCompositionId];
  const clips = shotClips(comp);
  for (const id of plan.clips) {
    const s = b.shots[id], a = q.assets[s.assetId!], v = selectedVersion(a)!, old = clips.get(id)!;
    const { htmlParams: _h, ...rest } = old;
    const next: Placement = { ...rest, source: { kind: "assetVersion", assetId: a.id, versionId: v.id }, clipType: a.kind, sourceInTicks: 0, ...(a.kind === "html" && s.params && Object.keys(s.params).length ? { htmlParams: { ...s.params } } : {}) };
    comp = { ...comp, tracks: comp.tracks.map((t) => (t.placements.some((x) => x.id === old.id) ? { ...t, placements: t.placements.map((x) => (x.id === old.id ? next : x)) } : t)) };
    base.clips += 1;
  }
  const res: SendResult = { ...base };
  for (const id of plan.refreshed) {
    const s = b.shots[id], clip = shotClips(comp).get(id)!;
    comp = dropPlacements(comp, (pl) => pl.storyLink?.anchor === clip.id && !pl.storyCue);
    if (s.render === "html") {
      const { htmlParams: _h, ...rest } = clip;
      const next: Placement = { ...rest, ...(s.params && Object.keys(s.params).length ? { htmlParams: { ...s.params } } : {}) };
      comp = { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.map((x) => (x.id === clip.id ? next : x)) })) };
    }
    comp = addLinked(q, b, comp, s, clip, res);
  }
  base.refreshed = plan.refreshed.length;
  const cueIds = new Set(plan.cues);
  comp = dropPlacements(comp, (pl) => !!pl.storyCue && cueIds.has(pl.storyCue));
  q = { ...q, compositions: { ...q.compositions, [q.rootCompositionId]: comp } };
  const sent = sendStory(q);
  const r = sent.result;
  const result: UpdateResult = { ...r, layers: r.layers + res.layers, captions: r.captions + res.captions, effects: r.effects + res.effects, skippedLayers: r.skippedLayers + res.skippedLayers, clips: base.clips, refreshed: base.refreshed, cues: plan.cues.length, audio: r.audio };
  const force = new Set([...plan.refreshed, ...plan.cues.map((c) => `cue:${c}`)]);
  return { project: recordSent(sent.project, force), result };
}

/** P2A "Replace timeline": clear the root timeline and send the whole board again (the caller confirms; Undo restores). */
export function replaceStory(p: Project): { project: Project; result: SendResult } {
  const b = p.storyboard;
  if (!b) return { project: p, result: { shots: 0, layers: 0, captions: 0, effects: 0, transitions: 0, skippedLayers: 0, audio: 0, skippedAudio: 0 } };
  const comp = p.compositions[p.rootCompositionId];
  const cleared: Project = { ...p, storyboard: { ...b, sent: undefined }, compositions: { ...p.compositions, [p.rootCompositionId]: { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: [] })) } } };
  const sent = sendStory(cleared);
  return { project: recordSent(sent.project), result: sent.result };
}
