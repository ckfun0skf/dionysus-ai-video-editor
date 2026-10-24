/**
 * Storyboard domain (schema 3.1, V2-CUT-01/09). Pure data + pure ops on a Project.
 * Uploads live as ordinary project Asset versions (one backing asset per slot / per shot clip),
 * so selection is `asset.selectedVersionId`. The storyboard keeps what the timeline doesn't need:
 * prompts, QA checks, and per-version facts frozen at upload time (inputs used, QA results, the
 * clip version a last frame came from). Staleness ("may not match") is derived, never stored.
 */
import { isStill, newId, type AssetVersion, type Composition, type MediaKind, type MediaRef, type Placement, type Project } from "./model";
import { mainTrack } from "./ops";
import { assetRefId, keyframeId, type AssetRefRole, type ReferenceRole, type ShotRender, type StoryAssetRef, type StoryAssetType, type StoryConnection, type StoryDoc, type StoryEffect, type StoryLayer, type StoryMeta } from "./storyJson";
import { followStoryLinks } from "./storyLinks";
import { orderSteps } from "./storySteps";
import { TICKS_PER_SECOND } from "./time";

export interface QaCheck { id: string; text: string }
export type QaResult = "pass" | "fail";
export type SlotSource = { type: "generate" } | { type: "upload" } | { type: "lastFrame"; shotId: string };

/** A reference asset the story needs (character sheet, location, last frame of shot X …). */
export interface AssetSlot {
  id: string; name: string; type: StoryAssetType; aspect: string; prompt: string;
  /** Other slots this one is generated from, in attach order. */
  references: string[];
  /** V2-SB-123: role / note per reference id (absent or no `role` = inferred from the referenced slot's type). */
  refRoles?: Record<string, AssetRefRole>;
  source: SlotSource; qa: QaCheck[]; notes?: string;
  /** Backing project asset; created on first upload. */
  assetId?: string;
  skipped?: boolean;
  /** V2-SB-124: this slot is the keyframe of that shot (its clip's start frame, made first). */
  keyframeOf?: string;
}

export interface Shot {
  id: string; title: string; description: string; durationSec: number; prompt: string;
  slotIds: string[]; qa: QaCheck[]; camera?: string; dialogue?: string;
  /**
   * Backing asset holding the clip versions; created on first upload. For `html` and `still` shots it is the
   * `clipSlot`'s asset, so the shot uses whatever version is selected there.
   */
  assetId?: string;
  skipped?: boolean;
  /** v1.1: how the clip is made (absent = "ai", a generated video). */
  render?: Exclude<ShotRender, "ai">;
  /** v1.1: the html (render html) or image (render still) slot that is the shot's clip. */
  clipSlot?: string;
  /** The shot's own AI clip asset, kept aside while the shot is made as html or still (V2-CUT-02). */
  ownAssetId?: string;
  /**
   * Per-shot reference overrides (V2-CUT-05): slot id → version id this shot uses instead of the slot's selected
   * version. Applies to the shot's reference assets and media layers, never to its clip slot.
   */
  refOverrides?: Record<string, string>;
  /** v1.1, kept as written: placed on the timeline by "Send to timeline" (see domain/storySend). */
  layers?: StoryLayer[];
  captions?: boolean;
  effects?: StoryEffect[];
  /**
   * V2-SB-120: the images to attach to the clip generation, in order ("Image 1" first), with their roles. Absent = the
   * shot's reference slots in `slotIds` order with roles inferred from the slot type (see storyRefs.attachList).
   */
  references?: ShotReference[];
  /**
   * V2-SB-121: the length to ask the video model for, when it differs from `durationSec` (models that only render
   * fixed lengths). Uploads longer than `durationSec` are offered a trim.
   */
  genDurationSec?: number;
  /**
   * V2-SB-124: keyframe then animate. The frame slot made first and attached as the clip's start frame (Image 1); it is
   * also in `slotIds`, so the clip is flagged when the keyframe changes.
   */
  keyframe?: string;
}

/** One numbered image for a shot's clip generation and how the model should use it. */
export interface ShotReference { slotId: string; role: ReferenceRole; note?: string }

