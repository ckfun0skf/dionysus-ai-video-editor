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
import { ASSET_REFERENCE_ROLES, assetStateId, inferReferenceRole, STATEFUL_ASSET_TYPES, stateBaseNote, STORY_ASSET_TYPES, type AssetRefRole, type ReferenceRole, type StoryAssetType } from "./storyJson";

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
  /** Roles / notes per reference id (V2-SB-123); entries for ids not in the references are dropped. */
  refRoles?: Record<string, AssetRefRole>;
  /** V2-SB-133: video slots: seconds to generate (0.5–120); null clears it. */
  genDurationSec?: number | null;
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
  // V2-SB-136: a state is made from its base, never from another state of it.
  const base = b.slots[id]?.stateOf;
  return Object.values(b.slots).filter((s) => s.id !== id && !usesId(s.id) && !(base && s.stateOf === base));
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
  const states = statesOf(b, id);
  if (states.length) return `It has ${states.length > 1 ? "states" : "a state"} (${states.map((x) => x.stateName ?? x.id).join(", ")}). Delete ${states.length > 1 ? "them" : "it"} first.`;
  if (u.clipOf.length) return `It is the clip of ${u.clipOf.map(no).join(", ")}. Switch ${u.clipOf.length > 1 ? "those shots" : "that shot"} to another clip first.`;
  if (u.layerOf.length) return `It is a layer in ${u.layerOf.map(no).join(", ")}. Remove the layer first.`;
  return undefined;
}

/** V2-SB-136: the states of slot `id` (slots "<id>@<state>"), in board order. */
export function statesOf(b: Storyboard, id: string): AssetSlot[] {
  return Object.values(b.slots).filter((x) => x.stateOf === id);
}

function cleanSlot(b: Storyboard, s: AssetSlot, patch: SlotPatch, hasVersions: boolean): AssetSlot {
  const n: AssetSlot = { ...s };
  if (patch.name !== undefined && patch.name.trim()) n.name = patch.name.trim().slice(0, 80);
  // V2-SB-136: a state keeps its base's type and aspect, and is always made from the base (attached first).
  const base = s.stateOf ? b.slots[s.stateOf] : undefined;
  if (base) patch = { ...patch, type: undefined, aspect: undefined, ...(patch.references ? { references: [base.id, ...patch.references.filter((r) => r !== base.id)] } : {}) };
  // A type change must keep the backing asset's media kind once versions exist, and a clip slot keeps its type.
  if (patch.type && STORY_ASSET_TYPES.includes(patch.type) && patch.type !== s.type) {
    const clip = Object.values(b.shots).some((x) => x.clipSlot === s.id);
    // V2-SB-136: an asset with states stays image-like.
    const stateful = statesOf(b, s.id).length > 0 && !STATEFUL_ASSET_TYPES.includes(patch.type);
    if (!clip && !stateful && (!hasVersions || kindForSlot(patch.type) === kindForSlot(s.type))) n.type = patch.type;
  }
  if (patch.aspect !== undefined && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(patch.aspect.trim())) n.aspect = patch.aspect.trim();
  if (patch.prompt !== undefined) n.prompt = patch.prompt;
  if (patch.notes !== undefined) { if (patch.notes.trim()) n.notes = patch.notes; else delete n.notes; }
  if (patch.references) { const ok = new Set(referenceChoices(b, s.id).map((x) => x.id)); n.references = [...new Set(patch.references)].filter((r) => ok.has(r)); }
  if (patch.refRoles) n.refRoles = patch.refRoles;
  setRefRoles(n, n.refRoles);
  if (patch.source && s.source.type !== "lastFrame") n.source = { type: patch.source };
  if (patch.qa) n.qa = patch.qa.filter((q) => q.text.trim()).map((q) => ({ id: q.id, text: q.text.trim() }));
  if (patch.genDurationSec === null) delete n.genDurationSec;
  else if (patch.genDurationSec !== undefined && Number.isFinite(patch.genDurationSec)) n.genDurationSec = Math.min(120, Math.max(0.5, Math.round(patch.genDurationSec * 10) / 10));
  if (n.type !== "video") delete n.genDurationSec;
  return n;
}

