/**
 * P58: per-clip version pin for storyboard-linked timeline clips.
 * `placement.versionId` present = this clip stays on that asset version; absent = follow the
 * asset's `selectedVersionId` (the storyboard's current version). Split and copy keep the field
 * because they clone the placement. Optional on schema 3.1 — no migration.
 */
import { findPlacement, isStill, newId, type AssetVersion, type MediaRef, type Placement, type Project } from "./model";
import { TICKS_PER_SECOND } from "./time";
import { MIN_DURATION_TICKS, mainTrack } from "./ops";
import { storyTargetOf } from "./slip";
import { addStoryVersion, setVersionTrim, type VersionTrim } from "./storyboard";

const rootOf = (p: Project) => p.compositions[p.rootCompositionId];
const sec = (t: number) => Math.round((t / TICKS_PER_SECOND) * 100) / 100;

export function selectedVersionId(p: Project, assetId: string): string | undefined {
  const a = p.assets[assetId];
  return a?.selectedVersionId ?? a?.versions.at(-1)?.id;
}

/** Version this clip should show: a valid pin, else the asset's current version. */
export function resolvedVersionId(p: Project, pl: Placement): { versionId?: string; stalePin: boolean } {
  const a = p.assets[pl.source.assetId];
  if (!a) return { versionId: pl.source.versionId, stalePin: false };
  if (pl.versionId) {
    if (a.versions.some((v) => v.id === pl.versionId)) return { versionId: pl.versionId, stalePin: false };
    return { versionId: selectedVersionId(p, a.id), stalePin: true };
  }
  return { versionId: selectedVersionId(p, a.id) ?? pl.source.versionId, stalePin: false };
}

export const isVersionPinned = (pl: Placement): boolean => !!pl.versionId;

export function placementsOfAsset(p: Project, assetId: string): Placement[] {
  return Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements.filter((pl) => pl.source.assetId === assetId)));
}

/** Other main-track clips that share this shot's asset (split halves, pasted copies). */
export function siblingShotClips(p: Project, clipId: string): Placement[] {
  const f = findPlacement(rootOf(p), clipId);
  if (!f || !f.placement.source.assetId) return [];
  const aid = f.placement.source.assetId;
  const shot = f.placement.storyShot;
  const main = mainTrack(rootOf(p));
  return (main?.placements ?? []).filter((pl) => pl.id !== clipId && pl.source.assetId === aid && (!shot || pl.storyShot === shot));
}

export function clipsUsingVersion(p: Project, assetId: string, versionId: string): Placement[] {
  return placementsOfAsset(p, assetId).filter((pl) => pl.versionId === versionId || pl.source.versionId === versionId);
}

function mapClip(p: Project, id: string, fn: (pl: Placement) => Placement): Project {
  const c = rootOf(p);
  let changed = false;
  const tracks = c.tracks.map((t) => {
    const placements = t.placements.map((pl) => {
      if (pl.id !== id) return pl;
      const n = fn(pl);
      if (n !== pl) changed = true;
      return n;
    });
    return placements.some((pl, i) => pl !== t.placements[i]) ? { ...t, placements } : t;
  });
  return changed ? { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks } } } : p;
}

function unpin(pl: Placement): Placement {
  if (!pl.versionId) return pl;
  const { versionId: _pin, ...rest } = pl;
  void _pin;
  return rest;
}

function rippleMainAfter(p: Project, clipId: string, oldEnd: number, delta: number): Project {
  if (!delta) return p;
  const c = rootOf(p);
  const main = mainTrack(c);
  if (!main) return p;
  const tracks = c.tracks.map((t) => {
    if (t.id !== main.id) return t;
    return {
      ...t,
      placements: t.placements.map((pl) => (pl.id !== clipId && pl.startTicks >= oldEnd ? { ...pl, startTicks: Math.max(0, pl.startTicks + delta) } : pl)),
    };
  });
  return { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks } } };
}

