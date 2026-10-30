/**
 * P2A: storyboard round trip.
 * - `storyboardToDoc` writes the board, with every edit made on it, back as a `dionysus.storyboard/1` document (the
 *   inverse of `storyboardFromDoc`): asset states fold back into `states`, keyframe slots into `shots[].keyframe`,
 *   and the clip slot added to a shot's assets on import is left out again.
 * - `mergeStoryboard` re-imports a revised document into an existing board by id: assets and shots whose ids remain
 *   keep their uploads, version picks, trims, pins and QA results; new ids are added; missing ids are removed.
 *   `storyDiff` lists what a merge would add, change and remove, for the confirm step.
 */
import type { Project } from "./model";
import { storyboardFromDoc, type AssetSlot, type QaCheck, type Shot, type Storyboard } from "./storyboard";
import { splitStateId, stateBaseNote, type StoryAsset, type StoryAssetRef, type StoryAssetState, type StoryDoc, type StoryShot } from "./storyJson";

const refsOut = (slot: AssetSlot, skip?: string): StoryAssetRef[] =>
  slot.references.filter((id) => id !== skip).map((id) => (slot.refRoles?.[id] ? { asset: id, ...structuredClone(slot.refRoles[id]) } : id));
const texts = (qa: QaCheck[]) => qa.map((q) => q.text);

/** True when a state's first reference is the base reference that import adds by itself. */
function autoBaseRef(slot: AssetSlot, base: AssetSlot): boolean {
  if (slot.references[0] !== base.id) return false;
  const r = slot.refRoles?.[base.id];
  return !!r && r.note === stateBaseNote(base.name) && r.role === (base.type === "character" ? "identity" : undefined);
}

function assetOut(s: AssetSlot): StoryAsset {
  return {
    id: s.id, name: s.name, type: s.type, aspect: s.aspect, prompt: s.prompt, references: refsOut(s),
    source: s.source.type === "lastFrame" ? { type: "lastFrame", shot: s.source.shotId } : { type: s.source.type },
    qa: texts(s.qa), ...(s.notes ? { notes: s.notes } : {}), ...(s.params ? { params: structuredClone(s.params) } : {}),
    ...(s.type === "video" && s.genDurationSec ? { genDurationSec: s.genDurationSec } : {}),
    ...(s.seriesRef ? { seriesRef: s.seriesRef } : {}), ...(s.seriesPromote ? { series: true as const } : {}),
  };
}

function stateOut(s: AssetSlot, base: AssetSlot): StoryAssetState {
  const id = splitStateId(s.id)!.state;
  const refs = refsOut(s, autoBaseRef(s, base) ? base.id : undefined);
  return {
    id, ...(s.stateName && s.stateName !== id ? { name: s.stateName } : {}), prompt: s.prompt, ...(refs.length ? { references: refs } : {}),
    ...(s.source.type === "upload" ? { source: "upload" as const } : {}), ...(s.qa.length ? { qa: texts(s.qa) } : {}), ...(s.notes ? { notes: s.notes } : {}),
  };
}

function shotOut(b: Storyboard, s: Shot): StoryShot {
  let assets = s.slotIds.filter((id) => id !== s.keyframe);
  // Import appends the clip slot when the shot's assets don't list it; drop it again only from that place.
  if (s.clipSlot && assets.at(-1) === s.clipSlot) assets = assets.slice(0, -1);
  const kf = s.keyframe ? b.slots[s.keyframe] : undefined;
  return {
    id: s.id, title: s.title, description: s.description, durationSec: s.durationSec, prompt: s.prompt, assets, qa: texts(s.qa),
    ...(s.camera ? { camera: s.camera } : {}),
    ...(s.lines?.length ? { dialogue: structuredClone(s.lines) } : s.dialogue ? { dialogue: s.dialogue } : {}),
    ...(s.render && s.clipSlot ? (b.slots[s.clipSlot]?.implicit === "background" ? { render: s.render, background: structuredClone(b.slots[s.clipSlot].background!) } : { render: s.render, clip: s.clipSlot }) : {}),
    ...(s.params && s.render === "html" ? { params: { ...s.params } } : {}),
    ...(s.layers?.length ? { layers: structuredClone(s.layers) } : {}),
    ...(s.captions ? { captions: true } : {}),
    ...(s.effects?.length ? { effects: structuredClone(s.effects) } : {}),
    ...(s.genDurationSec ? { genDurationSec: s.genDurationSec } : {}),
    ...(s.references?.length ? { references: s.references.map((r) => ({ asset: r.slotId, role: r.role, ...(r.note ? { note: r.note } : {}) })) } : {}),
    ...(kf ? { keyframe: { prompt: kf.prompt, references: refsOut(kf), qa: texts(kf.qa) } } : {}),
  };
}