/** Facts about one uploaded version, frozen when it was added. */
export interface VersionInfo {
  /** Slot versions this version was made from (references / shot assets), at upload time. */
  inputs: { slotId: string; versionId: string }[];
  /** For last-frame slots: the clip version the frame was extracted from. */
  derivedFrom?: { shotId: string; versionId: string };
  qa?: Record<string, QaResult>;
  model?: string;
  /** V2-SB-121: the part of a video version the shot uses (source in and out). Absent = the whole clip. */
  trim?: VersionTrim;
}

/** Source range of a video version, in ticks (V2-SB-121). */
export interface VersionTrim { inTicks: number; outTicks: number }

/** A trim clamped to a clip `durTicks` long; undefined when it is missing or covers the whole clip. */
export function normTrim(t: VersionTrim | undefined, durTicks: number | undefined): VersionTrim | undefined {
  if (!t || !durTicks || !Number.isFinite(t.inTicks) || !Number.isFinite(t.outTicks)) return undefined;
  const inTicks = Math.round(Math.min(Math.max(0, t.inTicks), durTicks - 1));
  const outTicks = Math.round(Math.min(Math.max(inTicks + 1, t.outTicks), durTicks));
  return inTicks === 0 && outTicks === durTicks ? undefined : { inTicks, outTicks };
}

/** The part of a video version the storyboard uses: its trim, else the whole clip. Undefined for media without a length. */
export function versionSpan(b: Storyboard | undefined, v: AssetVersion | undefined): { inTicks: number; lenTicks: number } | undefined {
  const d = v?.media.durationTicks;
  if (!v || !d) return undefined;
  const t = normTrim(b?.versions[v.id]?.trim, d);
  return t ? { inTicks: t.inTicks, lenTicks: t.outTicks - t.inTicks } : { inTicks: 0, lenTicks: d };
}

export interface Storyboard {
  format: "dionysus.storyboard/1";
  meta: StoryMeta;
  order: string[];
  shots: Record<string, Shot>;
  slots: Record<string, AssetSlot>;
  connections: StoryConnection[];
  versions: Record<string, VersionInfo>;
  /** Production step order chosen by the user (step keys, V2-CUT-07); always applied in dependency order. */
  stepOrder?: string[];
}

/** `{ refRoles }` from an asset's object-form references (V2-SB-123), or nothing when none has a role or note. */
function refRolesOf(refs: StoryAssetRef[]): { refRoles?: Record<string, AssetRefRole> } {
  const out: Record<string, AssetRefRole> = {};
  for (const r of refs) if (typeof r !== "string" && (r.role || r.note)) out[r.asset] = { ...(r.role ? { role: r.role } : {}), ...(r.note ? { note: r.note } : {}) };
  return Object.keys(out).length ? { refRoles: out } : {};
}
const qaList = (owner: string, texts: string[]): QaCheck[] => texts.map((text, i) => ({ id: `${owner}.qa${i + 1}`, text }));