/** Point one clip at `versionId`, keeping its in-point and length when they still fit. */
export function applyVersionToClip(p: Project, clipId: string, versionId: string, opts: { durationTicks?: number; sourceInTicks?: number; ripple?: boolean } = {}): Project {
  const f = findPlacement(rootOf(p), clipId);
  if (!f) return p;
  const v = p.assets[f.placement.source.assetId]?.versions.find((x) => x.id === versionId);
  if (!v) return p;
  const oldEnd = f.placement.startTicks + f.placement.durationTicks;
  const oldDur = f.placement.durationTicks;
  const next = mapClip(p, clipId, (pl) => {
    const out: Placement = { ...pl, source: { ...pl.source, versionId } };
    delete out.storyTrim;
    if (isStill(pl) || !v.media.durationTicks) return out;
    const max = v.media.durationTicks;
    const speed = pl.speed ?? 1;
    const wantIn = opts.sourceInTicks ?? pl.sourceInTicks;
    const wantDur = opts.durationTicks ?? pl.durationTicks;
    out.sourceInTicks = Math.max(0, Math.min(wantIn, Math.max(0, max - 1)));
    const room = Math.max(MIN_DURATION_TICKS, Math.floor((max - out.sourceInTicks) / speed));
    out.durationTicks = Math.max(MIN_DURATION_TICKS, Math.min(wantDur, room));
    return out;
  });
  const after = findPlacement(rootOf(next), clipId)?.placement;
  if (opts.ripple && after) return rippleMainAfter(next, clipId, oldEnd, after.durationTicks - oldDur);
  return next;
}

export function setClipVersion(p: Project, clipId: string, versionId: string | null): { project: Project; warning?: string } {
  const f = findPlacement(rootOf(p), clipId);
  if (!f) throw new Error(`No clip "${clipId}".`);
  const pl = f.placement;
  const a = p.assets[pl.source.assetId];
  if (!a || !pl.source.assetId) throw new Error(`Clip ${clipId} has no versioned asset.`);
  if (versionId === null) {
    const stale = resolvedVersionId(p, pl).stalePin;
    let next = mapClip(p, clipId, unpin);
    const follow = selectedVersionId(next, pl.source.assetId);
    if (follow) next = applyVersionToClip(next, clipId, follow);
    return { project: next, warning: stale ? `Clip ${clipId} was pinned to a version that no longer exists; it now follows the current version.` : undefined };
  }
  if (!a.versions.some((v) => v.id === versionId)) throw new Error(`No version "${versionId}" on this asset.`);
  const next = applyVersionToClip(mapClip(p, clipId, (x) => ({ ...x, versionId })), clipId, versionId);
  return { project: next };
}

export function repairStalePins(p: Project): { project: Project; warnings: { clipId: string; message: string }[] } {
  const warnings: { clipId: string; message: string }[] = [];
  let next = p;
  for (const c of Object.values(p.compositions)) {
    for (const t of c.tracks) {
      for (const pl of t.placements) {
        const r = resolvedVersionId(next, pl);
        if (!r.stalePin || !r.versionId) continue;
        warnings.push({ clipId: pl.id, message: `Clip ${pl.id} was pinned to a version that no longer exists; it now follows the current version.` });
        next = applyVersionToClip(mapClip(next, pl.id, unpin), pl.id, r.versionId);
      }
    }
  }
  return { project: next, warnings };
}

export type FitChoice = "trim" | "full";
export type VersionSaveMode = "new" | "replace";

export function versionSaveModeOf(p: Project): VersionSaveMode {
  return p.settings.versionSaveMode === "replace" ? "replace" : "new";
}

export type ApplyMediaOpts = { versionId?: string; fit?: FitChoice; inSec?: number; ripple?: boolean; mode?: VersionSaveMode; seed?: AssetVersion; remember?: boolean };

export type ApplyMediaResult =
  | { ok: true; project: Project; note?: string; dropKeys?: string[]; otherCount?: number; mode: VersionSaveMode }
  | { ok: false; error: string; needsFit?: boolean; mediaTicks?: number; clipTicks?: number };

function withSaveMode(p: Project, mode: VersionSaveMode | undefined, remember: boolean | undefined): Project {
  if (remember === false || !mode) return p;
  const s = { ...p.settings };
  if (mode === "replace") s.versionSaveMode = "replace";
  else delete s.versionSaveMode;
  return { ...p, settings: s };
}

function projectHasKey(p: Project, key: string): boolean {
  for (const a of Object.values(p.assets)) {
    for (const v of a.versions) {
      if (v.media.blobKey === key || v.media.thumbKey === key || v.media.specKey === key) return true;
    }
  }
  return false;
}