/** Keep only valid role entries for ids still in `n.references` (one base image at most); drop the map when empty. */
function setRefRoles(n: AssetSlot, roles: Record<string, AssetRefRole> | undefined) {
  const out: Record<string, AssetRefRole> = {};
  let base = false;
  for (const id of n.references) {
    const r = roles?.[id];
    if (!r) continue;
    let role = r.role && ASSET_REFERENCE_ROLES.includes(r.role) ? r.role : undefined;
    if (role === "start-frame") { if (base) role = "detail"; base = true; }
    const note = r.note?.trim();
    if (role || note) out[id] = { ...(role ? { role } : {}), ...(note ? { note } : {}) };
  }
  if (Object.keys(out).length) n.refRoles = out; else delete n.refRoles;
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
  const states = statesOf(b, id);
  const n = cleanSlot(b, s, patch, versionsOf(p, s).length > 0 || states.some((x) => versionsOf(p, x).length > 0));
  if (JSON.stringify(n) === JSON.stringify(s)) return p;
  let assets = p.assets;
  const rename = (slot: AssetSlot, name: string) => { const a = slot.assetId ? assets[slot.assetId] : undefined; if (a && a.name === slot.name && name !== slot.name) assets = { ...assets, [a.id]: { ...a, name } }; };
  rename(s, n.name);
  const slots = { ...b.slots, [id]: n };
  // V2-SB-136: states follow their base's type and aspect, and its name while they still carry it.
  for (const x of states) {
    const name = x.name === stateLabel(s.name, x) ? stateLabel(n.name, x) : x.name;
    if (name === x.name && x.type === n.type && x.aspect === n.aspect) continue;
    rename(x, name);
    slots[x.id] = { ...x, name, type: n.type, aspect: n.aspect };
  }
  return { ...p, assets, storyboard: { ...b, slots } };
}

/** V2-SB-136: a state's default name, "<base name> · <state name>". */
const stateLabel = (baseName: string, x: AssetSlot) => `${baseName} · ${x.stateName ?? x.id.slice(x.id.indexOf("@") + 1)}`;

/** V2-SB-136: why slot `baseId` can't have states, if it can't. */
export function stateBlock(b: Storyboard, baseId: string): string | undefined {
  const base = b.slots[baseId];
  if (!base) return "That asset is gone.";
  if (base.stateOf) return "A state can't have states of its own; add the state to the base asset.";
  if (base.keyframeOf) return "A keyframe can't have states.";
  if (!STATEFUL_ASSET_TYPES.includes(base.type)) return `Only ${STATEFUL_ASSET_TYPES.join(", ")} assets can have states.`;
  return undefined;
}
/** V2-SB-136: the id of a new state named `name` of slot `baseId` ("After rain" → "<baseId>@after-rain"), unique. */
export function nextStateId(b: Storyboard, baseId: string, name: string): string {
  const key = name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "state";
  for (let i = 1; ; i += 1) { const id = assetStateId(baseId, i > 1 ? `${key}-${i}` : key); if (!b.slots[id]) return id; }
}

/**
 * V2-SB-136: add state `name` of slot `baseId` as slot "<baseId>@<key>": same type and aspect, made from the base
 * (attached first, with a note to keep what it is), its own prompt and versions.
 */
export function addState(p: Project, baseId: string, name: string, prompt = ""): Project {
  name = name.replace(/\s+/g, " ").slice(0, 40);
  const b = p.storyboard, base = b?.slots[baseId];
  if (!b || !base || !name.trim() || stateBlock(b, baseId)) return p;
  const id = nextStateId(b, baseId, name);
  const slot: AssetSlot = {
    id, name: `${base.name} · ${name.trim()}`, type: base.type, aspect: base.aspect,
    prompt: prompt.trim() || `The same ${base.name}, ${name.trim()}.`, references: [baseId],
    refRoles: { [baseId]: { ...(base.type === "character" ? { role: "identity" as const } : {}), note: stateBaseNote(base.name) } },
    source: { type: "generate" }, qa: [], stateOf: baseId, stateName: name.trim(), ...(base.params ? { params: structuredClone(base.params) } : {}),
  };
  return { ...p, storyboard: { ...b, slots: { ...b.slots, [id]: slot } } };
}