/** Build a storyboard from a validated StoryDoc (see storyJson.validateStoryboard). */
export function storyboardFromDoc(doc: StoryDoc): Storyboard {
  const slots: Record<string, AssetSlot> = {};
  for (const a of doc.assets) {
    slots[a.id] = {
      id: a.id, name: a.name, type: a.type, aspect: a.aspect, prompt: a.prompt, references: a.references.map(assetRefId),
      source: a.source.type === "lastFrame" ? { type: "lastFrame", shotId: a.source.shot } : { type: a.source.type },
      qa: qaList(a.id, a.qa), ...(a.notes ? { notes: a.notes } : {}),
      ...refRolesOf(a.references),
    };
  }
  const shots: Record<string, Shot> = {};
  for (const s of doc.shots) {
    shots[s.id] = {
      id: s.id, title: s.title, description: s.description, durationSec: s.durationSec, prompt: s.prompt,
      slotIds: [...s.assets], qa: qaList(s.id, s.qa), ...(s.camera ? { camera: s.camera } : {}), ...(s.dialogue ? { dialogue: s.dialogue } : {}),
      ...(s.render && s.render !== "ai" && s.clip && slots[s.clip] ? { render: s.render, clipSlot: s.clip } : {}),
      ...(s.layers?.length ? { layers: structuredClone(s.layers) } : {}),
      ...(s.captions ? { captions: true } : {}),
      ...(s.effects?.length ? { effects: structuredClone(s.effects) } : {}),
      ...(s.genDurationSec ? { genDurationSec: s.genDurationSec } : {}),
      ...(s.references?.length ? { references: s.references.map((r) => ({ slotId: r.asset, role: r.role, ...(r.note ? { note: r.note } : {}) })) } : {}),
    };
    if (shots[s.id].clipSlot && !shots[s.id].slotIds.includes(shots[s.id].clipSlot!)) shots[s.id].slotIds.push(shots[s.id].clipSlot!);
    if (s.keyframe) {
      const id = keyframeId(s.id);
      slots[id] = {
        id, name: `Keyframe · ${s.title}`, type: "frame", aspect: doc.meta.aspect, prompt: s.keyframe.prompt, references: s.keyframe.references.map(assetRefId),
        source: { type: "generate" }, qa: qaList(id, s.keyframe.qa), keyframeOf: s.id, ...refRolesOf(s.keyframe.references),
      };
      shots[s.id].keyframe = id;
      shots[s.id].slotIds.unshift(id);
    }
  }
  return { format: "dionysus.storyboard/1", meta: structuredClone(doc.meta), order: doc.shots.map((s) => s.id), shots, slots, connections: doc.connections.map((c) => structuredClone(c)), versions: {} };
}

export function setStoryboard(p: Project, board: Storyboard | undefined): Project {
  const next = { ...p };
  if (board) next.storyboard = board; else delete next.storyboard;
  return next;
}

/** Selected version id of a slot or shot (via its backing asset). */
export function selectedOf(p: Project, owner: { assetId?: string }): string | undefined {
  const a = owner.assetId ? p.assets[owner.assetId] : undefined;
  return a?.selectedVersionId ?? a?.versions.at(-1)?.id;
}

export function versionsOf(p: Project, owner: { assetId?: string }): AssetVersion[] {
  return (owner.assetId && p.assets[owner.assetId]?.versions) || [];
}

/** The version a shot pins for reference slot `slotId`, when the pin is valid (V2-CUT-05). */
export function pinOf(p: Project, shot: Shot | undefined, slotId: string): string | undefined {
  const v = shot?.refOverrides?.[slotId];
  const slot = p.storyboard?.slots[slotId];
  return v && slot && slotId !== shot!.clipSlot && versionsOf(p, slot).some((x) => x.id === v) ? v : undefined;
}

/** The version of reference slot `slotId` that shot `shot` uses: its pin, else the slot's selected version. */
export function refVersionOf(p: Project, shot: Shot | undefined, slotId: string): string | undefined {
  const slot = p.storyboard?.slots[slotId];
  return slot ? pinOf(p, shot, slotId) ?? selectedOf(p, slot) : undefined;
}

/** Linked layer placements in `c` whose shot pins the slot backed by `assetId` (they keep their version). */
export function pinnedLayers(p: Project, c: Composition, assetId: string): Map<string, string> {
  const out = new Map<string, string>();
  const b = p.storyboard;
  const slot = b && Object.values(b.slots).find((s) => s.assetId === assetId);
  if (!b || !slot || !Object.values(b.shots).some((s) => s.refOverrides?.[slot.id])) return out;
  const anchors = new Map<string, string>();
  for (const t of c.tracks) for (const pl of t.placements) if (pl.storyShot) anchors.set(pl.id, pl.storyShot);
  for (const t of c.tracks) for (const pl of t.placements) {
    if (pl.source.assetId !== assetId || !pl.storyLink) continue;
    const v = pinOf(p, b.shots[anchors.get(pl.storyLink.anchor) ?? ""], slot.id);
    if (v) out.set(pl.id, v);
  }
  return out;
}

export const kindForSlot = (t: StoryAssetType): MediaKind => (t === "video" ? "video" : t === "audio" ? "audio" : t === "html" ? "html" : "image");

export type Target = { slot: string } | { shot: string };

/**
 * Upload a new version into a slot or shot and select it. Inputs (and the last-frame source for
 * derived slots) are frozen from the current selections so later changes can be detected.
 */