function fitGate(clipTicks: number, mediaTicks: number | undefined, fit?: FitChoice):
  | { ok: true; longer: boolean; shorter: boolean }
  | { ok: false; error: string; needsFit: true; mediaTicks: number; clipTicks: number } {
  const longer = !!mediaTicks && mediaTicks > clipTicks + 1;
  const shorter = !!mediaTicks && mediaTicks < clipTicks - 1;
  if (longer && !fit) {
    return {
      ok: false, needsFit: true, mediaTicks: mediaTicks!, clipTicks,
      error: `The new take is ${sec(mediaTicks!)} s but this shot/clip is ${sec(clipTicks)} s: pass fit "trim" (keep the shot length; inSec picks the start, default 0) or "full" (use the whole take; later clips move when ripple is on).`,
    };
  }
  return { ok: true, longer, shorter };
}

export function clipsShowingVersion(p: Project, assetId: string, versionId: string): Placement[] {
  return placementsOfAsset(p, assetId).filter((pl) => resolvedVersionId(p, pl).versionId === versionId);
}

export function addStoryVersionFromClip(p: Project, clipId: string, media: MediaRef, opts: ApplyMediaOpts = {}): ApplyMediaResult {
  if (opts.mode === "replace") return replaceCurrentVersion(p, clipId, media, opts);
  const story = storyTargetOf(p, clipId);
  const f = findPlacement(rootOf(p), clipId);
  if (!f) return { ok: false, error: `No clip "${clipId}".` };
  if (!story) return { ok: false, error: `Clip ${clipId} is not a storyboard shot clip on the main track.` };
  const clip = f.placement;
  const mediaTicks = media.durationTicks;
  const clipTicks = clip.durationTicks;
  const longer = !!mediaTicks && mediaTicks > clipTicks + 1;
  const shorter = !!mediaTicks && mediaTicks < clipTicks - 1;
  if (longer && !opts.fit) {
    return {
      ok: false, needsFit: true, mediaTicks, clipTicks,
      error: `The new take is ${sec(mediaTicks!)} s but this shot/clip is ${sec(clipTicks)} s: pass fit "trim" (keep the shot length; inSec picks the start, default 0) or "full" (use the whole take; later clips move when ripple is on).`,
    };
  }

  const siblings = siblingShotClips(p, clipId).map((s) => ({
    id: s.id,
    shown: s.source.versionId,
    pin: s.versionId,
    sourceInTicks: s.sourceInTicks,
    durationTicks: s.durationTicks,
  }));

  // Add the version (and select it) without rewriting every linked clip — we pin siblings first.
  const added = addStoryVersion(p, story.target, media, { versionId: opts.versionId, sync: false });
  const b = added.storyboard!;
  const owner = "shot" in story.target ? b.shots[story.target.shot] : b.slots[story.target.slot];
  const assetId = owner?.assetId;
  const newVid = assetId ? selectedVersionId(added, assetId) : undefined;
  if (!assetId || !newVid) return { ok: false, error: "Couldn't add the version." };

  let next = added;
  for (const s of siblings) {
    const pinTo = s.pin ?? s.shown;
    if (!pinTo) continue;
    next = setClipVersion(next, s.id, pinTo).project;
    next = applyVersionToClip(next, s.id, pinTo, { sourceInTicks: s.sourceInTicks, durationTicks: s.durationTicks });
  }

  // Pin first (without shrinking/growing), then apply length once so ripple sees the real delta.
  next = mapClip(next, clipId, (x) => ({ ...x, versionId: newVid }));
  if (opts.fit === "trim") {
    const inTicks = Math.round(Math.max(0, opts.inSec ?? 0) * TICKS_PER_SECOND);
    next = applyVersionToClip(next, clipId, newVid, { durationTicks: clipTicks, sourceInTicks: inTicks, ripple: false });
  } else if (opts.fit === "full" && mediaTicks) {
    next = applyVersionToClip(next, clipId, newVid, { durationTicks: mediaTicks, sourceInTicks: 0, ripple: !!opts.ripple });
  } else if (shorter && mediaTicks) {
    next = applyVersionToClip(next, clipId, newVid, { durationTicks: mediaTicks, sourceInTicks: 0, ripple: !!opts.ripple });
    const note = opts.ripple
      ? `This take is shorter (${sec(mediaTicks)} s vs ${sec(clipTicks)} s). The clip was shortened and later clips moved up.`
      : `This take is shorter (${sec(mediaTicks)} s vs ${sec(clipTicks)} s). The clip was shortened; a gap was left.`;
    return { ok: true, project: withSaveMode(next, "new", opts.remember), note, mode: "new" };
  } else {
    // Equal length (or no media duration): keep this clip's in-point and length.
    next = applyVersionToClip(next, clipId, newVid, { durationTicks: clipTicks, sourceInTicks: clip.sourceInTicks });
  }
  return { ok: true, project: withSaveMode(next, "new", opts.remember), mode: "new" };
}

