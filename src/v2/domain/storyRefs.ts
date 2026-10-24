/**
 * Per-shot reference assets and overrides (V2-CUT-05). Pure ops on a Project; the engine wraps each as one undo step.
 *
 * - A shot's references are its `slotIds` (the assets its clip is generated from) plus the assets of its media
 *   layers. The clip slot of an html or still shot is not a reference: it is the clip.
 * - A shot can pin a reference to one version (`refOverrides`). The pin is what the shot's next upload records as
 *   its input, what "may not match" compares against, and what its linked media layers on the timeline show.
 *   Picking another version on the asset itself changes every other shot, never a pinned one.
 * - Asset slots can be added, edited and deleted. Deleting keeps the asset's versions in the media library and its
 *   clips on the timeline; a slot that is a shot's clip or a layer's asset cannot be deleted.
 */
import type { Composition, Project } from "./model";
import { kindForSlot, pinOf, refVersionOf, selectedOf, versionsOf, type AssetSlot, type QaCheck, type Shot, type ShotReference, type Storyboard } from "./storyboard";
import { inferReferenceRole, STORY_ASSET_TYPES, type ReferenceRole, type StoryAssetType } from "./storyJson";

/** Reference slots of a shot: its assets, then its media layers' assets (no clip slot, no duplicates). */
export function shotRefIds(b: Storyboard, s: Shot): string[] {
  const ids = [...s.slotIds, ...(s.layers ?? []).flatMap((l) => (l.type === "text" ? [] : [l.asset]))];
  return [...new Set(ids)].filter((id) => id !== s.clipSlot && !!b.slots[id]);
}

/** Pin (or with `versionId` null, unpin) the version of reference `slotId` that shot `shotId` uses. */
export function setRefOverride(p: Project, shotId: string, slotId: string, versionId: string | null): Project {
  const b = p.storyboard, s = b?.shots[shotId], slot = b?.slots[slotId];
  if (!b || !s || !slot || !shotRefIds(b, s).includes(slotId)) return p;
  if (versionId && !versionsOf(p, slot).some((v) => v.id === versionId)) return p;
  const cur = s.refOverrides?.[slotId];
  if ((cur ?? null) === versionId) return p;
  const overrides = { ...s.refOverrides };
  if (versionId) overrides[slotId] = versionId; else delete overrides[slotId];
  const next: Shot = { ...s };
  if (Object.keys(overrides).length) next.refOverrides = overrides; else delete next.refOverrides;
  const q = { ...p, storyboard: { ...b, shots: { ...b.shots, [shotId]: next } } };
  return relinkLayers(q, shotId, slot);
}

/** Point the shot's linked media layers of `slot` on the timeline at the version the shot now uses. */
function relinkLayers(p: Project, shotId: string, slot: AssetSlot): Project {
  const a = slot.assetId ? p.assets[slot.assetId] : undefined;
  const vid = pinOf(p, p.storyboard!.shots[shotId], slot.id) ?? selectedOf(p, slot);
  const v = a?.versions.find((x) => x.id === vid);
  if (!a || !v) return p;
  let changed = false;
  const compositions: Record<string, Composition> = {};
  for (const [cid, c] of Object.entries(p.compositions)) {
    const anchors = new Set(c.tracks.flatMap((t) => t.placements.filter((pl) => pl.storyShot === shotId).map((pl) => pl.id)));
    compositions[cid] = !anchors.size ? c : {
      ...c,
      tracks: c.tracks.map((t) => ({
        ...t,
        placements: t.placements.map((pl) => {
          if (pl.source.assetId !== a.id || !pl.storyLink || !anchors.has(pl.storyLink.anchor) || pl.source.versionId === v.id) return pl;
          changed = true;
          const max = a.kind === "video" ? v.media.durationTicks : undefined;
          const room = max ? Math.max(1, Math.floor((max - Math.min(pl.sourceInTicks, max - 1)) / (pl.speed ?? 1))) : undefined;
          return { ...pl, source: { ...pl.source, versionId: v.id }, ...(max && pl.sourceInTicks >= max ? { sourceInTicks: 0 } : {}), ...(room && pl.durationTicks > room ? { durationTicks: room } : {}) };
        }),
      })),
    };
  }
  return changed ? { ...p, compositions } : p;
}

