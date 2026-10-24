/** Pure placement operations. All return new Composition objects (no mutation). */
import { clampTransform, type KeyframeProp, MAX_SPEED, MIN_SPEED, sourceAt, isStill, findPlacement, newId, trackKindFor, transformOf, type Transform, type Composition, type Placement, type Track } from "./model";

export const MIN_DURATION_TICKS = 1200; // 10 ms

function sortPlacements(ps: Placement[]): Placement[] {
  return [...ps].sort((a, b) => a.startTicks - b.startTicks);
}
function mapTrack(comp: Composition, trackId: string, fn: (t: Track) => Track): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

/** True when [start,start+dur) is free on the track (ignoring `ignoreId`). */
export function isFree(track: Track, start: number, dur: number, ignoreId?: string): boolean {
  return track.placements.every((p) => p.id === ignoreId || start + dur <= p.startTicks || start >= p.startTicks + p.durationTicks);
}

/** First free start >= desired on the track that fits `dur`. */
export function firstFreeStart(track: Track, desired: number, dur: number, ignoreId?: string): number {
  let start = Math.max(0, desired);
  for (const p of sortPlacements(track.placements)) {
    if (p.id === ignoreId) continue;
    if (start + dur <= p.startTicks) break;
    if (start < p.startTicks + p.durationTicks) start = p.startTicks + p.durationTicks;
  }
  return start;
}

export function addTrack(comp: Composition, kind: Track["kind"], id = newId("trk"), group?: "overlay" | "text"): Composition {
  const n = comp.tracks.filter((t) => t.kind === kind).length + 1;
  const name = kind === "video" && group === "text" ? `Sticker ${comp.tracks.filter((t) => t.group === "text").length + 1}` : `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
  const track: Track = { id, kind, name, placements: [], ...(kind === "video" && group === "text" ? { group } : {}) };
  // New tracks go on top of their group (audio at the bottom); groups keep their stacking order.
  const tracks = kind === "audio" ? [...comp.tracks, track] : [track, ...comp.tracks];
  return { ...comp, tracks: orderByGroup(tracks) };
}

export type TrackGroup = "main" | "overlay" | "text" | "audio" | "effect";
export const GROUP_LABEL: Record<TrackGroup, string> = { main: "Main", overlay: "Overlay", text: "Text & Stickers", audio: "Audio", effect: "Effects" };
/** Effect layers sit just above main: they only modify the main-track render (overlays/text draw on top). */
const RANK: Record<TrackGroup, number> = { text: 0, overlay: 1, effect: 2, main: 3, audio: 4 };
const lastVideo = (tracks: Track[]) => { for (let i = tracks.length - 1; i >= 0; i--) if (tracks[i].kind === "video" && tracks[i].group !== "text") return tracks[i]; return undefined; };
/** Which timeline group a track belongs to. Text & Stickers sits above Overlay, which sits above Main. */
export function groupOf(comp: Pick<Composition, "tracks">, t: Track): TrackGroup {
  if (t.kind === "audio") return "audio";
  if (t.kind === "effect") return "effect";
  if (t.kind === "text" || t.group === "text") return "text";
  return lastVideo(comp.tracks)?.id === t.id ? "main" : "overlay";
}
/** Stable-sort tracks by group (array index 0 = top layer); order inside a group is preserved. */
export function orderByGroup(tracks: Track[]): Track[] {
  const c = { tracks };
  return tracks.map((t, i) => ({ t, i, r: RANK[groupOf(c, t)] })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.t);
}
export const tracksInGroup = (comp: Composition, g: TrackGroup) => comp.tracks.filter((t) => groupOf(comp, t) === g);


/**
 * Reorder a layer inside its group (V2-099 ≡ handle). `toIndex` is the target position among the group's
 * tracks in array order (0 = top layer). Never crosses group boundaries; main and audio-less no-ops return comp.
 */
export function reorderTrack(comp: Composition, trackId: string, toIndex: number): Composition {
  const t = comp.tracks.find((x) => x.id === trackId);
  if (!t) return comp;
  const g = groupOf(comp, t);
  if (g === "main") return comp;
  const members = tracksInGroup(comp, g);
  const from = members.indexOf(t);
  const to = Math.max(0, Math.min(members.length - 1, toIndex));
  if (from === to) return comp;
  const order = members.filter((x) => x !== t);
  order.splice(to, 0, t);
  let k = 0;
  const tracks = comp.tracks.map((x) => (groupOf(comp, x) === g ? order[k++] : x));
  return { ...comp, tracks };
}

export function removeTrack(comp: Composition, trackId: string): Composition {
  return { ...comp, tracks: comp.tracks.filter((t) => t.id !== trackId) };
}

export function insertPlacement(comp: Composition, trackId: string, placement: Placement): Composition {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown track ${trackId}`);
  if (trackKindFor(placement.clipType) !== track.kind) throw new Error(`Cannot place ${placement.clipType} on ${track.kind} track`);
  placement = { ...placement, startTicks: Math.max(0, Math.round(placement.startTicks)), durationTicks: Math.round(placement.durationTicks), sourceInTicks: Math.round(placement.sourceInTicks) };
  const start = firstFreeStart(track, placement.startTicks, placement.durationTicks);
  return mapTrack(comp, trackId, (t) => ({ ...t, placements: sortPlacements([...t.placements, { ...placement, startTicks: start }]) }));
}