export interface VersionDeleteAffected { clipId: string; label: string; pinned: boolean; toVersionId: string }
export type VersionDeletePlan =
  | { ok: false; error: string }
  | { ok: true; fallbackId: string; affected: VersionDeleteAffected[]; dropKeys: string[] };

function keysOfVersion(p: Project, assetId: string, versionId: string): string[] {
  const v = p.assets[assetId]?.versions.find((x) => x.id === versionId);
  if (!v) return [];
  return [v.media.blobKey, ...(v.media.thumbKey ? [v.media.thumbKey] : []), ...(v.media.specKey ? [v.media.specKey] : [])];
}

function keyStillUsed(p: Project, key: string, except: { assetId: string; versionId: string }): boolean {
  for (const a of Object.values(p.assets)) {
    for (const v of a.versions) {
      if (a.id === except.assetId && v.id === except.versionId) continue;
      if (v.media.blobKey === key || v.media.thumbKey === key || v.media.specKey === key) return true;
    }
  }
  return false;
}

export function versionDeletePlan(p: Project, assetId: string, versionId: string): VersionDeletePlan {
  const a = p.assets[assetId];
  if (!a) return { ok: false, error: `No asset "${assetId}".` };
  if (!a.versions.some((v) => v.id === versionId)) return { ok: false, error: `No version "${versionId}" on asset ${assetId}.` };
  if (a.versions.length <= 1) return { ok: false, error: `Cannot delete the last remaining version of ${a.name}.` };
  const remaining = a.versions.filter((v) => v.id !== versionId);
  const fallbackId = (a.selectedVersionId && a.selectedVersionId !== versionId && remaining.some((v) => v.id === a.selectedVersionId))
    ? a.selectedVersionId
    : remaining[remaining.length - 1]!.id;
  const clipLabel = (pl: Placement) => p.assets[pl.source.assetId]?.name ?? pl.id;
  const affected = clipsUsingVersion(p, assetId, versionId).map((pl) => ({
    clipId: pl.id,
    label: clipLabel(pl),
    pinned: pl.versionId === versionId,
    toVersionId: fallbackId,
  }));
  const dropKeys = keysOfVersion(p, assetId, versionId).filter((k) => !keyStillUsed(p, k, { assetId, versionId }));
  return { ok: true, fallbackId, affected, dropKeys };
}

export function deleteAssetVersion(p: Project, assetId: string, versionId: string, fallbackId?: string): Project {
  const plan = versionDeletePlan(p, assetId, versionId);
  if (!plan.ok) throw new Error(plan.error);
  const a = p.assets[assetId]!;
  const chosen = fallbackId && a.versions.some((v) => v.id === fallbackId && v.id !== versionId) ? fallbackId : plan.fallbackId;
  let next = p;
  for (const hit of plan.affected) {
    if (hit.pinned) next = setClipVersion(next, hit.clipId, chosen).project;
    else next = applyVersionToClip(next, hit.clipId, chosen);
  }
  const cur = next.assets[assetId]!;
  const versions = cur.versions.filter((v) => v.id !== versionId);
  const selected = cur.selectedVersionId === versionId ? chosen : cur.selectedVersionId;
  next = { ...next, assets: { ...next.assets, [assetId]: { ...cur, versions, selectedVersionId: selected } } };
  if (next.storyboard?.versions[versionId]) {
    const { [versionId]: _gone, ...rest } = next.storyboard.versions;
    void _gone;
    next = { ...next, storyboard: { ...next.storyboard, versions: rest } };
  }
  return next;
}