export function addStoryVersion(p: Project, target: Target, media: MediaRef, opts: { versionId?: string; model?: string; now?: string; derivedFrom?: { shotId: string; versionId: string }; trim?: VersionTrim } = {}): Project {
  const b = p.storyboard;
  if (!b) return p;
  // An html or still shot has no clip of its own: its versions live on the clip slot.
  const clipSlot = "shot" in target ? b.shots[target.shot]?.clipSlot : undefined;
  if (clipSlot) return addStoryVersion(p, { slot: clipSlot }, media, opts);
  const isSlot = "slot" in target;
  const owner = isSlot ? b.slots[target.slot] : b.shots[target.shot];
  if (!owner) return p;
  const inputIds = isSlot ? (owner as AssetSlot).references : (owner as Shot).slotIds;
  const inputs = inputIds.flatMap((slotId) => { const s = b.slots[slotId]; const v = s && (isSlot ? selectedOf(p, s) : refVersionOf(p, owner as Shot, slotId)); return v ? [{ slotId, versionId: v }] : []; });
  let derivedFrom = opts.derivedFrom;
  if (isSlot && !derivedFrom && (owner as AssetSlot).source.type === "lastFrame") {
    const shotId = ((owner as AssetSlot).source as { shotId: string }).shotId;
    const v = b.shots[shotId] && selectedOf(p, b.shots[shotId]);
    if (v) derivedFrom = { shotId, versionId: v };
  }
  const version: AssetVersion = {
    id: opts.versionId ?? newId("ver"), createdAt: opts.now ?? new Date().toISOString(), media,
    provenance: { source: derivedFrom ? "derived" : "manual-generation", promptText: owner.prompt || undefined, inputs: inputs.map((i) => ({ assetId: b.slots[i.slotId].assetId!, versionId: i.versionId })) },
  };
  const assetId = owner.assetId ?? newId("ast");
  const prev = p.assets[assetId];
  const name = isSlot ? (owner as AssetSlot).name : `${b.order.indexOf(owner.id) + 1}. ${(owner as Shot).title}`;
  const asset = prev ? { ...prev, versions: [...prev.versions, version], selectedVersionId: version.id }
    : { id: assetId, kind: isSlot ? kindForSlot((owner as AssetSlot).type) : ("video" as MediaKind), name, versions: [version], selectedVersionId: version.id };
  const trim = !isSlot && media.durationTicks ? normTrim(opts.trim, media.durationTicks) : undefined;
  const info: VersionInfo = { inputs, ...(derivedFrom ? { derivedFrom } : {}), ...(opts.model ? { model: opts.model } : {}), ...(trim ? { trim } : {}) };
  const nextOwner = { ...owner, assetId, skipped: undefined };
  const board: Storyboard = {
    ...b,
    slots: isSlot ? { ...b.slots, [owner.id]: nextOwner as AssetSlot } : b.slots,
    shots: isSlot ? withClipAsset(b.shots, owner.id, assetId) : { ...b.shots, [owner.id]: nextOwner as Shot },
    versions: { ...b.versions, [version.id]: info },
  };
  return syncPlacements({ ...p, assets: { ...p.assets, [assetId]: asset }, storyboard: board }, assetId);
}

/** Point html/still shots whose clip is `slotId` at its backing asset. */
function withClipAsset(shots: Record<string, Shot>, slotId: string, assetId: string): Record<string, Shot> {
  if (!Object.values(shots).some((s) => s.clipSlot === slotId && s.assetId !== assetId)) return shots;
  return Object.fromEntries(Object.entries(shots).map(([id, s]) => [id, s.clipSlot === slotId ? { ...s, assetId } : s]));
}

/** Select an existing version of a slot/shot backing asset. */
export function selectStoryVersion(p: Project, assetId: string, versionId: string): Project {
  const a = p.assets[assetId];
  if (!a || !a.versions.some((v) => v.id === versionId) || a.selectedVersionId === versionId) return p;
  return syncPlacements({ ...p, assets: { ...p.assets, [assetId]: { ...a, selectedVersionId: versionId } } }, assetId);
}

