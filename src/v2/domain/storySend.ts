/**
 * "Send to timeline" for storyboard format v1.1 (V2-SB-113, spec docs/v2/STORYBOARD_FORMAT.md §5 mapping).
 * Ready shots are appended to the main track in story order, each from its selected version:
 * - ai shots use their clip; html and still shots use their clip slot's asset for the planned shot length;
 * - text layers become text clips, html/image/video layers become overlay clips filling their box;
 * - `captions: true` writes the dialogue into the shared subtitle layer for the shot's range;
 * - shot effects become effect-layer clips over the shot (or their sub-range);
 * - a connection `transition` becomes `transitionIn` on the `to` clip when the two clips are adjacent.
 * Every layer, caption and effect clip is linked to the shot clip (see storyLinks). Unknown preset ids fall back:
 * transition → cut, textStyle → plain, text animations and effects → none.
 */
import { DEFAULT_IMAGE_TICKS, newId, TEXT_SOURCE, type Asset, type AssetVersion, type Composition, type Placement, type Project, type Track, type Transform } from "./model";
import { addTrack, groupOf, insertPlacement, isFree, mainTrack } from "./ops";
import { SUBTITLE_STYLE } from "./layerStyle";
import { getPreset, parsePresetRef, type PresetKind } from "../registry";
import { DEFAULT_TEXT_SIZE, DEFAULT_TRANSITION_SEC, TEXT_LINE_HEIGHT, type StoryBox, type StoryLayer, type StoryMediaLayer, type StoryTextLayer, type StoryTextStyle } from "./storyJson";
import { sendPlan, type Shot, type Storyboard } from "./storyboard";
import { clampToClip, placeOnFreeTrack } from "./storyLinks";
import { textOf, textStyleData, textStyleFields, type TextData } from "./text";
import { previousAdjacent, setTransition } from "./transitions";
import { secondsToTicks } from "./time";

/** What one send added, for the confirmation note. */
export interface SendResult { shots: number; layers: number; captions: number; effects: number; transitions: number; skippedLayers: number; firstClipId?: string }

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
function shotClip(asset: Asset, v: AssetVersion, shot: Shot, at: number): Placement {
  const planned = shot.durationSec > 0 ? secondsToTicks(shot.durationSec) : DEFAULT_IMAGE_TICKS;
  const durationTicks = shot.clipSlot || asset.kind === "html" ? planned : asset.kind === "image" ? DEFAULT_IMAGE_TICKS : v.media.durationTicks ?? DEFAULT_IMAGE_TICKS;
  return { id: newId("plc"), startTicks: at, durationTicks, sourceInTicks: 0, source: { kind: "assetVersion", assetId: asset.id, versionId: v.id }, clipType: asset.kind, volume: 1 };
}

function mediaLayer(p: Project, b: Storyboard, l: StoryMediaLayer, start: number, dur: number, anchor: string): Placement | undefined {
  const slot = b.slots[l.asset];
  const a = slot?.assetId ? p.assets[slot.assetId] : undefined;
  const v = a && selectedVersion(a);
  if (!a || !v || (a.kind !== "image" && a.kind !== "video" && a.kind !== "html")) return undefined;
  const mw = v.media.width ?? p.settings.width, mh = v.media.height ?? p.settings.height;
  const max = a.kind === "video" ? v.media.durationTicks : undefined;
  return {
    id: newId("plc"), startTicks: start, durationTicks: max ? Math.min(dur, max) : dur, sourceInTicks: 0,
    source: { kind: "assetVersion", assetId: a.id, versionId: v.id }, clipType: a.kind, volume: 1,
    transform: { ...boxTransform(l.box, mw, mh, p.settings.width, p.settings.height) } as Transform, storyLink: { anchor },
  };
}

/** Linked layers, captions and effects for one shot clip. */
function addLinked(p: Project, b: Storyboard, comp: Composition, shot: Shot, clip: Placement, res: SendResult): Composition {
  let c = comp;
  const anchor = clip.id;
  for (const l of shot.layers ?? [] as StoryLayer[]) {
    const r = rangeIn(clip.durationTicks, l.startSec, l.endSec);
    const start = clip.startTicks + r.offset;
    if (l.type === "text") {
      const t = textLayerTransform(l);
      const pl: Placement = { id: newId("plc"), startTicks: start, durationTicks: r.duration, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: textLayerData(b, l), ...(t ? { transform: t as Transform } : {}), storyLink: { anchor } };
      c = placeOnFreeTrack(c, pl, plainText());
      res.layers += 1;
    } else {
      const pl = mediaLayer(p, b, l, start, r.duration, anchor);
      if (!pl) { res.skippedLayers += 1; continue; }
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

/** Append every ready shot to the root composition with its linked items. Returns the project unchanged if none is ready. */
export function sendStory(p: Project): { project: Project; result: SendResult } {
  const result: SendResult = { shots: 0, layers: 0, captions: 0, effects: 0, transitions: 0, skippedLayers: 0 };
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
    const clip = shotClip(asset, v, shot, at);
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
    if (!kind || !to) continue;
    const main = comp.tracks.find((t) => t.id === tid)!;
    const prev = previousAdjacent(main, to.clip);
    const fromAsset = b.shots[conn.from]?.assetId;
    if (!prev || !fromAsset || prev.source.assetId !== fromAsset) continue;
    const sec = conn.transition!.params?.durationSec;
    const want = secondsToTicks(typeof sec === "number" && sec > 0 ? sec : DEFAULT_TRANSITION_SEC);
    const durationTicks = Math.max(1, Math.min(want, Math.floor(Math.min(prev.durationTicks, to.clip.durationTicks) / 2)));
    comp = setTransition(comp, to.clip.id, { kind, durationTicks });
    result.transitions += 1;
  }
  for (const { shot, clip } of sent) comp = addLinked(p, b, comp, shot, clip, result);
  return { project: { ...p, compositions: { ...p.compositions, [p.rootCompositionId]: comp } }, result };
}