/** The board as a storyboard document (spec §7 "Export"). Uploads, picks and QA results are not part of the format. */
export function storyboardToDoc(b: Storyboard): StoryDoc {
  const assets: StoryAsset[] = [];
  const byId = new Map<string, StoryAsset>();
  const slots = Object.values(b.slots);
  for (const s of slots) {
    if (s.keyframeOf && b.shots[s.keyframeOf]?.keyframe === s.id) continue;
    if (s.stateOf && b.slots[s.stateOf] && splitStateId(s.id)) continue;
    if (s.implicit) continue;
    const a = assetOut(s);
    assets.push(a); byId.set(a.id, a);
  }
  for (const s of slots) {
    const base = s.stateOf ? b.slots[s.stateOf] : undefined;
    if (!base || !splitStateId(s.id) || !byId.has(base.id)) continue;
    const a = byId.get(base.id)!;
    (a.states ??= []).push(stateOut(s, base));
  }
  return {
    format: "dionysus.storyboard/1", meta: structuredClone(b.meta), assets,
    shots: b.order.filter((id) => b.shots[id]).map((id) => shotOut(b, b.shots[id])),
    connections: b.connections.map((c) => structuredClone(c)),
    ...(b.audio?.length ? { audio: structuredClone(b.audio) } : {}),
  };
}