/** Asset fields a user can edit. `source` "generate" or "upload"; a last-frame slot keeps its source. */
/** Asset types with labels, in the order the pickers show them. */
export const SLOT_TYPES: { id: StoryAssetType; label: string }[] = [
  { id: "character", label: "Character" }, { id: "location", label: "Location" }, { id: "prop", label: "Prop" }, { id: "style", label: "Style" },
  { id: "image", label: "Image" }, { id: "frame", label: "Frame" }, { id: "video", label: "Video" }, { id: "audio", label: "Audio" }, { id: "html", label: "HTML" },
];
if (SLOT_TYPES.length !== STORY_ASSET_TYPES.length) throw new Error("SLOT_TYPES out of sync");

export interface SlotPatch {
  name?: string; type?: StoryAssetType; aspect?: string; prompt?: string; notes?: string;
  references?: string[]; source?: "generate" | "upload"; qa?: QaCheck[];
}

/** A slot id from its name ("Keeper's coat" → keeper-s-coat), unique in the storyboard. */
export function nextSlotId(b: Storyboard, name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "asset";
  if (!b.slots[base] && !b.shots[base]) return base;
  for (let i = 2; ; i += 1) if (!b.slots[`${base}-${i}`] && !b.shots[`${base}-${i}`]) return `${base}-${i}`;
}

/** Slots `id` may be made from: every other slot that does not (transitively) use `id`. */
export function referenceChoices(b: Storyboard, id: string): AssetSlot[] {
  const usesId = (from: string, seen = new Set<string>()): boolean => {
    if (from === id) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (b.slots[from]?.references ?? []).some((r) => usesId(r, seen));
  };
  return Object.values(b.slots).filter((s) => s.id !== id && !usesId(s.id));
}

/** Where a slot is used: shots listing it, shots showing it as their clip or as a layer, slots made from it. */
export interface SlotUse { shots: string[]; clipOf: string[]; layerOf: string[]; refOf: string[]; pinnedBy: string[] }
export function slotUse(b: Storyboard, id: string): SlotUse {
  const shots = b.order.filter((s) => b.shots[s]);
  return {
    shots: shots.filter((s) => b.shots[s].slotIds.includes(id) && b.shots[s].clipSlot !== id),
    clipOf: shots.filter((s) => b.shots[s].clipSlot === id),
    layerOf: shots.filter((s) => (b.shots[s].layers ?? []).some((l) => l.type !== "text" && l.asset === id)),
    refOf: Object.values(b.slots).filter((s) => s.references.includes(id)).map((s) => s.id),
    pinnedBy: shots.filter((s) => !!b.shots[s].refOverrides?.[id]),
  };
}

/** Why a slot cannot be deleted, if it cannot. */
export function slotDeleteBlock(b: Storyboard, id: string): string | undefined {
  const u = slotUse(b, id);
  const no = (s: string) => `shot ${b.order.indexOf(s) + 1}`;
  if (u.clipOf.length) return `It is the clip of ${u.clipOf.map(no).join(", ")}. Switch ${u.clipOf.length > 1 ? "those shots" : "that shot"} to another clip first.`;
  if (u.layerOf.length) return `It is a layer in ${u.layerOf.map(no).join(", ")}. Remove the layer first.`;
  return undefined;
}

function cleanSlot(b: Storyboard, s: AssetSlot, patch: SlotPatch, hasVersions: boolean): AssetSlot {
  const n: AssetSlot = { ...s };
  if (patch.name !== undefined && patch.name.trim()) n.name = patch.name.trim().slice(0, 80);
  // A type change must keep the backing asset's media kind once versions exist, and a clip slot keeps its type.
  if (patch.type && STORY_ASSET_TYPES.includes(patch.type) && patch.type !== s.type) {
    const clip = Object.values(b.shots).some((x) => x.clipSlot === s.id);
    if (!clip && (!hasVersions || kindForSlot(patch.type) === kindForSlot(s.type))) n.type = patch.type;
  }
  if (patch.aspect !== undefined && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(patch.aspect.trim())) n.aspect = patch.aspect.trim();
  if (patch.prompt !== undefined) n.prompt = patch.prompt;
  if (patch.notes !== undefined) { if (patch.notes.trim()) n.notes = patch.notes; else delete n.notes; }
  if (patch.references) { const ok = new Set(referenceChoices(b, s.id).map((x) => x.id)); n.references = [...new Set(patch.references)].filter((r) => ok.has(r)); }
  if (patch.source && s.source.type !== "lastFrame") n.source = { type: patch.source };
  if (patch.qa) n.qa = patch.qa.filter((q) => q.text.trim()).map((q) => ({ id: q.id, text: q.text.trim() }));
  return n;
}