/** Delete an asset slot: it leaves every shot's and slot's references. Its versions stay in the media library. */
export function deleteSlot(p: Project, id: string): Project {
  const b = p.storyboard;
  if (!b?.slots[id] || slotDeleteBlock(b, id)) return p;
  const { [id]: _gone, ...rest } = b.slots;
  const slots = Object.fromEntries(Object.entries(rest).map(([k, s]) => {
    if (!s.references.includes(id)) return [k, s];
    const n: AssetSlot = { ...s, references: s.references.filter((r) => r !== id) };
    setRefRoles(n, n.refRoles);
    return [k, n];
  }));
  const shots = Object.fromEntries(Object.entries(b.shots).map(([k, s]) => {
    if (!s.slotIds.includes(id) && !s.refOverrides?.[id] && !s.references?.some((r) => r.slotId === id)) return [k, s];
    const n: Shot = { ...s, slotIds: s.slotIds.filter((r) => r !== id) };
    if (n.keyframe === id) delete n.keyframe;
    if (n.references) { const refs = n.references.filter((r) => r.slotId !== id); if (refs.length) n.references = refs; else delete n.references; }
    if (n.refOverrides?.[id]) { const { [id]: _p, ...o } = n.refOverrides; if (Object.keys(o).length) n.refOverrides = o; else delete n.refOverrides; }
    return [k, n];
  }));
  const next: Storyboard = { ...b, slots, shots };
  // V2-SB-125: the asset's audio cues go with it.
  const audio = b.audio?.filter((c) => c.asset !== id);
  if (audio?.length) next.audio = audio; else delete next.audio;
  return { ...p, storyboard: next };
}

/**
 * Keyframe then animate (V2-SB-124): add a frame slot `id` as the opening still of shot `shotId`, made from the shot's
 * current references, and attach it as the clip's start frame (Image 1). AI shots only; one keyframe per shot.
 */
export function addKeyframe(p: Project, shotId: string, id: string): Project {
  const b = p.storyboard, s = b?.shots[shotId];
  if (!b || !s || s.render || s.keyframe || b.slots[id] || b.shots[id]) return p;
  const slot: AssetSlot = {
    id, name: `Keyframe · ${s.title}`, type: "frame", aspect: b.meta.aspect || "16:9",
    prompt: `The opening frame of shot ${b.order.indexOf(shotId) + 1}, as one still image.${s.description ? ` ${s.description}` : ""}`,
    references: s.slotIds.filter((x) => b.slots[x] && x !== s.clipSlot), source: { type: "generate" }, qa: [], keyframeOf: shotId,
  };
  const shot: Shot = { ...s, keyframe: id, slotIds: [id, ...s.slotIds] };
  // The keyframe is now the start frame: a start frame stated before becomes details only.
  if (shot.references?.some((r) => r.role === "start-frame")) shot.references = shot.references.map((r) => (r.role === "start-frame" ? { ...r, role: "detail" } : r));
  return { ...p, storyboard: { ...b, slots: { ...b.slots, [id]: slot }, shots: { ...b.shots, [shotId]: shot } } };
}