/** One asset or shot in a merge preview. `fields` = the document keys that differ (changed items only). */
export interface DiffItem { id: string; name: string; fields?: string[]; uploads?: number }
export interface StoryDiff {
  assets: { added: DiffItem[]; changed: DiffItem[]; removed: DiffItem[] };
  shots: { added: DiffItem[]; changed: DiffItem[]; removed: DiffItem[] };
  /** Other parts of the document that differ: "meta", "order", "connections", "audio". */
  other: string[];
  /** True when nothing differs. */
  same: boolean;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysDiff = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !eq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
const uploads = (p: Project, ...ids: (string | undefined)[]) => ids.reduce((n, id) => n + ((id && p.assets[id]?.versions.length) || 0), 0);

/** What re-importing `doc` into the project's storyboard would add, change and remove (assets by top-level id, states and keyframes included). */
export function storyDiff(p: Project, doc: StoryDoc): StoryDiff {
  const b = p.storyboard;
  const old = b ? storyboardToDoc(b) : { meta: {}, assets: [], shots: [], connections: [], audio: undefined };
  const d: StoryDiff = { assets: { added: [], changed: [], removed: [] }, shots: { added: [], changed: [], removed: [] }, other: [], same: true };
  const oa = new Map(old.assets.map((a) => [a.id, a])), na = new Map(doc.assets.filter((a) => !a.implicit).map((a) => [a.id, a]));
  const slotUploads = (id: string) => uploads(p, ...Object.values(b?.slots ?? {}).filter((s) => s.id === id || s.stateOf === id).map((s) => s.assetId));
  for (const a of doc.assets) {
    if (a.implicit) continue;
    const o = oa.get(a.id);
    if (!o) d.assets.added.push({ id: a.id, name: a.name });
    else { const f = keysDiff(o, a); if (f.length) d.assets.changed.push({ id: a.id, name: a.name, fields: f }); }
  }
  for (const a of old.assets) if (!na.has(a.id)) d.assets.removed.push({ id: a.id, name: a.name, uploads: slotUploads(a.id) });
  const os = new Map(old.shots.map((s) => [s.id, s])), ns = new Map(doc.shots.map((s) => [s.id, s]));
  for (const s of doc.shots) {
    const o = os.get(s.id);
    if (!o) d.shots.added.push({ id: s.id, name: s.title });
    else { const f = keysDiff(o, s); if (f.length) d.shots.changed.push({ id: s.id, name: s.title, fields: f }); }
  }
  for (const s of old.shots) if (!ns.has(s.id)) {
    const sh = b?.shots[s.id];
    d.shots.removed.push({ id: s.id, name: s.title, uploads: uploads(p, sh?.clipSlot ? sh.ownAssetId : sh?.assetId, sh?.keyframe ? b?.slots[sh.keyframe]?.assetId : undefined) });
  }
  if (!eq(old.meta, doc.meta)) d.other.push("meta");
  if (!eq(old.shots.map((s) => s.id).filter((id) => ns.has(id)), doc.shots.map((s) => s.id).filter((id) => os.has(id)))) d.other.push("order");
  if (!eq(old.connections, doc.connections)) d.other.push("connections");
  if (!eq(old.audio ?? [], doc.audio ?? [])) d.other.push("audio");
  d.same = !d.other.length && [d.assets, d.shots].every((g) => !g.added.length && !g.changed.length && !g.removed.length);
  return d;
}

/** New checks reuse the id of an old check with the same text, so QA results recorded against it still apply. */
function keepQa(old: QaCheck[], next: QaCheck[]): QaCheck[] {
  const pool = [...old];
  const out = next.map((q) => {
    const i = pool.findIndex((o) => o.text === q.text);
    return i < 0 ? { ...q, kept: false } : { id: pool.splice(i, 1)[0].id, text: q.text, kept: true };
  });
  // A fresh id may collide with a kept one (e.g. checks reordered): give it an unused number.
  const used = new Set(out.filter((q) => q.kept).map((q) => q.id));
  return out.map(({ kept, ...q }) => {
    if (!kept && used.has(q.id)) {
      const owner = q.id.replace(/\.qa\d+$/, "");
      let n = 1;
      while (used.has(`${owner}.qa${n}`)) n += 1;
      q.id = `${owner}.qa${n}`;
    }
    used.add(q.id);
    return q;
  });
}

/**
 * Merge a revised document into the project's storyboard by id (P2A re-import). Matching assets and shots take the
 * document's content and keep their uploads (backing asset), skip flag, per-shot pins and QA results; versions and
 * their trims stay with the board. New ids start empty; missing ids leave the board (their uploads stay in the media
 * library). With no storyboard yet this is a plain import.
 */
export function mergeStoryboard(p: Project, doc: StoryDoc): Storyboard {
  const old = p.storyboard;
  const fresh = storyboardFromDoc(doc);
  if (!old) return fresh;
  const slots: Record<string, AssetSlot> = {};
  for (const [id, s] of Object.entries(fresh.slots)) {
    const o = old.slots[id];
    slots[id] = o ? { ...s, ...(s.keyframeOf && o.keyframeOf === s.keyframeOf ? { name: o.name } : {}), qa: keepQa(o.qa, s.qa), ...(o.assetId ? { assetId: o.assetId } : {}), ...(o.skipped ? { skipped: true } : {}) } : s;
  }
  const shots: Record<string, Shot> = {};
  for (const [id, s] of Object.entries(fresh.shots)) {
    const o = old.shots[id];
    if (!o) { shots[id] = s; continue; }
    // The shot's own (AI clip) asset: kept aside in ownAssetId while it is made from a clip slot.
    const own = o.clipSlot ? o.ownAssetId : o.assetId;
    const pins = Object.fromEntries(Object.entries(o.refOverrides ?? {}).filter(([k]) => slots[k] && s.slotIds.includes(k)));
    const next: Shot = { ...s, qa: keepQa(o.qa, s.qa), ...(o.skipped ? { skipped: true } : {}), ...(Object.keys(pins).length ? { refOverrides: pins } : {}) };
    if (s.clipSlot) { const a = slots[s.clipSlot]?.assetId; if (a) next.assetId = a; if (own) next.ownAssetId = own; }
    else if (own) next.assetId = own;
    shots[id] = next;
  }
  return {
    ...fresh, shots, slots, versions: old.versions,
    ...(old.stepOrder ? { stepOrder: old.stepOrder } : {}),
    ...(old.sent ? { sent: old.sent } : {}),
  };
}