function applyFitToClip(p: Project, clipId: string, versionId: string, clip: Placement, media: MediaRef, opts: ApplyMediaOpts): { project: Project; note?: string } {
  const mediaTicks = media.durationTicks;
  const clipTicks = clip.durationTicks;
  const shorter = !!mediaTicks && mediaTicks < clipTicks - 1;
  let next = mapClip(p, clipId, (x) => ({ ...x, versionId }));
  if (opts.fit === "trim") {
    const inTicks = Math.round(Math.max(0, opts.inSec ?? 0) * TICKS_PER_SECOND);
    next = applyVersionToClip(next, clipId, versionId, { durationTicks: clipTicks, sourceInTicks: inTicks, ripple: false });
    return { project: next };
  }
  if (opts.fit === "full" && mediaTicks) {
    next = applyVersionToClip(next, clipId, versionId, { durationTicks: mediaTicks, sourceInTicks: 0, ripple: !!opts.ripple });
    return { project: next };
  }
  if (shorter && mediaTicks) {
    next = applyVersionToClip(next, clipId, versionId, { durationTicks: mediaTicks, sourceInTicks: 0, ripple: !!opts.ripple });
    const note = opts.ripple
      ? `This take is shorter (${sec(mediaTicks)} s vs ${sec(clipTicks)} s). The clip was shortened and later clips moved up.`
      : `This take is shorter (${sec(mediaTicks)} s vs ${sec(clipTicks)} s). The clip was shortened; a gap was left.`;
    return { project: next, note };
  }
  next = applyVersionToClip(next, clipId, versionId, { durationTicks: clipTicks, sourceInTicks: clip.sourceInTicks });
  return { project: next };
}

/** Overwrite the media of the take this clip is currently showing. Other clips on that take see the change. */
export function replaceCurrentVersion(p: Project, clipId: string, media: MediaRef, opts: ApplyMediaOpts = {}): ApplyMediaResult {
  const f = findPlacement(rootOf(p), clipId);
  if (!f) return { ok: false, error: `No clip "${clipId}".` };
  const shown = resolvedVersionId(p, f.placement).versionId;
  if (!shown) return { ok: false, error: `Clip ${clipId} has no version to replace.` };
  const gate = fitGate(f.placement.durationTicks, media.durationTicks, opts.fit);
  if (!gate.ok) return gate;
  const r = replaceAssetVersion(p, f.placement.source.assetId, shown, media, { remember: false, clampOthers: true });
  if (!r.ok) return r;
  const fitted = applyFitToClip(r.project, clipId, shown, f.placement, media, opts);
  const others = Math.max(0, (r.otherCount ?? 0) - 1);
  const extra = others > 0
    ? (others === 1 ? " 1 other clip uses this take and will show the update." : ` ${others} other clips use this take and will show the update.`)
    : "";
  const note = `${fitted.note ? `${fitted.note} ` : ""}Replaced the current version.${extra}`;
  return { ok: true, project: withSaveMode(fitted.project, "replace", opts.remember), note, dropKeys: r.dropKeys, otherCount: others, mode: "replace" };
}

export function replaceAssetVersion(p: Project, assetId: string, versionId: string, media: MediaRef, opts: { remember?: boolean; clampOthers?: boolean } = {}): ApplyMediaResult {
  const a = p.assets[assetId];
  const v = a?.versions.find((x) => x.id === versionId);
  if (!a || !v) return { ok: false, error: `No version "${versionId}" on asset ${assetId}.` };
  const oldKeys = keysOfVersion(p, assetId, versionId);
  const nextV: AssetVersion = { ...v, media, provenance: { source: "import", inputs: v.provenance?.inputs ?? [] } };
  let next: Project = { ...p, assets: { ...p.assets, [assetId]: { ...a, versions: a.versions.map((x) => (x.id === versionId ? nextV : x)) } } };
  const showing = clipsShowingVersion(next, assetId, versionId);
  if (opts.clampOthers !== false) {
    for (const pl of showing) next = applyVersionToClip(next, pl.id, versionId);
  }
  const dropKeys = oldKeys.filter((k) => !projectHasKey(next, k));
  return { ok: true, project: withSaveMode(next, "replace", opts.remember), dropKeys, otherCount: showing.length, mode: "replace" };
}