/** Add an asset slot. Its name is required; type defaults to image, aspect to the storyboard's. */
export function addSlot(p: Project, id: string, patch: SlotPatch): Project {
  const b = p.storyboard;
  if (!b || b.slots[id] || b.shots[id] || !patch.name?.trim()) return p;
  const blank: AssetSlot = { id, name: patch.name.trim(), type: "image", aspect: b.meta.aspect || "16:9", prompt: "", references: [], source: { type: "generate" }, qa: [] };
  const withSlot: Storyboard = { ...b, slots: { ...b.slots, [id]: blank } };
  return { ...p, storyboard: { ...withSlot, slots: { ...withSlot.slots, [id]: cleanSlot(withSlot, blank, patch, false) } } };
}

/** Apply edits to an asset slot. Renaming also renames its media-library asset when it still has the slot's name. */
export function updateSlot(p: Project, id: string, patch: SlotPatch): Project {
  const b = p.storyboard, s = b?.slots[id];
  if (!b || !s) return p;
  const n = cleanSlot(b, s, patch, versionsOf(p, s).length > 0);
  if (JSON.stringify(n) === JSON.stringify(s)) return p;
  const a = s.assetId ? p.assets[s.assetId] : undefined;
  const assets = a && a.name === s.name && n.name !== s.name ? { ...p.assets, [a.id]: { ...a, name: n.name } } : p.assets;
  return { ...p, assets, storyboard: { ...b, slots: { ...b.slots, [id]: n } } };
}

/** Delete an asset slot: it leaves every shot's and slot's references. Its versions stay in the media library. */
export function deleteSlot(p: Project, id: string): Project {
  const b = p.storyboard;
  if (!b?.slots[id] || slotDeleteBlock(b, id)) return p;
  const { [id]: _gone, ...rest } = b.slots;
  const slots = Object.fromEntries(Object.entries(rest).map(([k, s]) => [k, s.references.includes(id) ? { ...s, references: s.references.filter((r) => r !== id) } : s]));
  const shots = Object.fromEntries(Object.entries(b.shots).map(([k, s]) => {
    if (!s.slotIds.includes(id) && !s.refOverrides?.[id] && !s.references?.some((r) => r.slotId === id)) return [k, s];
    const n: Shot = { ...s, slotIds: s.slotIds.filter((r) => r !== id) };
    if (n.references) { const refs = n.references.filter((r) => r.slotId !== id); if (refs.length) n.references = refs; else delete n.references; }
    if (n.refOverrides?.[id]) { const { [id]: _p, ...o } = n.refOverrides; if (Object.keys(o).length) n.refOverrides = o; else delete n.refOverrides; }
    return [k, n];
  }));
  return { ...p, storyboard: { ...b, slots, shots } };
}

/** Reference ids kept for a shot after its list is edited (clip slot kept; pins of dropped references removed). */
export function withRefs(b: Storyboard, s: Shot, slotIds: string[]): Shot {
  const ids = [...new Set(slotIds)].filter((id) => b.slots[id] && id !== s.clipSlot);
  const n: Shot = { ...s, slotIds: s.clipSlot && b.slots[s.clipSlot] ? [...ids, s.clipSlot] : ids };
  const keep = new Set(shotRefIds(b, n));
  if (n.references) {
    const refs = n.references.filter((r) => ids.includes(r.slotId));
    if (refs.length) n.references = refs; else delete n.references;
  }
  if (n.refOverrides) {
    const o = Object.fromEntries(Object.entries(n.refOverrides).filter(([k]) => keep.has(k)));
    if (Object.keys(o).length) n.refOverrides = o; else delete n.refOverrides;
  }
  return n;
}

/** The pinned version's number ("v2") for labels, if the shot pins `slotId`. */
export function pinLabel(p: Project, s: Shot, slotId: string): string | undefined {
  const pin = pinOf(p, s, slotId), slot = p.storyboard?.slots[slotId];
  if (!pin || !slot) return undefined;
  return `v${versionsOf(p, slot).findIndex((v) => v.id === pin) + 1}`;
}

