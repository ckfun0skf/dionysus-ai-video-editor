/**
 * P17-CLIP-SOURCE: where an AI shot's clip comes from. A shot either makes its own clip (its prompt and versions)
 * or reuses a shared video clip (a video asset slot) from an in point. These pure ops switch between the two and
 * turn a shot's own clip into a shared one so other shots can reuse it.
 */
import type { Project } from "./model";
import { shotClips, versionsOf, type AssetSlot, type Shot, type Storyboard } from "./storyboard";
import { deleteSlot } from "./storyRefs";

/** What the editor's Clip source picker can choose, keyed by `slot:<id>` or `shot:<id>` (another shot's own clip). */
export interface ClipChoice {
  key: string; label: string; name: string; firstShot?: string; firstShotNo?: number; generated: boolean;
  durationSec?: number; slotId?: string; ownShot?: string; owner: { assetId?: string };
  /** Why another shot's own clip cannot be shared (keyframe or frame references), if so. */
  blocked?: string;
}

export type ClipSource = { reuse: string; inSec?: number } | { own: true } | { share: true };

/** Why a shot's own clip cannot become a shared clip yet, or undefined when it can. */
export function shareBlock(b: Storyboard, s: Shot): string | undefined {
  if (s.render) return "Only AI video shots have a clip to share.";
  if (s.clipSlot) return "This shot already plays a shared clip.";
  if (s.keyframe) return "Shots with a keyframe cannot share their clip yet.";
  if (s.slotIds.some((x) => b.slots[x]?.implicit === "frameof" || b.slots[x]?.implicit === "lastframe")) return "Shots that use a frame from another shot cannot share their clip yet.";
  return undefined;
}

const lenOf = (p: Project, owner: { assetId?: string }) => {
  const a = owner.assetId ? p.assets[owner.assetId] : undefined;
  const v = a?.versions.find((x) => x.id === a.selectedVersionId) ?? versionsOf(p, owner).at(-1);
  return v?.media.durationTicks ? Math.round(v.media.durationTicks / 1200) / 100 : undefined;
};

/** The clips a shot can reuse: shared video clips, other video assets and other shots' own clips, in board order. */
export function clipChoices(p: Project, shotId: string): ClipChoice[] {
  const b = p.storyboard;
  if (!b) return [];
  const info = shotClips(p);
  const no = (id: string) => b.order.indexOf(id) + 1;
  const out: ClipChoice[] = [];
  const seen = new Set<string>();
  for (const id of b.order) {
    const c = info[id], s = b.shots[id];
    if (!c || !s || c.firstShot !== id) continue;
    if (c.slotId) {
      const slot = b.slots[c.slotId];
      seen.add(slot.id);
      out.push({ key: `slot:${slot.id}`, label: c.label, name: slot.name, firstShot: id, firstShotNo: no(id), generated: c.generated, durationSec: lenOf(p, slot) ?? slot.genDurationSec, slotId: slot.id, owner: slot });
    } else if (id !== shotId) {
      out.push({ key: `shot:${id}`, label: c.label, name: s.title, firstShot: id, firstShotNo: no(id), generated: c.generated, durationSec: lenOf(p, s) ?? s.genDurationSec ?? s.durationSec, ownShot: id, owner: s, blocked: shareBlock(b, s) });
    }
  }
  for (const slot of Object.values(b.slots)) {
    if (slot.type !== "video" || slot.implicit || seen.has(slot.id)) continue;
    out.push({ key: `slot:${slot.id}`, label: "Video asset", name: slot.name, generated: versionsOf(p, slot).length > 0, durationSec: lenOf(p, slot) ?? slot.genDurationSec, slotId: slot.id, owner: slot });
  }
  return out;
}

const freeId = (b: Storyboard, base: string) => { let id = base, i = 2; while (b.slots[id]) id = `${base}-${i++}`; return id; };