/** Storyboard upload with mode replace: overwrite the selected take, or add the first version. */
export function replaceStoryTarget(p: Project, target: import("./storyboard").Target, media: MediaRef, opts: ApplyMediaOpts & { model?: string; sync?: boolean; trim?: VersionTrim; derivedFrom?: { shotId: string; versionId: string }; lfEnd?: number; bg?: string } = {}): ApplyMediaResult {
  const b = p.storyboard;
  if (!b) return { ok: false, error: "No storyboard." };
  const clipSlot = "shot" in target ? b.shots[target.shot]?.clipSlot : undefined;
  if (clipSlot) return replaceStoryTarget(p, { slot: clipSlot }, media, opts);
  const owner = "slot" in target ? b.slots[target.slot] : b.shots[target.shot];
  if (!owner?.assetId || !p.assets[owner.assetId]?.versions.length) {
    const project = withSaveMode(addStoryVersion(p, target, media, { versionId: opts.versionId, model: opts.model, trim: opts.trim, derivedFrom: opts.derivedFrom, lfEnd: opts.lfEnd, bg: opts.bg }), "replace", opts.remember);
    return { ok: true, project, mode: "replace", note: "Saved as the first version." };
  }
  const a = p.assets[owner.assetId];
  const vid = a.selectedVersionId ?? a.versions.at(-1)!.id;
  const r = replaceAssetVersion(p, a.id, vid, media, { remember: opts.remember });
  if (!r.ok) return r;
  let project = r.project;
  const sb = project.storyboard!;
  const info = { ...(sb.versions[vid] ?? {}) };
  if (opts.model) info.model = opts.model;
  if (opts.derivedFrom) info.derivedFrom = opts.derivedFrom;
  if (opts.lfEnd !== undefined) info.lfEnd = opts.lfEnd;
  if (opts.bg) info.bg = opts.bg;
  project = { ...project, storyboard: { ...sb, versions: { ...sb.versions, [vid]: info } } };
  if (opts.trim) project = setVersionTrim(project, a.id, vid, opts.trim);
  return { ...r, project };
}

export function addAssetVersionFromClip(p: Project, clipId: string, media: MediaRef, opts: ApplyMediaOpts = {}): ApplyMediaResult {
  if (opts.mode === "replace") return replaceCurrentVersion(p, clipId, media, opts);
  const f = findPlacement(rootOf(p), clipId);
  if (!f) return { ok: false, error: `No clip "${clipId}".` };
  const asset = p.assets[f.placement.source.assetId];
  if (!asset) return { ok: false, error: `Clip ${clipId} has no versioned asset.` };
  const gate = fitGate(f.placement.durationTicks, media.durationTicks, opts.fit);
  if (!gate.ok) return gate;
  const version: AssetVersion = opts.seed ?? {
    id: opts.versionId ?? newId("ver"),
    createdAt: new Date().toISOString(),
    media,
    provenance: { source: "import", inputs: [] },
  };
  const siblings = placementsOfAsset(p, asset.id).filter((pl) => pl.id !== clipId).map((s) => ({
    id: s.id, shown: s.source.versionId, pin: s.versionId, sourceInTicks: s.sourceInTicks, durationTicks: s.durationTicks,
  }));
  let next: Project = {
    ...p,
    assets: { ...p.assets, [asset.id]: { ...asset, versions: [...asset.versions, version], selectedVersionId: version.id } },
  };
  for (const s of siblings) {
    const pinTo = s.pin ?? s.shown;
    if (!pinTo) continue;
    next = setClipVersion(next, s.id, pinTo).project;
    next = applyVersionToClip(next, s.id, pinTo, { sourceInTicks: s.sourceInTicks, durationTicks: s.durationTicks });
  }
  const fitted = applyFitToClip(next, clipId, version.id, f.placement, media, opts);
  return { ok: true, project: withSaveMode(fitted.project, "new", opts.remember), note: fitted.note, mode: "new" };
}

/** Add or replace a take from a timeline clip (storyboard-linked or standalone). */
export function applyMediaFromClip(p: Project, clipId: string, media: MediaRef, opts: ApplyMediaOpts = {}): ApplyMediaResult {
  if (opts.mode === "replace") return replaceCurrentVersion(p, clipId, media, opts);
  if (storyTargetOf(p, clipId)) return addStoryVersionFromClip(p, clipId, media, { ...opts, mode: "new" });
  return addAssetVersionFromClip(p, clipId, media, { ...opts, mode: "new" });
}
