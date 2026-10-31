/**
 * Storyboard editing (V2-CUT-02): add, edit, duplicate, delete and reorder shots, and edit the connection between
 * two neighbouring shots. Pure ops on a Project; the engine wraps each one as a single undo step.
 *
 * - Timeline clips are never touched: a deleted or moved shot keeps whatever "Send to timeline" already placed.
 * - Connections are kept as written. Only a connection between shots that are next to each other in the order
 *   is shown and used (spec: "adjacent shots only"); moving a shot back restores it. Deleting a shot drops its
 *   connections.
 * - A last-frame asset whose source shot is deleted becomes an upload, keeping its versions.
 * - Layers and effects follow the shot length: shortening a shot clamps them (never drops them).
 */
import type { HtmlParamValues } from "./htmlClipPackage";
import type { Project } from "./model";
import type { AssetSlot, QaCheck, Shot, Storyboard } from "./storyboard";
import { addSlot, withRefs, type SlotPatch } from "./storyRefs";
import { backgroundId, dialogueText, hasOffscreenMark, parseDialogueText, type ConnectionKind, type StoryConnection, type StoryEffect, type StoryLayer, type StoryTransition, type StoryBackground } from "./storyJson";

export const MIN_SHOT_SEC = 0.5, MAX_SHOT_SEC = 120, DEFAULT_SHOT_SEC = 5;
/** Shortest layer or effect kept when a shot is shortened (seconds). */
const MIN_PART_SEC = 0.1;

const clampSec = (s: number) => Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, Math.round(s * 100) / 100));

/** First free shot id of the form s1, s2, … */
export function nextShotId(b: Storyboard): string {
  for (let i = b.order.length + 1; ; i += 1) if (!b.shots[`s${i}`]) return `s${i}`;
}

/** New check id for an owner, unique among its checks. */
export function newCheckId(owner: string, existing: QaCheck[]): string {
  const ids = new Set(existing.map((q) => q.id));
  for (let i = existing.length + 1; ; i += 1) if (!ids.has(`${owner}.qa${i}`)) return `${owner}.qa${i}`;
}

/** Whether `a` and `b` are next to each other in that order. */
export const adjacent = (b: Storyboard, from: string, to: string) => { const i = b.order.indexOf(from); return i >= 0 && b.order[i + 1] === to; };
/** The connection shown between two neighbouring shots (none = a plain cut). */
export const connectionBetween = (b: Storyboard, from: string, to: string): StoryConnection | undefined =>
  adjacent(b, from, to) ? b.connections.find((c) => c.from === from && c.to === to) : undefined;