/**
 * Change (or clear) the trim of a shot clip version (V2-SB-121). When the version is in use, its timeline clips that
 * still show the old trimmed range take the new one (main track ripples); clips trimmed by hand keep their trims.
 */
export function setVersionTrim(p: Project, assetId: string, versionId: string, trim: VersionTrim | undefined): Project {
  const b = p.storyboard, a = p.assets[assetId];
  const v = a?.versions.find((x) => x.id === versionId);
  const info = b?.versions[versionId];
  if (!b || !v || !info || !v.media.durationTicks) return p;
  const t = normTrim(trim, v.media.durationTicks);
  if (JSON.stringify(t) === JSON.stringify(normTrim(info.trim, v.media.durationTicks))) return p;
  const before = versionSpan(b, v)!;
  const { trim: _old, ...rest } = info;
  const next = { ...p, storyboard: { ...b, versions: { ...b.versions, [versionId]: t ? { ...rest, trim: t } : rest } } };
  return a.selectedVersionId === versionId ? syncPlacements(next, assetId, { versionId, before }) : next;
}

/**
 * Linked placements (V2-CUT-04, V2-SB-R01): every timeline clip of a storyboard asset follows the
 * version picked on the board.
 * - An untrimmed clip (shows exactly the previous version's used range: the whole clip, or its V2-SB-121 trim) takes
 *   the new version's range, so switching back to a longer take restores it.
 * - A trimmed clip keeps its trims, clamped to the new media.
 * - On the main track, later clips ripple by the length change (no gap, no overlap). On other
 *   tracks a longer clip only grows up to the next clip.
 */
export function syncPlacements(p: Project, assetId: string, retrim?: { versionId: string; before: { inTicks: number; lenTicks: number } }): Project {
  const a = p.assets[assetId];
  const v = a?.versions.find((x) => x.id === a.selectedVersionId);
  if (!v) return p;
  const max = v.media.durationTicks;
  const span = versionSpan(p.storyboard, v);
  const stale = (pl: Placement) => pl.source.assetId === assetId && (pl.source.versionId !== v.id || retrim?.versionId === v.id);
  let changed = false;
  const compositions = { ...p.compositions };
  for (const [cid, c] of Object.entries(p.compositions)) {
    const mainId = mainTrack(c)?.id;
    const pinned = pinnedLayers(p, c, assetId);
    let compChanged = false;
    const tracks = c.tracks.map((t) => {
      if (!t.placements.some((pl) => stale(pl) && !pinned.has(pl.id))) return t;
      compChanged = true;
      let pls = [...t.placements].sort((x, y) => x.startTicks - y.startTicks);
      for (let i = 0; i < pls.length; i += 1) {
        const pl = pls[i];
        if (!stale(pl) || pinned.has(pl.id)) continue;
        const { storyTrim, ...rest } = pl;
        const next: Placement = { ...rest, source: { ...pl.source, versionId: v.id } };
        if (max && !isStill(pl)) {
          const speed = pl.speed ?? 1;
          const prev = pl.source.versionId === v.id && retrim ? retrim.before : versionSpan(p.storyboard, a.versions.find((x) => x.id === pl.source.versionId));
          // A trim remembered from an earlier clamp still applies if the clip was not edited since.
          const memo = storyTrim && storyTrim.clampedTo === pl.durationTicks && storyTrim.inTicks === pl.sourceInTicks ? storyTrim : undefined;
          const untrimmed = !memo && !pl.freeze && !!prev && pl.sourceInTicks === prev.inTicks && Math.abs(pl.durationTicks - Math.floor(prev.lenTicks / speed)) <= 1;
          if (untrimmed && span) next.sourceInTicks = span.inTicks;
          if (next.sourceInTicks >= max) next.sourceInTicks = 0;
          const room = Math.max(1, Math.floor((max - next.sourceInTicks) / speed));
          const want = memo?.durationTicks ?? pl.durationTicks;
          if (untrimmed) next.durationTicks = Math.max(1, Math.min(room, Math.floor((span?.lenTicks ?? max) / speed)));
          else if (pl.freeze) next.durationTicks = pl.durationTicks;
          else if (want > room) { next.durationTicks = room; next.storyTrim = { durationTicks: want, clampedTo: room, inTicks: next.sourceInTicks }; }
          else next.durationTicks = want;
          if (t.id !== mainId && next.durationTicks > pl.durationTicks) {
            const after = pls.find((o, j) => j > i && o.startTicks >= pl.startTicks + pl.durationTicks);
            if (after) next.durationTicks = Math.max(pl.durationTicks, Math.min(next.durationTicks, after.startTicks - pl.startTicks));
          }
          if (next.fadeInTicks && next.fadeInTicks > next.durationTicks) next.fadeInTicks = next.durationTicks;
          if (next.fadeOutTicks && next.fadeOutTicks > next.durationTicks) next.fadeOutTicks = next.durationTicks;
        }
        const delta = next.durationTicks - pl.durationTicks;
        const oldEnd = pl.startTicks + pl.durationTicks;
        pls = pls.map((o, j) => (j === i ? next : t.id === mainId && delta && j > i && o.startTicks >= oldEnd ? { ...o, startTicks: Math.max(0, o.startTicks + delta) } : o));
      }
      return { ...t, placements: pls };
    });
    if (compChanged) { changed = true; compositions[cid] = followStoryLinks(c, { ...c, tracks }); }
  }
  return changed ? { ...p, compositions } : p;
}