/** Move a placement to a (possibly different) track and start. Rejects overlaps by pushing to the next free slot. */
export function movePlacement(comp: Composition, placementId: string, toTrackId: string, startTicks: number): Composition {
  startTicks = Math.max(0, Math.round(startTicks));
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const target = comp.tracks.find((t) => t.id === toTrackId);
  if (!target) throw new Error(`Unknown track ${toTrackId}`);
  if (trackKindFor(found.placement.clipType) !== target.kind) return comp;
  const start = firstFreeStart(target, startTicks, found.placement.durationTicks, placementId);
  const moved = { ...found.placement, startTicks: start };
  let next = mapTrack(comp, found.track.id, (t) => ({ ...t, placements: t.placements.filter((p) => p.id !== placementId) }));
  next = mapTrack(next, toTrackId, (t) => ({ ...t, placements: sortPlacements([...t.placements, moved]) }));
  return next;
}

/**
 * Trim an edge to a new timeline position. `maxSourceTicks` is the media length
 * (undefined for images = unlimited). Clamped by neighbours and source bounds.
 */
export function trimPlacement(comp: Composition, placementId: string, edge: "left" | "right", toTicks: number, maxSourceTicks?: number): Composition {
  toTicks = Math.round(toTicks);
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const p = found.placement;
  const others = found.track.placements.filter((o) => o.id !== p.id);
  const end = p.startTicks + p.durationTicks;
  let updated: Placement;
  // Freeze frames and images hold one frame: no source bounds, sourceIn preserved (images use 0).
  const unbounded = maxSourceTicks === undefined || !!p.freeze;
  const s = p.speed ?? 1, rev = !!p.reverse;
  const spanEnd = p.sourceInTicks + p.durationTicks * s; // source end of the used span
  if (edge === "left") {
    const prevEnd = Math.max(0, ...others.filter((o) => o.startTicks + o.durationTicks <= p.startTicks).map((o) => o.startTicks + o.durationTicks));
    const srcRoom = unbounded ? Infinity : rev ? (maxSourceTicks! - spanEnd) / s : p.sourceInTicks / s;
    const start = Math.min(Math.max(toTicks, prevEnd, Math.ceil(p.startTicks - srcRoom)), end - MIN_DURATION_TICKS);
    const delta = start - p.startTicks;
    const sourceInTicks = isStill(p) ? 0 : unbounded || rev ? p.sourceInTicks : Math.max(0, p.sourceInTicks + Math.round(delta * s));
    updated = { ...p, startTicks: start, durationTicks: end - start, sourceInTicks, ...(p.keyframes ? { keyframes: shiftKeys(p.keyframes, -delta) } : {}) };
  } else {
    const nextStart = Math.min(Infinity, ...others.filter((o) => o.startTicks >= end).map((o) => o.startTicks));
    const srcRoom = unbounded ? Infinity : rev ? p.sourceInTicks / s : (maxSourceTicks! - spanEnd) / s;
    const newEnd = Math.max(Math.min(toTicks, nextStart, Math.floor(end + srcRoom)), p.startTicks + MIN_DURATION_TICKS);
    const sourceInTicks = rev && !unbounded ? Math.max(0, p.sourceInTicks - Math.round((newEnd - end) * s)) : p.sourceInTicks;
    updated = { ...p, durationTicks: newEnd - p.startTicks, sourceInTicks };
  }
  return mapTrack(comp, found.track.id, (t) => ({ ...t, placements: t.placements.map((o) => (o.id === p.id ? updated : o)) }));
}