/** Clamp a [start, end) range into a shot `dur` long, keeping at least MIN_PART_SEC (spec: clamp, never drop). */
export function clampRange(start: number, end: number, dur: number): { startSec: number; endSec: number } {
  const e = Math.min(end, dur);
  return { startSec: round(Math.max(0, Math.min(start, e - MIN_PART_SEC))), endSec: round(e) };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Layers and effects of a shot fitted to a new length. */
function fitParts(s: Pick<Shot, "layers" | "effects">, dur: number): Pick<Shot, "layers" | "effects"> {
  const layers = s.layers?.map((l): StoryLayer => (l.endSec > dur + 1e-9 ? { ...l, ...clampRange(l.startSec, l.endSec, dur) } : l));
  const effects = s.effects?.map((e): StoryEffect => {
    const st = e.startSec ?? 0, en = e.endSec;
    if (en === undefined ? st <= dur - MIN_PART_SEC : en <= dur + 1e-9) return e;
    const r = clampRange(st, en ?? dur, dur);
    return { ...e, ...(e.startSec !== undefined ? { startSec: r.startSec } : {}), ...(en !== undefined ? { endSec: r.endSec } : {}) };
  });
  return { ...(layers ? { layers } : {}), ...(effects ? { effects } : {}) };
}

/** Layers and effects that run past `dur` (what the editor warns about before saving a shorter length). */
export function partsPastEnd(s: Pick<Shot, "layers" | "effects">, dur: number): number {
  return (s.layers ?? []).filter((l) => l.endSec > dur + 1e-9).length + (s.effects ?? []).filter((e) => (e.endSec ?? 0) > dur + 1e-9 || (e.startSec ?? 0) > dur - MIN_PART_SEC).length;
}

/** Keep the media-library names of shot clip assets ("3. Title") in step with the order and titles. */
function renameShotAssets(p: Project, b: Storyboard): Project {
  let assets = p.assets;
  b.order.forEach((id, i) => {
    const s = b.shots[id];
    const aid = s?.clipSlot ? s.ownAssetId : s?.assetId;
    const a = aid ? assets[aid] : undefined;
    const name = s && `${i + 1}. ${s.title}`;
    if (!a || !name || a.name === name || !/^\d+\. /.test(a.name)) return;
    if (assets === p.assets) assets = { ...p.assets };
    assets[a.id] = { ...a, name };
  });
  return assets === p.assets ? { ...p, storyboard: b } : { ...p, assets, storyboard: b };
}

/** Shot fields a user can edit. `render` "ai" clears the clip slot. */
export interface ShotPatch {
  title?: string; description?: string; durationSec?: number; prompt?: string; camera?: string;
  /**
   * The dialogue text. V2-SB-135: a shot with dialogue lines, or text marking a line "NAME (O.S.): …", is kept as
   * lines (one per text line, "SPEAKER: text" or "SPEAKER (O.S.): text"); otherwise it stays plain text.
   */
  dialogue?: string; captions?: boolean;
  qa?: QaCheck[]; layers?: StoryLayer[]; effects?: StoryEffect[];
  render?: "ai" | "html" | "still"; clipSlot?: string;
  /**
   * P2B (item 20): render "still": show this colour / gradient instead of an image asset (kept in the implicit slot
   * `backgroundId(shot)`; `clipSlot` is ignored). null = use `clipSlot` again.
   */
  background?: StoryBackground | null;
  /** V2-SB-121: length to generate; null clears it. Ignored (cleared) when not longer than `durationSec`. */
  genDurationSec?: number | null;
  /** V2-CUT-05: the shot's reference assets (the clip slot is kept). */
  slotIds?: string[];
  /** V2-CUT-05: asset slots created with this edit (same undo step), usually also listed in `slotIds`. */
  newSlots?: { id: string; patch: SlotPatch }[];
  /** P2C (item 4): render "html": per-use param values (overrides of the clip's defaults); null or {} clears them. */
  params?: HtmlParamValues | null;
}

/** Slots that can be the clip of a shot rendered `render` (html: html assets; still: image assets). */
export function clipSlotsFor(b: Storyboard, render: "html" | "still"): AssetSlot[] {
  return Object.values(b.slots).filter((s) => s.implicit !== "background" && (render === "html" ? s.type === "html" : s.type === "image"));
}

function blankShot(id: string, init: ShotPatch = {}): Shot {
  return { id, title: init.title?.trim() || "New shot", description: init.description ?? "", durationSec: clampSec(init.durationSec ?? DEFAULT_SHOT_SEC), prompt: init.prompt ?? "", slotIds: [], qa: init.qa ?? [] };
}

/** Insert a new shot after `afterId` (at the start when null, at the end when undefined). */
export function addShot(p: Project, id: string, init: ShotPatch = {}, afterId?: string | null): Project {
  const b = p.storyboard;
  if (!b || b.shots[id]) return p;
  const order = [...b.order];
  const at = afterId === null ? 0 : afterId === undefined || !order.includes(afterId) ? order.length : order.indexOf(afterId) + 1;
  order.splice(at, 0, id);
  const next = updateShot({ ...p, storyboard: { ...b, order, shots: { ...b.shots, [id]: blankShot(id, init) } } }, id, { ...init, title: undefined, description: undefined, durationSec: undefined, prompt: undefined, qa: undefined });
  return renameShotAssets(next, next.storyboard!);
}

/** Apply edits to a shot. Shortening it fits its layers and effects into the new length. */
export function updateShot(p: Project, id: string, patch: ShotPatch): Project {
  if (!p.storyboard?.shots[id]) return p;
  for (const ns of patch.newSlots ?? []) p = addSlot(p, ns.id, ns.patch);
  const b = p.storyboard!, s = b.shots[id];
  let n: Shot = patch.slotIds ? withRefs(b, s, patch.slotIds) : { ...s };
  const text = (k: "title" | "description" | "prompt") => { if (patch[k] !== undefined) n[k] = k === "title" ? patch[k]!.trim() || s.title : patch[k]!; };
  text("title"); text("description"); text("prompt");
  // P10-SYNC: a shot made from the timeline stops needing a prompt once one is written.
  if (n.needsPrompt && n.prompt.trim()) delete n.needsPrompt;
  for (const k of ["camera", "dialogue"] as const) if (patch[k] !== undefined) { const v = patch[k]!.trim(); if (v) n[k] = patch[k]; else delete n[k]; }
  if (patch.dialogue !== undefined) {
    const lines = n.dialogue && (s.lines?.length || hasOffscreenMark(n.dialogue)) ? parseDialogueText(n.dialogue) : [];
    if (lines.length) { n.lines = lines; n.dialogue = dialogueText(lines); } else delete n.lines;
  }
  if (patch.captions !== undefined) { if (patch.captions) n.captions = true; else delete n.captions; }
  if (patch.qa) n.qa = patch.qa.filter((q) => q.text.trim()).map((q) => ({ id: q.id, text: q.text.trim() }));
  if (patch.layers) { if (patch.layers.length) n.layers = patch.layers; else delete n.layers; }
  if (patch.effects) { if (patch.effects.length) n.effects = patch.effects; else delete n.effects; }
  if (patch.params !== undefined) { if (patch.params && Object.keys(patch.params).length) n.params = { ...patch.params }; else delete n.params; }
  if (patch.durationSec !== undefined && Number.isFinite(patch.durationSec)) n.durationSec = clampSec(patch.durationSec);
  if (patch.genDurationSec !== undefined) { if (patch.genDurationSec && Number.isFinite(patch.genDurationSec)) n.genDurationSec = clampSec(patch.genDurationSec); else delete n.genDurationSec; }
  if (n.genDurationSec !== undefined && n.genDurationSec <= n.durationSec) delete n.genDurationSec;
  if (patch.durationSec !== undefined || patch.layers || patch.effects) {
    const { layers: _l, effects: _e, ...rest } = n;
    n = { ...rest, ...fitParts(n, n.durationSec) };
  }
  let bb = b;
  let clip = patch.clipSlot;
  const stillNow = patch.render === "still" || (patch.render === undefined && s.render === "still");
  if (stillNow && patch.background) {
    const bid = backgroundId(id), old = b.slots[bid];
    const slot: AssetSlot = old?.implicit === "background"
      ? { ...old, background: structuredClone(patch.background), aspect: b.meta.aspect }
      : { id: bid, name: `Background · ${n.title}`, type: "image", aspect: b.meta.aspect, prompt: "", references: [], source: { type: "generate" }, qa: [], implicit: "background", background: structuredClone(patch.background) };
    if (!old || old.implicit === "background") { bb = { ...b, slots: { ...b.slots, [bid]: slot } }; clip = bid; }
  }
  if (patch.render !== undefined) n = withRender(bb, n, patch.render, clip);
  else if (stillNow && clip !== undefined) n = withRender(bb, n, "still", clip);
  // A background slot no shot shows any more goes away (its drawn pictures stay in the project's media).
  const bgOld = backgroundId(id);
  if (bb.slots[bgOld]?.implicit === "background" && n.clipSlot !== bgOld && !Object.values(bb.shots).some((x) => x.id !== id && x.clipSlot === bgOld)) {
    const { [bgOld]: _gone, ...rest } = bb.slots;
    bb = { ...bb, slots: rest };
    n = { ...n, slotIds: n.slotIds.filter((x) => x !== bgOld) };
  }
  if (n.refOverrides) n = withRefs(bb, n, n.slotIds); // drop pins of references the edit removed
  if (JSON.stringify(n) === JSON.stringify(s) && (bb === b || JSON.stringify(bb.slots) === JSON.stringify(b.slots))) return p;
  return renameShotAssets(p, { ...bb, shots: { ...bb.shots, [id]: n } });
}

/**
 * Switch how a shot's clip is made. An ai shot's own clip asset is kept aside (`ownAssetId`) while the shot shows a
 * slot, so switching back restores its versions. The clip slot is added to the shot's assets.
 */
function withRender(b: Storyboard, s: Shot, render: "ai" | "html" | "still", clipSlot?: string): Shot {
  const { render: _r, clipSlot: _c, ownAssetId, ...rest } = s;
  if (render === "ai") {
    const own = s.clipSlot ? ownAssetId : s.assetId;
    const out: Shot = { ...rest, slotIds: rest.slotIds.filter((x) => x !== s.clipSlot) };
    if (own) out.assetId = own; else delete out.assetId;
    return out;
  }
  const slot = clipSlot ? b.slots[clipSlot] : undefined;
  const own0 = slot?.implicit === "background" && slot.id === backgroundId(s.id) && render === "still";
  if (!slot || (!own0 && !clipSlotsFor(b, render).includes(slot))) return s;
  const own = s.clipSlot ? ownAssetId : s.assetId;
  const kept = rest.slotIds.filter((x) => x !== s.clipSlot || x === slot.id);
  const out: Shot = { ...rest, render, clipSlot: slot.id, slotIds: kept.includes(slot.id) ? kept : [...kept, slot.id] };
  if (slot.assetId) out.assetId = slot.assetId; else delete out.assetId;
  if (own) out.ownAssetId = own;
  return out;
}

/** Copy a shot (prompts, assets used, checks, layers, effects) right after it, without its clip versions. */
export function duplicateShot(p: Project, id: string, copyId: string): Project {
  const b = p.storyboard, s = b?.shots[id];
  if (!b || !s || b.shots[copyId]) return p;
  // The copy keeps the keyframe as a plain reference: a keyframe belongs to one shot (V2-SB-124).
  const { assetId: _a, ownAssetId: _o, skipped: _s, keyframe: _k, ...rest } = structuredClone(s);
  const copy: Shot = { ...rest, id: copyId, title: `${s.title} (copy)`, qa: s.qa.map((q, i) => ({ id: `${copyId}.qa${i + 1}`, text: q.text })) };
  // An html or still shot shows its slot, so the copy shows the same versions.
  if (s.clipSlot && b.slots[s.clipSlot]?.assetId) copy.assetId = b.slots[s.clipSlot].assetId;
  const order = [...b.order];
  order.splice(order.indexOf(id) + 1, 0, copyId);
  return renameShotAssets(p, { ...b, order, shots: { ...b.shots, [copyId]: copy } });
}

/** What deleting a shot changes besides the shot itself (for the confirmation). */
export function deleteShotEffects(b: Storyboard, id: string): { frames: AssetSlot[]; connections: number } {
  return {
    frames: Object.values(b.slots).filter((s) => s.source.type === "lastFrame" && s.source.shotId === id),
    connections: b.connections.filter((c) => c.from === id || c.to === id).length,
  };
}

/** Delete a shot. Its clip versions stay in the media library and on the timeline. */
export function deleteShot(p: Project, id: string): Project {
  const b = p.storyboard;
  if (!b?.shots[id]) return p;
  const { [id]: _gone, ...shots } = b.shots;
  const slots = Object.fromEntries(Object.entries(b.slots).map(([k, s]) => {
    if (s.source.type === "lastFrame" && s.source.shotId === id) return [k, { ...s, source: { type: "upload" as const } }];
    if (s.keyframeOf === id) { const { keyframeOf: _k, ...rest } = s; return [k, rest]; } // stays as a plain frame asset
    return [k, s];
  }));
  // V2-SB-125: a cue that starts in the shot starts with the next shot it spans, else it goes; one that ends in it
  // ends with the shot before.
  const at = b.order.indexOf(id), prev = b.order[at - 1], nextId = b.order[at + 1];
  const audio = b.audio?.flatMap((c): NonNullable<Storyboard["audio"]> => {
    if (c.from === id) {
      if (!c.to || !nextId) return [];
      const { atSec: _a, to, ...r } = c;
      return [{ ...r, from: nextId, ...(to !== nextId ? { to } : {}) }];
    }
    if (c.to !== id) return [c];
    const { to: _t, ...r } = c;
    return [prev && prev !== c.from ? { ...r, to: prev } : r];
  });
  const next: Storyboard = { ...b, order: b.order.filter((x) => x !== id), shots, slots, connections: b.connections.filter((c) => c.from !== id && c.to !== id) };
  if (audio?.length) next.audio = audio; else delete next.audio;
  return renameShotAssets(p, next);
}

/** Move a shot to position `index` (0-based, clamped). */
export function moveShot(p: Project, id: string, index: number): Project {
  const b = p.storyboard;
  const from = b ? b.order.indexOf(id) : -1;
  if (!b || from < 0) return p;
  const to = Math.max(0, Math.min(b.order.length - 1, Math.round(index)));
  if (to === from) return p;
  const order = b.order.filter((x) => x !== id);
  order.splice(to, 0, id);
  return renameShotAssets(p, { ...b, order });
}

/** Connections shown on the board (non-plain, between neighbours) that `order` would switch off. */
export function connectionsLostByMove(b: Storyboard, order: string[]): StoryConnection[] {
  const adj = (o: string[], c: StoryConnection) => { const i = o.indexOf(c.from); return i >= 0 && o[i + 1] === c.to; };
  return b.connections.filter((c) => adj(b.order, c) && !adj(order, c) && (c.kind !== "cut" || !!c.transition || !!c.note));
}

/** The order after moving `id` to `index` (for previews and notes). */
export function orderAfterMove(b: Storyboard, id: string, index: number): string[] {
  const order = b.order.filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, index)), 0, id);
  return order;
}

export interface ConnectionPatch { kind?: ConnectionKind; note?: string; transition?: StoryTransition | null }

/** Set how shot `from` leads into its neighbour `to`. A plain cut with no note and no transition is stored as nothing. */
export function setConnection(p: Project, from: string, to: string, patch: ConnectionPatch): Project {
  const b = p.storyboard;
  if (!b || !adjacent(b, from, to)) return p;
  const cur = b.connections.find((c) => c.from === from && c.to === to);
  const next: StoryConnection = { from, to, kind: patch.kind ?? cur?.kind ?? "cut" };
  const note = patch.note !== undefined ? patch.note.trim() : cur?.note;
  if (note) next.note = note;
  const tr = patch.transition === null ? undefined : patch.transition ?? cur?.transition;
  if (tr) next.transition = tr;
  const plain = next.kind === "cut" && !next.note && !next.transition;
  const rest = b.connections.filter((c) => c !== cur);
  if (plain && !cur) return p;
  return { ...p, storyboard: { ...b, connections: plain ? rest : cur ? b.connections.map((c) => (c === cur ? next : c)) : [...b.connections, next] } };
}