/** Selected clip length vs the planned shot length, when they differ by more than half a second (V2-SB-R06). */
export function shotLengthMismatch(p: Project, s: Shot): { actualSec: number; plannedSec: number } | undefined {
  const v = versionsOf(p, s).find((x) => x.id === selectedOf(p, s));
  const d = versionSpan(p.storyboard, v)?.lenTicks;
  if (!d || !s.durationSec) return undefined;
  const actualSec = d / TICKS_PER_SECOND;
  return Math.abs(actualSec - s.durationSec) > 0.5 ? { actualSec, plannedSec: s.durationSec } : undefined;
}

/** The storyboard shot or slot whose asset is `assetId`, with the selected version's number (timeline link chips, V2-SB-R05). */
export interface StoryLink { target: Target; label: string; versionNo: number; versionCount: number }
export function storyLinkOf(p: Project, assetId: string): StoryLink | undefined {
  const b = p.storyboard;
  if (!b) return undefined;
  const shot = Object.values(b.shots).find((s) => s.assetId === assetId);
  const slot = shot ? undefined : Object.values(b.slots).find((s) => s.assetId === assetId);
  const owner = shot ?? slot;
  if (!owner) return undefined;
  const vs = versionsOf(p, owner);
  const versionNo = vs.findIndex((v) => v.id === selectedOf(p, owner)) + 1;
  return shot
    ? { target: { shot: shot.id }, label: `Shot ${b.order.indexOf(shot.id) + 1}`, versionNo, versionCount: vs.length }
    : { target: { slot: slot!.id }, label: slot!.name, versionNo, versionCount: vs.length };
}

/** Linked timeline clips of `assetId` whose length differs between two project states (for the swap note). */
export function linkedLengthChanges(before: Project, after: Project, assetId: string): { placementId: string; fromTicks: number; toTicks: number }[] {
  const lengths = (p: Project) => new Map(Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements.filter((pl) => pl.source.assetId === assetId).map((pl) => [pl.id, pl.durationTicks] as const))));
  const was = lengths(before);
  return [...lengths(after)].flatMap(([placementId, toTicks]) => { const fromTicks = was.get(placementId); return fromTicks !== undefined && fromTicks !== toTicks ? [{ placementId, fromTicks, toTicks }] : []; });
}

/** Shots in story order with whether "Send to timeline" would add them. */
export type SendState = "ready" | "placed" | "missing" | "skipped";
export function sendPlan(p: Project): { shotId: string; assetId?: string; state: SendState }[] {
  const b = p.storyboard;
  if (!b) return [];
  const all = Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements));
  // A clip sent from the board names its shot; other clips of the asset (placed by hand, or sent before
  // V2-CUT-02) count for every shot showing it. Linked layers never do.
  const sentAs = new Set(all.flatMap((pl) => (pl.storyShot ? [pl.storyShot] : [])));
  const loose = new Set(all.filter((pl) => !pl.storyShot && !pl.storyLink).map((pl) => pl.source.assetId));
  return b.order.filter((id) => b.shots[id]).map((id) => {
    const s = b.shots[id];
    const placed = sentAs.has(id) || (!!s.assetId && loose.has(s.assetId));
    const state: SendState = s.skipped ? "skipped" : !s.assetId || !p.assets[s.assetId] ? "missing" : placed ? "placed" : "ready";
    return { shotId: id, assetId: s.assetId, state };
  });
}