/** Turn a shot's own clip (prompt, references, versions) into a shared video clip the shot then plays from 0. */
export function shareShotClip(p: Project, shotId: string): Project {
  const b = p.storyboard, s = b?.shots[shotId];
  if (!b || !s || shareBlock(b, s)) return p;
  const id = freeId(b, `${shotId}-clip`);
  const refs = s.slotIds.filter((x) => b.slots[x]);
  const slot: AssetSlot = {
    id, name: `Clip · ${s.title}`, type: "video", aspect: b.meta.aspect || "16:9", prompt: s.prompt, references: refs,
    source: { type: "generate" }, qa: [], ...(s.assetId ? { assetId: s.assetId } : {}), ...(s.genDurationSec ? { genDurationSec: s.genDurationSec } : {}),
  };
  const { clipInSec: _i, ...rest } = s;
  const n: Shot = { ...rest, prompt: "", clipSlot: id, slotIds: [...refs, id] };
  return { ...p, storyboard: { ...b, slots: { ...b.slots, [id]: slot }, shots: { ...b.shots, [shotId]: n } } };
}

const slotUsedBy = (b: Storyboard, slotId: string, except: string) =>
  Object.values(b.shots).some((x) => x.id !== except && (x.clipSlot === slotId || x.slotIds.includes(slotId) || x.layers?.some((l) => "asset" in l && l.asset === slotId)))
  || Object.values(b.slots).some((x) => x.references.includes(slotId));

/** Unlink a shot from its shared clip; the clip asset goes away when nothing else uses it (its media stays). */
function unlinkShared(p: Project, shotId: string): Project {
  const b = p.storyboard!, s = b.shots[shotId];
  const old = s.clipSlot;
  if (!old || s.render) return p;
  const { clipSlot: _c, clipInSec: _i, assetId: _a, ownAssetId, ...rest } = s;
  const n: Shot = { ...rest, slotIds: s.slotIds.filter((x) => x !== old), ...(ownAssetId ? { assetId: ownAssetId } : {}) };
  let next: Project = { ...p, storyboard: { ...b, shots: { ...b.shots, [shotId]: n } } };
  if (!slotUsedBy(next.storyboard!, old, shotId) && b.slots[old]?.type === "video" && !b.slots[old].implicit) next = deleteSlot(next, old);
  return next;
}

/** Point an AI shot at a clip source. `reuse` takes a `slot:<id>`/`shot:<id>` key (a shot's own clip is shared first). */
export function setClipSource(p: Project, shotId: string, src: ClipSource): Project {
  const b0 = p.storyboard, s0 = b0?.shots[shotId];
  if (!b0 || !s0 || s0.render) return p;
  if ("share" in src) return shareShotClip(p, shotId);
  if ("own" in src) return unlinkShared(p, shotId);
  let next = p;
  let slotId = src.reuse.startsWith("slot:") ? src.reuse.slice(5) : undefined;
  if (src.reuse.startsWith("shot:")) {
    const other = src.reuse.slice(5);
    if (other === shotId) return p;
    next = shareShotClip(next, other);
    slotId = next.storyboard!.shots[other]?.clipSlot;
  }
  const b = next.storyboard!;
  const slot = slotId ? b.slots[slotId] : undefined;
  if (!slot || slot.type !== "video") return p;
  if (s0.clipSlot === slot.id) return next;
  if (s0.clipSlot) next = unlinkShared(next, shotId);
  const b2 = next.storyboard!, s = b2.shots[shotId];
  // The shot's own clip is dropped: its prompt is cleared and its versions stay in the media library only.
  const { assetId: _a, ownAssetId: _o, clipInSec: _i, keyframe: _k, ...rest } = s;
  const inSec = Math.max(0, Math.round((src.inSec ?? 0) * 100) / 100);
  const n: Shot = { ...rest, prompt: "", clipSlot: slot.id, slotIds: [...s.slotIds.filter((x) => x !== slot.id), slot.id], ...(inSec ? { clipInSec: inSec } : {}), ...(b2.slots[slot.id].assetId ? { assetId: b2.slots[slot.id].assetId } : {}) };
  return { ...next, storyboard: { ...b2, shots: { ...b2.shots, [shotId]: n } } };
}