/** Split at absolute timeline time. Returns unchanged comp when `atTicks` is not strictly inside. */
export function splitPlacement(comp: Composition, placementId: string, atTicks: number, newIdValue = newId("plc")): Composition {
  atTicks = Math.round(atTicks);
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const p = found.placement;
  const offset = atTicks - p.startTicks;
  if (offset < MIN_DURATION_TICKS || p.durationTicks - offset < MIN_DURATION_TICKS) return comp;
  const left: Placement = { ...p, durationTicks: offset };
  const s = p.speed ?? 1;
  const hold = isStill(p) || p.freeze;
  const cut = Math.round(offset * s), cutRev = Math.round((p.durationTicks - offset) * s);
  // Reverse: the left part shows the END of the source span, so it gets the later sourceIn.
  // Fades stay on the outer edges; keyframes keep their absolute timing (offsets are clip-relative).
  if (p.fadeOutTicks) delete left.fadeOutTicks;
  if (p.reverse && !hold) left.sourceInTicks = p.sourceInTicks + cutRev;
  const right: Placement = { ...p, id: newIdValue, startTicks: atTicks, durationTicks: p.durationTicks - offset, sourceInTicks: isStill(p) ? 0 : hold || p.reverse ? p.sourceInTicks : p.sourceInTicks + cut };
  if (p.fadeInTicks) delete right.fadeInTicks;
  if (p.keyframes) right.keyframes = shiftKeys(p.keyframes, -offset);
  return mapTrack(comp, found.track.id, (t) => ({ ...t, placements: sortPlacements(t.placements.flatMap((o) => (o.id === p.id ? [left, right] : [o]))) }));
}

export function deletePlacement(comp: Composition, placementId: string): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.filter((p) => p.id !== placementId) })) };
}

/** Snap `ticks` to nearest candidate edge within `threshold`. */
export function snapTicks(comp: Composition, ticks: number, threshold: number, extra: number[] = [], ignoreId?: string): number {
  const candidates = [0, ...extra];
  for (const t of comp.tracks) for (const p of t.placements) if (p.id !== ignoreId) candidates.push(p.startTicks, p.startTicks + p.durationTicks);
  let best = ticks;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - ticks);
    if (d <= bestDist) { best = c; bestDist = d; }
  }
  return best;
}

/** Snap a moving block so either its start or end aligns with a candidate. */
export function snapMove(comp: Composition, start: number, dur: number, threshold: number, extra: number[] = [], ignoreId?: string): number {
  const s = snapTicks(comp, start, threshold, extra, ignoreId);
  if (s !== start) return s;
  const e = snapTicks(comp, start + dur, threshold, extra, ignoreId);
  return e !== start + dur ? e - dur : start;
}

/**
 * Copy a video placement's embedded audio onto an audio track as an independent placement, aligned in time.
 * mode "extract" also mutes the owned linked audio; "duplicate" keeps it playing. Uses the first audio track
 * that is free over the whole range, else adds a new audio track.
 */