export function setQaResult(p: Project, versionId: string, checkId: string, result: QaResult | undefined): Project {
  const b = p.storyboard, info = b?.versions[versionId];
  if (!b || !info) return p;
  const qa = { ...info.qa };
  if (result) qa[checkId] = result; else delete qa[checkId];
  return { ...p, storyboard: { ...b, versions: { ...b.versions, [versionId]: { ...info, qa } } } };
}

/** Why a slot or shot's selected version "may not match". Empty reasons = up to date. */
export interface Staleness { stale: boolean; reasons: string[] }
export interface StoryStatus { slots: Record<string, Staleness>; shots: Record<string, Staleness> }

/**
 * Derive "may not match" warnings. A version is stale when anything it was made from has since
 * changed (a different version is selected) or is itself stale — so a change propagates
 * transitively down every last-frame and reference chain.
 */
export function storyStatus(p: Project): StoryStatus {
  const b = p.storyboard;
  const out: StoryStatus = { slots: {}, shots: {} };
  if (!b) return out;
  const visiting = new Set<string>();
  const shotLabel = (id: string) => `shot ${b.order.indexOf(id) + 1}${b.shots[id] ? ` “${b.shots[id].title}”` : ""}`;
  const slotLabel = (id: string) => `“${b.slots[id]?.name ?? id}”`;
  const inputsReasons = (info: VersionInfo | undefined, ids: string[], user?: Shot) => {
    const reasons: string[] = [];
    for (const slotId of ids) {
      const s = b.slots[slotId];
      if (!s) continue;
      // A shot that pins a version of this reference compares against the pin (V2-CUT-05).
      const pin = pinOf(p, user, slotId);
      const cur = pin ?? selectedOf(p, s);
      const used = info?.inputs.find((i) => i.slotId === slotId)?.versionId;
      if (cur && used && used !== cur) reasons.push(pin ? `made with a different version of ${slotLabel(slotId)} than the one pinned for this shot` : `made with an older version of ${slotLabel(slotId)}`);
      else if (cur && info && !used) reasons.push(`made before ${slotLabel(slotId)} was uploaded`);
      else if ((!pin || pin === selectedOf(p, s)) && slot(slotId).stale) reasons.push(`${slotLabel(slotId)} may not match`);
    }
    return reasons;
  };
  const slot = (id: string): Staleness => {
    if (out.slots[id]) return out.slots[id];
    if (visiting.has(id)) return { stale: false, reasons: [] };
    visiting.add(id);
    const s = b.slots[id];
    const v = selectedOf(p, s);
    const info = v ? b.versions[v] : undefined;
    const reasons: string[] = [];
    if (v) {
      if (s.source.type === "lastFrame") {
        const src = b.shots[s.source.shotId];
        const cur = src && selectedOf(p, src);
        if (cur && info?.derivedFrom && info.derivedFrom.versionId !== cur) reasons.push(`taken from an older version of ${shotLabel(s.source.shotId)}`);
        else if (src && shot(src.id).stale) reasons.push(`${shotLabel(src.id)} may not match`);
      }
      reasons.push(...inputsReasons(info, s.references));
    }
    visiting.delete(id);
    return (out.slots[id] = { stale: reasons.length > 0, reasons });
  };
  const shot = (id: string): Staleness => {
    if (out.shots[id]) return out.shots[id];
    if (visiting.has(id)) return { stale: false, reasons: [] };
    visiting.add(id);
    const s = b.shots[id];
    const v = selectedOf(p, s);
    // An html/still shot is exactly its clip slot's selected version.
    const reasons = s.clipSlot ? [...slot(s.clipSlot).reasons] : v ? inputsReasons(b.versions[v], s.slotIds, s) : [];
    visiting.delete(id);
    return (out.shots[id] = { stale: reasons.length > 0, reasons });
  };
  Object.keys(b.slots).forEach(slot);
  Object.keys(b.shots).forEach(shot);
  return out;
}