/** Reference ids kept for a shot after its list is edited (clip slot kept; pins of dropped references removed). */
export function withRefs(b: Storyboard, s: Shot, slotIds: string[]): Shot {
  const ids = [...new Set(slotIds)].filter((id) => b.slots[id] && id !== s.clipSlot);
  const n: Shot = { ...s, slotIds: s.clipSlot && b.slots[s.clipSlot] ? [...ids, s.clipSlot] : ids };
  if (n.keyframe && !ids.includes(n.keyframe)) delete n.keyframe;
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
  const kf = shot.keyframe && ok(shot.keyframe) ? shot.keyframe : undefined;
  const items: Omit<AttachItem, "no">[] = [];
  // V2-SB-124: the keyframe is always Image 1 and the only start frame.
  if (kf) { items.push({ slotId: kf, role: "start-frame", inferred: false }); seen.add(kf); }
  for (const r of explicit) if (r.slotId !== kf) items.push({ slotId: r.slotId, role: kf && r.role === "start-frame" ? "detail" : r.role, ...(r.note ? { note: r.note } : {}), inferred: false });
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

/** True when a prompt already has a line starting "Dialogue:". */
export const hasDialogueBlock = (prompt: string) => /^\s*Dialogue\s*:/im.test(prompt);

/**
 * V2-SB-135: the "Dialogue:" block for a shot with dialogue lines: each line with who says it and how. On-screen
 * lines are spoken in frame with lip-sync; off-screen lines are heard but nobody in frame speaks them (no lip
 * movement); a line with its own recorded "dialogue" cue is added in the edit, so the clip must stay silent for it.
 * Empty for plain-text dialogue (the prompt carries it) and no dialogue.
 */
export function dialogueBlock(b: Storyboard, shot: Shot): string {
  if (!shot.lines?.length) return "";
  const recorded = new Set((b.audio ?? []).filter((c) => c.kind === "dialogue" && c.from === shot.id && c.line).map((c) => c.line!));
  const rows = shot.lines.map((l, i) => {
    const who = l.speaker ?? (l.offscreen ? "A voice" : "Someone in frame");
    const how = recorded.has(i + 1) ? "recorded separately and added in the edit: do not voice it, and no one in frame moves their lips"
      : l.offscreen ? "OFF-SCREEN: heard, not seen; the speaker is not in frame and no one in frame moves their lips"
      : "on screen, lip-synced";
    return `${i + 1}. ${who} (${how}): "${l.text}"`;
  });
  return `Dialogue:\n${rows.join("\n")}`;
}

/**
 * The clip prompt to copy: the shot's prompt with the References block prepended unless it already has one, and
 * (V2-SB-135) the Dialogue block appended for dialogue lines unless the prompt already has one.
 */
export function promptWithReferences(b: Storyboard, shot: Shot): string {
  const block = referencesBlock(b, shot), lines = dialogueBlock(b, shot);
  const body = !lines || hasDialogueBlock(shot.prompt) ? shot.prompt : `${shot.prompt}\n\n${lines}`;
  return !block || hasReferencesBlock(shot.prompt) ? body : `${block}\n\n${body}`;
}

/** The media version a shot (pins respected) or an asset (selected versions) uses for each image in its attach list. */
export function attachVersions(p: Project, owner: Shot | AssetSlot): { item: AttachItem; versionId?: string }[] {
  const b = p.storyboard;
  if (!b) return [];
  if (isShot(owner)) return attachList(b, owner).map((item) => ({ item, versionId: refVersionOf(p, owner, item.slotId) }));
  return slotAttachList(b, owner).map((item) => ({ item, versionId: refVersionOf(p, undefined, item.slotId) }));
}

const isShot = (o: Shot | AssetSlot): o is Shot => "slotIds" in o;

/** For an asset's image generation, a start frame is the base image to edit, never the opening of a clip. */
const ASSET_ROLE_USE: Record<ReferenceRole, string> = {
  ...ROLE_USE,
  "start-frame": "BASE IMAGE: start from exactly this image and change only what the prompt asks",
  identity: "reference only: keep this identity (face, body, clothes)",
  look: "reference only: overall look (palette, light, texture) only",
  detail: "reference only: materials, colours and objects only; do not reproduce its framing or wide view",
};
/** Asset attach-list labels: "Start frame" reads as "Base image" when generating an image (V2-SB-123). */
export const ASSET_ROLE_LABEL: Record<ReferenceRole, string> = { ...ROLE_LABEL, "start-frame": "Base image" };

/** The role an asset's reference plays when the asset does not say: like a shot's, but there is no end frame. */
export function inferredAssetRole(ref: AssetSlot): ReferenceRole {
  const r = inferredRole(ref);
  return r === "end-frame" ? "detail" : r;
}

/**
 * The images to attach when generating an asset (V2-SB-123): its `references` in order, each with its stated role
 * or one inferred from the referenced asset's type. Only one base image: an inferred extra one is details only.
 */
export function slotAttachList(b: Storyboard, slot: AssetSlot): AttachItem[] {
  const items: AttachItem[] = [];
  for (const id of slot.references) {
    if (!b.slots[id] || id === slot.id) continue;
    const meta = slot.refRoles?.[id];
    let role = meta?.role ?? inferredAssetRole(b.slots[id]);
    if (role === "start-frame" && items.some((x) => x.role === "start-frame")) role = "detail";
    items.push({ no: items.length + 1, slotId: id, role, ...(meta?.note ? { note: meta.note } : {}), inferred: !meta?.role });
  }
  return items;
}

/** The "References:" block an asset image prompt starts with (V2-SB-123). Empty when the asset has no references. */
export function slotReferencesBlock(b: Storyboard, slot: AssetSlot): string {
  const items = slotAttachList(b, slot);
  if (!items.length) return "";
  const lines = items.map((x) => `Image ${x.no} (${b.slots[x.slotId].name}): ${ASSET_ROLE_USE[x.role]}${x.note ? `. ${x.note.replace(/\.$/, "")}` : ""}.`);
  return `References:\n${lines.join("\n")}`;
}

/** The asset prompt to copy: its prompt with the References block prepended unless it already has one. */
export function slotPromptWithReferences(b: Storyboard, slot: AssetSlot): string {
  const block = slotReferencesBlock(b, slot);
  return !block || hasReferencesBlock(slot.prompt) ? slot.prompt : `${block}\n\n${slot.prompt}`;
}