export function extractAudio(comp: Composition, placementId: string, mode: "extract" | "duplicate", newIdValue = newId("plc"), newTrackId = newId("trk")): Composition {
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const v = found.placement;
  if (v.clipType !== "video") throw new Error("Only video clips have linked audio");
  let next = comp;
  let track = next.tracks.find((t) => t.kind === "audio" && firstFreeStart(t, v.startTicks, v.durationTicks) === v.startTicks);
  if (!track) { next = addTrack(next, "audio", newTrackId); track = next.tracks.find((t) => t.id === newTrackId)!; }
  const audio: Placement = { id: newIdValue, startTicks: v.startTicks, durationTicks: v.durationTicks, sourceInTicks: v.sourceInTicks, source: v.source, clipType: "audio", volume: v.volume ?? 1 };
  next = insertPlacement(next, track.id, audio);
  return mode === "extract" ? setLinkedAudioMuted(next, placementId, true) : next;
}

export function setLinkedAudioMuted(comp: Composition, placementId: string, muted: boolean): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => (p.id === placementId && p.clipType === "video" ? { ...p, linkedAudio: { ...p.linkedAudio, muted } } : p)) })) };
}

/** Merge a partial transform into a visual placement (clamped). Audio placements are unchanged. */
export function setTransform(comp: Composition, placementId: string, patch: Partial<Omit<Transform, "crop">> & { crop?: Partial<Transform["crop"]> } | null): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => {
    if (p.id !== placementId || p.clipType === "audio") return p;
    if (patch === null) { const { transform: _t, ...rest } = p; void _t; return rest; }
    const cur = transformOf(p);
    return { ...p, transform: clampTransform({ ...cur, ...patch, crop: { ...cur.crop, ...patch.crop } }) };
  }) })) };
}

function mapPlacement(comp: Composition, id: string, fn: (p: Placement, t: Track) => Placement): Composition {
  return { ...comp, tracks: comp.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => (p.id === id ? fn(p, t) : p)) })) };
}

/**
 * Change speed keeping the same source span: duration scales by old/new speed. If the longer clip would
 * overlap the next clip it is shortened to fit (the tail of the span is dropped).
 */
export function setSpeed(comp: Composition, placementId: string, speed: number): Composition {
  speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  return mapPlacement(comp, placementId, (p, t) => {
    if (isStill(p) || p.freeze) return p;
    const span = p.durationTicks * (p.speed ?? 1);
    const next = Math.min(Infinity, ...t.placements.filter((o) => o.id !== p.id && o.startTicks >= p.startTicks + p.durationTicks).map((o) => o.startTicks));
    const durationTicks = Math.max(MIN_DURATION_TICKS, Math.min(Math.round(span / speed), next - p.startTicks));
    const out: Placement = { ...p, durationTicks, speed };
    if (speed === 1) delete out.speed;
    return out;
  });
}

/** Blend mode of a visual clip (a `blend` preset id); undefined or "normal" clears it. */
export function setBlend(comp: Composition, placementId: string, blend: string | undefined): Composition {
  return mapPlacement(comp, placementId, (p) => {
    if (p.clipType === "audio" || p.clipType === "effect") return p;
    const out: Placement = { ...p, blend };
    if (!blend || blend === "normal") delete out.blend;
    return out;
  });
}

export function setReverse(comp: Composition, placementId: string, reverse: boolean): Composition {
  return mapPlacement(comp, placementId, (p) => {
    if (isStill(p) || p.freeze) return p;
    const out: Placement = { ...p, reverse };
    if (!reverse) delete out.reverse;
    return out;
  });
}

/**
 * CapCut-style freeze: split the video clip at `atTicks` and insert a held frame of `holdTicks` there,
 * pushing every later clip on that track right by `holdTicks`.
 */
export function freezeFrame(comp: Composition, placementId: string, atTicks: number, holdTicks: number, freezeId = newId("plc"), splitId = newId("plc")): Composition {
  atTicks = Math.round(atTicks);
  const found = findPlacement(comp, placementId);
  if (!found) throw new Error(`Unknown placement ${placementId}`);
  const p = found.placement;
  if (p.clipType !== "video" || atTicks < p.startTicks || atTicks >= p.startTicks + p.durationTicks) return comp;
  const frame = sourceAt(p, atTicks);
  let next = splitPlacement(comp, placementId, atTicks, splitId);
  next = mapTrack(next, found.track.id, (t) => ({ ...t, placements: t.placements.map((o) => (o.startTicks >= atTicks ? { ...o, startTicks: o.startTicks + holdTicks } : o)) }));
  const { speed: _s, reverse: _r, ...base } = p; void _s; void _r;
  const frozen: Placement = { ...base, id: freezeId, startTicks: atTicks, durationTicks: holdTicks, sourceInTicks: frame, freeze: true, linkedAudio: { muted: true } };
  return mapTrack(next, found.track.id, (t) => ({ ...t, placements: sortPlacements([...t.placements, frozen]) }));
}