/** Skip (or un-skip) a slot or shot in the production list. */
export function setStorySkipped(p: Project, target: Target, skipped: boolean): Project {
  const b = p.storyboard;
  if (!b) return p;
  const isSlot = "slot" in target;
  const owner = isSlot ? b.slots[target.slot] : b.shots[target.shot];
  if (!owner || !!owner.skipped === skipped) return p;
  const next = { ...owner, skipped: skipped || undefined };
  return { ...p, storyboard: isSlot ? { ...b, slots: { ...b.slots, [owner.id]: next as AssetSlot } } : { ...b, shots: { ...b.shots, [owner.id]: next as Shot } } };
}

/** One row of the production to-do list (V2-CUT-11). */
export type StepState = "todo" | "blocked" | "check" | "stale" | "done" | "skipped";
export interface ProductionStep { target: Target; key: string; state: StepState; blockedBy?: string; waitsFor?: string; qaDone: number; qaTotal: number }

/**
 * The production to-do list in a workable order: every asset comes before the shots that use it,
 * references before what is made from them, and a last-frame asset right after its source shot.
 * A step is done once a version is chosen, its checks have all passed, and nothing upstream changed.
 */
export function productionSteps(p: Project): ProductionStep[] {
  const b = p.storyboard;
  if (!b) return [];
  const status = storyStatus(p);
  const seen = new Set<string>();
  const out: ProductionStep[] = [];
  const state = (owner: AssetSlot | Shot, st: Staleness | undefined, blockedBy?: string, waitsFor?: string): Omit<ProductionStep, "target" | "key"> => {
    const v = selectedOf(p, owner);
    const qa = (v && b.versions[v]?.qa) || {};
    const qaDone = owner.qa.filter((q) => qa[q.id] === "pass").length;
    const base = { qaDone, qaTotal: owner.qa.length };
    if (owner.skipped) return { ...base, state: "skipped" };
    if (!v) return blockedBy ? { ...base, state: "blocked", blockedBy } : waitsFor ? { ...base, state: "blocked", waitsFor } : { ...base, state: "todo" };
    if (st?.stale) return { ...base, state: "stale" };
    return { ...base, state: qaDone < owner.qa.length ? "check" : "done" };
  };
  const slot = (id: string) => {
    const s = b.slots[id];
    if (!s || seen.has(`slot:${id}`)) return;
    seen.add(`slot:${id}`);
    s.references.forEach(slot);
    let blockedBy: string | undefined;
    if (s.source.type === "lastFrame") {
      shot(s.source.shotId);
      const src = b.shots[s.source.shotId];
      if (src && !selectedOf(p, src)) blockedBy = s.source.shotId;
    }
    out.push({ target: { slot: id }, key: `slot:${id}`, ...state(s, status.slots[id], blockedBy) });
  };
  const shot = (id: string) => {
    const s = b.shots[id];
    if (!s || seen.has(`shot:${id}`)) return;
    seen.add(`shot:${id}`);
    s.slotIds.forEach((x) => { if (x !== s.keyframe) slot(x); });
    (s.layers ?? []).forEach((l) => { if (l.type !== "text") slot(l.asset); }); // media-layer assets come before the shot too
    // V2-SB-124: the keyframe comes right before its clip (after the references it is made from).
    if (s.keyframe) slot(s.keyframe);
    // html/still shots: the step is checking the clip slot's version (its upload is the slot's own step).
    if (s.clipSlot) slot(s.clipSlot);
    out.push({ target: { shot: id }, key: `shot:${id}`, ...state(s, status.shots[id], undefined, s.clipSlot) });
  };
  b.order.forEach(shot);
  Object.keys(b.slots).forEach(slot);
  if (!b.stepOrder?.length) return out;
  const byKey = new Map(out.map((s) => [s.key, s]));
  return orderSteps(b, out.map((s) => s.key)).map((k) => byKey.get(k)!);
}