/** Labels for the reference roles (V2-SB-120), as the attach list shows them. */
export const ROLE_LABEL: Record<ReferenceRole, string> = {
  "start-frame": "Start frame", "end-frame": "End frame", identity: "Identity", look: "Look", detail: "Details only",
};
/** What the model is told to do with an image of each role, in the References block. */
const ROLE_USE: Record<ReferenceRole, string> = {
  "start-frame": "START FRAME: the clip opens on exactly this image",
  "end-frame": "END FRAME: the clip ends on exactly this image",
  identity: "reference only, not a frame: keep this identity (face, body, clothes)",
  look: "reference only, not a frame: overall look (palette, light, texture) only",
  detail: "reference only, not a frame: materials, colours and objects only; do not reproduce its framing or wide view",
};

/** One numbered image to attach to a shot's clip generation (`no` is 1-based). */
export interface AttachItem { no: number; slotId: string; role: ReferenceRole; note?: string; inferred: boolean }

/** The role a slot plays when the shot does not say (frame / last frame → start frame, character → identity …). */
export function inferredRole(slot: AssetSlot): ReferenceRole {
  return inferReferenceRole(slot.type, slot.source.type === "lastFrame");
}

/**
 * The images to attach for a shot's clip, in order (V2-SB-120): the shot's explicit `references` first, then its
 * other reference slots in `slotIds` order with inferred roles. Never the clip slot, never media-layer assets (they
 * are composited later). Only one start frame and one end frame: an inferred extra one is used as details only.
 */
export function attachList(b: Storyboard, shot: Shot): AttachItem[] {
  const ok = (id: string) => !!b.slots[id] && id !== shot.clipSlot && shot.slotIds.includes(id);
  const explicit: ShotReference[] = (shot.references ?? []).filter((r) => ok(r.slotId));
  const seen = new Set(explicit.map((r) => r.slotId));
  const items: Omit<AttachItem, "no">[] = explicit.map((r) => ({ slotId: r.slotId, role: r.role, ...(r.note ? { note: r.note } : {}), inferred: false }));
  for (const id of shot.slotIds) {
    if (!ok(id) || seen.has(id)) continue;
    seen.add(id);
    let role = inferredRole(b.slots[id]);
    if ((role === "start-frame" || role === "end-frame") && items.some((x) => x.role === role)) role = "detail";
    items.push({ slotId: id, role, inferred: true });
  }
  return items.map((x, i) => ({ ...x, no: i + 1 }));
}

/**
 * The numbered "References:" block a clip prompt starts with (V2-SB-120): one line per attached image saying whether
 * it is the start / end frame or only a reference and what to take from it. Empty when nothing is attached.
 */
export function referencesBlock(b: Storyboard, shot: Shot): string {
  const items = attachList(b, shot);
  if (!items.length) return "";
  const lines = items.map((x) => `Image ${x.no} (${b.slots[x.slotId].name}): ${ROLE_USE[x.role]}${x.note ? `. ${x.note.replace(/\.$/, "")}` : ""}.`);
  if (!items.some((x) => x.role === "start-frame")) lines.push("No image is the start frame: compose the opening frame from the prompt.");
  if (shot.camera) lines.push(`Framing, first frame to last: ${shot.camera.replace(/\.$/, "")}.`);
  return `References:\n${lines.join("\n")}`;
}

/** True when a prompt already starts with (or contains a line starting) "References:". */
export const hasReferencesBlock = (prompt: string) => /^\s*References\s*:/im.test(prompt);

/** The clip prompt to copy: the shot's prompt with the References block prepended unless it already has one. */
export function promptWithReferences(b: Storyboard, shot: Shot): string {
  const block = referencesBlock(b, shot);
  return !block || hasReferencesBlock(shot.prompt) ? shot.prompt : `${block}\n\n${shot.prompt}`;
}

/** The media version a shot uses for each image in its attach list (pins respected). */
export function attachVersions(p: Project, shot: Shot): { item: AttachItem; versionId?: string }[] {
  const b = p.storyboard;
  return b ? attachList(b, shot).map((item) => ({ item, versionId: refVersionOf(p, shot, item.slotId) })) : [];
}