function shiftKeys(k: NonNullable<Placement["keyframes"]>, by: number): Placement["keyframes"] {
  return Object.fromEntries(Object.entries(k).map(([prop, keys]) => [prop, keys!.map((x) => ({ ...x, t: x.t + by }))]));
}

/** Set fade lengths (ticks); each clamped to >= 0 and together to the clip duration. 0 removes. */
export function setFades(comp: Composition, placementId: string, fades: { in?: number; out?: number }): Composition {
  return mapPlacement(comp, placementId, (p) => {
    const fin = Math.round(Math.max(0, Math.min(fades.in ?? p.fadeInTicks ?? 0, p.durationTicks)));
    const fout = Math.round(Math.max(0, Math.min(fades.out ?? p.fadeOutTicks ?? 0, p.durationTicks - fin)));
    const out: Placement = { ...p, fadeInTicks: fin, fadeOutTicks: fout };
    if (!fin) delete out.fadeInTicks;
    if (!fout) delete out.fadeOutTicks;
    return out;
  });
}

/** Insert or replace the key of `prop` at clip offset `t` (visual clips only). `value` null removes it. */
export function setKeyframe(comp: Composition, placementId: string, prop: KeyframeProp, t: number, value: number | null): Composition {
  t = Math.round(t);
  return mapPlacement(comp, placementId, (p) => {
    if (p.clipType === "audio") return p;
    const keys = (p.keyframes?.[prop] ?? []).filter((k) => Math.abs(k.t - t) > 600); // within 5 ms = same key
    if (value !== null) keys.push({ t, v: value });
    keys.sort((a, b) => a.t - b.t);
    const keyframes = { ...p.keyframes, [prop]: keys };
    if (!keys.length) delete keyframes[prop];
    const out: Placement = { ...p, keyframes };
    if (!Object.keys(keyframes).length) delete out.keyframes;
    return out;
  });
}

/** CapCut-style main track: the bottom-most video track. Overlay video tracks sit above it. */
export function mainTrack(comp: Composition): Track | undefined {
  return lastVideo(comp.tracks);
}

/** CapCut long-press reorder: move main-track clip `id` to position `toIndex`, re-packing the track gaplessly
 * from its first clip's start. Durations are kept; returns the same comp when nothing changes. */
export function reorderMain(comp: Composition, id: string, toIndex: number): Composition {
  const main = mainTrack(comp);
  if (!main) return comp;
  const sorted = [...main.placements].sort((a, b) => a.startTicks - b.startTicks);
  const from = sorted.findIndex((p) => p.id === id);
  if (from < 0) return comp;
  const to = Math.max(0, Math.min(sorted.length - 1, toIndex));
  const order = [...sorted];
  const [p] = order.splice(from, 1);
  order.splice(to, 0, p);
  let t = sorted[0].startTicks;
  const packed = order.map((x) => { const y = { ...x, startTicks: t }; t += x.durationTicks; return y; });
  if (packed.every((x, i) => x.id === sorted[i].id && x.startTicks === sorted[i].startTicks)) return comp;
  return { ...comp, tracks: comp.tracks.map((tr) => tr.id === main.id ? { ...tr, placements: packed } : tr) };
}

/** Delete a layer with all its clips. The main track is never removed. */
export function deleteLayer(comp: Composition, trackId: string): Composition {
  if (mainTrack(comp)?.id === trackId || !comp.tracks.some((t) => t.id === trackId)) return comp;
  return { ...comp, tracks: comp.tracks.filter((t) => t.id !== trackId) };
}
