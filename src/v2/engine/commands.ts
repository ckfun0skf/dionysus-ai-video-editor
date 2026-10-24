/** Command factories for the MVP timeline. Each wraps a pure domain op. */
import type { Command } from "./engine";
import { DEFAULT_EFFECT_TICKS, DEFAULT_IMAGE_TICKS, newId, trackKindFor, type Asset, type AssetVersion, type Composition, type Placement, type Project, type TrackKind, transformOf } from "../domain/model";
import * as ops from "../domain/ops";
import * as layers from "../domain/layerStyle";
import * as cueOps from "../domain/subtitleLayer";
import * as subs from "../domain/subtitles";
import * as edit from "../domain/edit";
import * as transitions from "../domain/transitions";
import type { Subtitle } from "../domain/model";
import { TEXT_SOURCE } from "../domain/model";
import * as board from "../domain/storyboard";
import type { StoryDoc } from "../domain/storyJson";
import { DEFAULT_TEXT, DEFAULT_TEXT_TICKS, textOf, type TextData } from "../domain/text";

/**
 * Add a text clip at `at`: onto the first text track with room, else a new text track on top.
 * Text clips trim/split/move/duplicate/delete like media clips (they are ordinary placements).
 */
export const addTextClip = (at: number, data: Partial<TextData> = {}, id = newId("plc")): Command => ({
  label: "Add text",
  apply: (p) => withRoot(p, (c) => {
    const start = Math.max(0, Math.round(at));
    const pl: Placement = { id, startTicks: start, durationTicks: DEFAULT_TEXT_TICKS, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: textOf(data) };
    const fits = (t: Composition["tracks"][number]) => t.placements.every((o) => o.startTicks >= start + pl.durationTicks || o.startTicks + o.durationTicks <= start);
    let comp = c;
    let track = comp.tracks.find((t) => t.kind === "text" && !t.layerStyle?.subtitle && fits(t));
    if (!track) { comp = ops.addTrack(comp, "text"); track = comp.tracks[0]; }
    // On a styled layer the clip stores only what was asked for; the layer supplies the rest.
    if (track.layerStyle) pl.text = { text: DEFAULT_TEXT.text, ...data } as TextData;
    return ops.insertPlacement(comp, track.id, pl);
  }),
});

/** V2-101: add an effect clip at `at` (default length) on the first effect layer with room, else a new layer on top. */
export const addEffectClip = (at: number, preset: string, params?: Record<string, number | string>, id = newId("plc")): Command => ({
  label: "Add effect",
  apply: (p) => withRoot(p, (c) => {
    const start = Math.max(0, Math.round(at));
    const pl: Placement = { id, startTicks: start, durationTicks: DEFAULT_EFFECT_TICKS, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "effect", effect: { preset, ...(params ? { params } : {}) } };
    const fits = (t: Composition["tracks"][number]) => t.placements.every((o) => o.startTicks >= start + pl.durationTicks || o.startTicks + o.durationTicks <= start);
    let comp = c;
    let track = comp.tracks.find((t) => t.kind === "effect" && fits(t));
    if (!track) { const tid = newId("trk"); comp = ops.addTrack(comp, "effect", tid); track = comp.tracks.find((t) => t.id === tid)!; }
    return ops.insertPlacement(comp, track.id, pl);
  }),
});

/** V2-101: change an effect clip's preset (params reset) or patch its params. Param drags coalesce. */
export const setEffect = (id: string, patch: { preset?: string; params?: Record<string, number | string> }, label = patch.preset ? "Change effect" : "Effect settings"): Command => ({
  label,
  coalesceKey: patch.preset ? undefined : `fx:${id}:${Object.keys(patch.params ?? {}).sort().join(",")}`,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === id && pl.clipType === "effect" && pl.effect ? { ...pl, effect: patch.preset ? { preset: patch.preset } : { ...pl.effect, params: { ...pl.effect.params, ...patch.params } } } : pl)) })) })),
});

/** Patch a text clip's content/style. Typing into one clip coalesces into one undo step. */
export const updateText = (id: string, patch: Partial<TextData>, label = "Edit text"): Command => ({
  label,
  coalesceKey: `text:${id}:${Object.keys(patch).sort().join(",")}`,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === id && pl.clipType === "text" ? { ...pl, text: { ...pl.text, ...patch } as TextData } : pl)) })) })),
});

function withRoot(project: Project, fn: (c: Composition) => Composition): Project {
  const id = project.rootCompositionId;
  const next = fn(project.compositions[id]);
  if (next === project.compositions[id]) return project;
  return { ...project, compositions: { ...project.compositions, [id]: next } };
}

export const importAsset = (asset: Asset): Command => ({
  label: `Import ${asset.name}`,
  apply: (p) => ({ ...p, assets: { ...p.assets, [asset.id]: asset } }),
});

export const removeAsset = (assetId: string): Command => ({
  label: "Remove media",
  apply: (p) => {
    const { [assetId]: _removed, ...rest } = p.assets;
    void _removed;
    // Remove placements in every composition (nested ones included). Blobs are kept so
    // undo works; unreferenced blobs are collected at boot by persistence/gc.
    const compositions = Object.fromEntries(Object.entries(p.compositions).map(([id, c]) => [id, { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.filter((pl) => pl.source.assetId !== assetId) })) }]));
    return { ...p, assets: rest, compositions };
  },
});

export function placementForAsset(asset: Asset, version: AssetVersion, startTicks: number): Placement {
  return {
    id: newId("plc"),
    startTicks,
    durationTicks: asset.kind === "image" ? DEFAULT_IMAGE_TICKS : version.media.durationTicks ?? DEFAULT_IMAGE_TICKS,
    sourceInTicks: 0,
    source: { kind: "assetVersion", assetId: asset.id, versionId: version.id },
    clipType: asset.kind,
    volume: 1,
  };
}

/** Add asset to timeline. Uses given track, else first compatible track, else creates one. */
export const addAssetToTimeline = (assetId: string, startTicks: number, trackId?: string, placementId?: string): Command => ({
  label: "Add to timeline",
  apply: (p) => {
    const asset = p.assets[assetId];
    const version = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
    if (!asset || !version) throw new Error("asset missing");
    const kind: TrackKind = trackKindFor(asset.kind);
    return withRoot(p, (c) => {
      let comp = c;
      let tid = trackId && comp.tracks.find((t) => t.id === trackId && t.kind === kind) ? trackId : (kind === "video" ? ops.mainTrack(comp) : comp.tracks.find((t) => t.kind === kind))?.id;
      if (!tid) {
        tid = newId("trk");
        comp = ops.addTrack(comp, kind, tid);
      }
      const pl = placementForAsset(asset, version, startTicks);
      return ops.insertPlacement(comp, tid, placementId ? { ...pl, id: placementId } : pl);
    });
  },
});

export const movePlacement = (id: string, trackId: string, start: number): Command => ({ label: "Move clip", apply: (p) => withRoot(p, (c) => ops.movePlacement(c, id, trackId, start)) });

export const trimPlacement = (id: string, edge: "left" | "right", to: number, ripple = false): Command => ({
  label: ripple ? "Ripple trim" : "Trim clip",
  apply: (p) =>
    withRoot(p, (c) => {
      const found = c.tracks.flatMap((t) => t.placements).find((pl) => pl.id === id);
      const asset = found && p.assets[found.source.assetId];
      const max = asset?.kind === "image" ? undefined : asset?.versions.find((v) => v.id === found?.source.versionId)?.media.durationTicks;
      return (ripple ? edit.rippleTrim : ops.trimPlacement)(c, id, edge, to, max);
    }),
});

export const splitPlacement = (id: string, at: number, newIdValue?: string): Command => ({ label: "Split clip", apply: (p) => withRoot(p, (c) => ops.splitPlacement(c, id, at, newIdValue)) });
export const deletePlacement = (id: string): Command => ({ label: "Delete clip", apply: (p) => withRoot(p, (c) => ops.deletePlacement(c, id)) });
export const addTrack = (kind: TrackKind): Command => ({ label: `Add ${kind} track`, apply: (p) => withRoot(p, (c) => ops.addTrack(c, kind)) });
export const toggleTrackMute = (trackId: string): Command => ({
  label: "Toggle mute",
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)) })),
});
export const setPlacementVolume = (id: string, volume: number): Command => ({
  label: "Volume",
  coalesceKey: `volume:${id}`,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === id ? { ...pl, volume } : pl)) })) })),
});
export const extractAudio = (id: string, mode: "extract" | "duplicate", newIdValue?: string): Command => ({
  label: mode === "extract" ? "Extract audio" : "Duplicate audio",
  apply: (p) => withRoot(p, (c) => ops.extractAudio(c, id, mode, newIdValue)),
});
export const setLinkedAudioMuted = (id: string, muted: boolean): Command => ({
  label: muted ? "Mute clip audio" : "Restore clip audio",
  apply: (p) => withRoot(p, (c) => ops.setLinkedAudioMuted(c, id, muted)),
});
export const setTransform = (id: string, patch: Parameters<typeof ops.setTransform>[2]): Command => ({
  label: patch === null ? "Reset transform" : "Transform",
  coalesceKey: patch === null ? undefined : `transform:${id}`,
  apply: (p) => withRoot(p, (c) => ops.setTransform(c, id, patch)),
});
export const setSpeed = (id: string, speed: number): Command => ({ label: `Speed ${speed}×`, coalesceKey: `speed:${id}`, apply: (p) => withRoot(p, (c) => ops.setSpeed(c, id, speed)) });
export const setTransition = (id: string, t: transitions.Transition | undefined): Command => ({ label: t ? `${(transitions.transitionKind(t.kind)?.label ?? "Transition")} ${t.durationTicks / 120000}s` : "Remove transition", coalesceKey: `transition:${id}`, apply: (p) => withRoot(p, (c) => transitions.setTransition(c, id, t)) });
export const setReverse = (id: string, reverse: boolean): Command => ({ label: reverse ? "Reverse" : "Play forward", apply: (p) => withRoot(p, (c) => ops.setReverse(c, id, reverse)) });
export const freezeFrame = (id: string, at: number, holdTicks = 3 * 120_000): Command => ({ label: "Freeze frame", apply: (p) => withRoot(p, (c) => ops.freezeFrame(c, id, at, holdTicks)) });
export const setFades = (id: string, fades: { in?: number; out?: number }): Command => ({ label: "Fade", coalesceKey: `fade:${id}`, apply: (p) => withRoot(p, (c) => ops.setFades(c, id, fades)) });
export const setKeyframe = (id: string, prop: Parameters<typeof ops.setKeyframe>[2], t: number, value: number | null): Command => ({
  label: value === null ? "Remove keyframe" : "Keyframe",
  coalesceKey: value === null ? undefined : `kf:${id}:${prop}`,
  apply: (p) => withRoot(p, (c) => ops.setKeyframe(c, id, prop, t, value)),
});
export const addSubtitle = (s: Subtitle): Command => ({ label: "Add text", apply: (p) => withRoot(p, (c) => subs.addSubtitle(c, s)) });
export const updateSubtitle = (id: string, patch: Partial<Omit<Subtitle, "id">>): Command => ({ label: "Edit text", coalesceKey: `sub:${id}`, apply: (p) => withRoot(p, (c) => subs.updateSubtitle(c, id, patch)) });
export const removeSubtitle = (id: string): Command => ({ label: "Delete text", apply: (p) => withRoot(p, (c) => subs.removeSubtitle(c, id)) });
export const setSubtitles = (list: Subtitle[], label = "Import subtitles"): Command => ({ label, apply: (p) => withRoot(p, (c) => subs.setSubtitles(c, list)) });
/** V2-106: project canvas size / frame rate / background. Sizes are clamped even (H.264) and within 16..8192. */
export type ProjectSettingsPatch = Partial<{ width: number; height: number; fps: number; background: string }>;
export const setProjectSettings = (patch: ProjectSettingsPatch, label = "Project settings"): Command => ({
  label,
  coalesceKey: patch.background !== undefined && Object.keys(patch).length === 1 ? "settings-bg" : undefined,
  apply: (p) => {
    const even = (n: number) => { const v = Math.round(Math.min(8192, Math.max(16, n))); return v - (v % 2); };
    const s = { ...p.settings };
    if (patch.width !== undefined) s.width = even(patch.width);
    if (patch.height !== undefined) s.height = even(patch.height);
    if (patch.fps !== undefined) s.fps = Math.min(120, Math.max(1, Math.round(patch.fps)));
    if (patch.background !== undefined) { if (!/^#[0-9a-f]{6}$/i.test(patch.background)) throw new Error("background must be #rrggbb"); s.background = patch.background; }
    return { ...p, settings: s };
  },
});
export const renameProject = (name: string): Command => ({ label: "Rename project", coalesceKey: "rename", apply: (p) => ({ ...p, name }) });
export const deleteClips = (ids: string[], ripple = false): Command => ({
  label: `${ripple ? "Ripple delete" : "Delete"} ${ids.length > 1 ? `${ids.length} clips` : "clip"}`,
  apply: (p) => withRoot(p, (c) => edit.deleteMany(c, ids, ripple)),
});
/** `newIds` are generated by the caller so redo yields the same ids (and the UI can select them). */
const idFeed = (newIds: string[]) => { let i = 0; return () => newIds[i++] ?? newId("plc"); };
export const pasteClips = (items: edit.ClipboardItem[], at: number, newIds: string[]): Command => ({
  label: `Paste ${items.length > 1 ? `${items.length} clips` : "clip"}`,
  apply: (p) => withRoot(p, (c) => edit.pasteClips(c, items, at, idFeed(newIds)).comp),
});
export const duplicateClips = (ids: string[], newIds: string[]): Command => ({
  label: `Duplicate ${ids.length > 1 ? `${ids.length} clips` : "clip"}`,
  apply: (p) => withRoot(p, (c) => edit.duplicateClips(c, ids, idFeed(newIds)).comp),
});

/** Add a new version to an asset, select it, and point one placement at it (e.g. after editing an HTML clip). Undo restores both. */
export const addAssetVersion = (assetId: string, version: AssetVersion, placementId?: string): Command => ({
  label: "Edit HTML clip",
  apply: (p) => {
    const a = p.assets[assetId];
    if (!a) return p;
    const assets = { ...p.assets, [assetId]: { ...a, versions: [...a.versions, version], selectedVersionId: version.id } };
    const next = { ...p, assets };
    if (!placementId) return next;
    return withRoot(next, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === placementId ? { ...pl, source: { ...pl.source, versionId: version.id } } : pl)) })) }));
  },
});

/**
 * Preview duplicate (CapCut-style): copy one element onto a NEW track inserted directly above
 * its source track, same start/duration so both show at once, nudged by (dx, dy) frame fractions.
 */
export const duplicateAbove = (id: string, newIdValue: string, dx = 0.02, dy = 0.02, trackIdValue = newId("trk")): Command => ({
  label: "Duplicate",
  apply: (p) => withRoot(p, (c) => {
    const ti = c.tracks.findIndex((t) => t.placements.some((pl) => pl.id === id));
    if (ti < 0) return c;
    const src = c.tracks[ti], pl = src.placements.find((x) => x.id === id)!;
    const t = transformOf(pl);
    const copy: Placement = { ...structuredClone(pl), id: newIdValue, transform: { ...t, x: t.x + dx, y: t.y + dy } };
    const n = c.tracks.filter((x) => x.kind === src.kind).length + 1;
    const track = { id: trackIdValue, kind: src.kind, name: `${src.kind[0].toUpperCase()}${src.kind.slice(1)} ${n}`, placements: [copy] };
    return { ...c, tracks: [...c.tracks.slice(0, ti), track, ...c.tracks.slice(ti)] };
  }),
});

/**
 * Lay assets end-to-end starting at `startTicks`. Video goes to the main track, or to a new
 * video track `overlayTrackId` stacked above everything; audio goes to the first audio track.
 */
export const addAssetsInSequence = (assetIds: string[], startTicks: number, overlayTrackId?: string, group: "overlay" | "text" = "overlay"): Command => ({
  label: group === "text" ? "Add stickers" : overlayTrackId ? "Add overlay" : "Add media",
  apply: (p) => withRoot(p, (c) => {
    let comp = c;
    if (overlayTrackId) comp = ops.addTrack(comp, "video", overlayTrackId, group);
    let at = Math.max(0, Math.round(startTicks));
    for (const id of assetIds) {
      const asset = p.assets[id];
      const version = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
      if (!asset || !version) throw new Error("asset missing");
      const kind: TrackKind = trackKindFor(asset.kind);
      let tid = (kind === "video" ? (overlayTrackId ? comp.tracks.find((t) => t.id === overlayTrackId) : ops.mainTrack(comp)) : comp.tracks.find((t) => t.kind === kind))?.id;
      if (!tid) { tid = newId("trk"); comp = ops.addTrack(comp, kind, tid); }
      const pl = placementForAsset(asset, version, at);
      comp = ops.insertPlacement(comp, tid, pl);
      at += pl.durationTicks;
    }
    return comp;
  }),
});

/** Append the storyboard's ready shots, in story order, to the end of the main track. One undo. */
export const sendStoryToTimeline = (): Command => ({
  label: "Send to timeline",
  apply: (p) => withRoot(p, (c) => {
    let comp = c;
    let tid = ops.mainTrack(comp)?.id;
    if (!tid) { tid = newId("trk"); comp = ops.addTrack(comp, "video", tid); }
    let at = Math.max(0, ...comp.tracks.find((t) => t.id === tid)!.placements.map((x) => x.startTicks + x.durationTicks));
    for (const s of board.sendPlan(p)) {
      if (s.state !== "ready") continue;
      const asset = p.assets[s.assetId!];
      const version = asset.versions.find((v) => v.id === asset.selectedVersionId) ?? asset.versions[0];
      const pl = placementForAsset(asset, version, at);
      comp = ops.insertPlacement(comp, tid, pl);
      at += pl.durationTicks;
    }
    return comp;
  }),
});

export const reorderTrack = (trackId: string, toIndex: number): Command => ({
  label: "Reorder layer",
  apply: (p) => withRoot(p, (c) => ops.reorderTrack(c, trackId, toIndex)),
});
export const reorderMain = (id: string, toIndex: number): Command => ({
  label: "Reorder clips",
  apply: (p) => withRoot(p, (c) => ops.reorderMain(c, id, toIndex)),
});

export const toggleTrackHidden = (trackId: string): Command => ({
  label: "Toggle layer visibility",
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => (t.id === trackId ? { ...t, hidden: !t.hidden || undefined } : t)) })),
});
/** Remove a whole layer and all its clips (never the main track). One undo step. */
export const deleteTrack = (trackId: string): Command => ({
  label: "Delete layer",
  apply: (p) => withRoot(p, (c) => ops.deleteLayer(c, trackId)),
});
/** SRT import: cues become text clips on a NEW layer at the top of Text & Stickers; existing layers are untouched. */
export const importSrtLayer = (list: Subtitle[], trackId = newId("trk")): Command => ({
  label: "Import subtitles",
  apply: (p) => withRoot(p, (c) => {
    if (!list.length) return c;
    let comp = ops.addTrack(c, "text", trackId);
    const tr = comp.tracks.find((t) => t.id === trackId)!;
    const placements: Placement[] = list.map((s) => ({ id: newId("plc"), startTicks: s.startTicks, durationTicks: s.durationTicks, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text", text: { text: s.text } as TextData }));
    comp = { ...comp, tracks: comp.tracks.map((t) => (t === tr ? { ...t, name: "Subtitles", layerStyle: layers.SUBTITLE_STYLE, placements: [...placements].sort((a, b) => a.startTicks - b.startTicks) } : t)) };
    return comp;
  }),
});

/** V2-103 "Edit all": change the shared style of a text layer (clip overrides for those keys are cleared). Slider drags coalesce. */
export const setLayerStyle = (trackId: string, patch: { text?: layers.LayerTextStyle; transform?: layers.LayerTransform }, label = "Edit layer style"): Command => ({
  label,
  coalesceKey: `layer:${trackId}:${Object.keys(patch.text ?? {}).sort().join(",")}|${Object.keys(patch.transform ?? {}).sort().join(",")}`,
  apply: (p) => withRoot(p, (c) => layers.setLayerStyle(c, trackId, patch)),
});
/** V2-103: drop a clip's own style so it follows its layer again. */
export const resetToLayerStyle = (id: string): Command => ({ label: "Reset to layer style", apply: (p) => withRoot(p, (c) => layers.resetToLayer(c, id)) });

/* V2-104: subtitle list editor ops on a text layer's cues (one undo step each; text typing coalesces in a gesture). */
export const setCueText = (id: string, text: string): Command => ({ label: "Edit subtitle text", coalesceKey: `cuetext:${id}`, apply: (p) => withRoot(p, (c) => cueOps.setCueText(c, id, text)) });
export const setCueTimes = (id: string, start: number, end: number): Command => ({ label: "Edit subtitle timing", apply: (p) => withRoot(p, (c) => cueOps.setCueTimes(c, id, start, end)) });
export const addCueAfter = (id: string, newId: string): Command => ({ label: "Add subtitle", apply: (p) => withRoot(p, (c) => cueOps.addCueAfter(c, id, newId)) });
export const deleteCue = (id: string): Command => ({ label: "Delete subtitle", apply: (p) => withRoot(p, (c) => cueOps.deleteCue(c, id)) });
export const splitCue = (id: string, pos: number, newId: string): Command => ({ label: "Split subtitle", apply: (p) => withRoot(p, (c) => cueOps.splitCue(c, id, pos, newId)) });
export const mergeCueNext = (id: string): Command => ({ label: "Merge subtitles", apply: (p) => withRoot(p, (c) => cueOps.mergeNext(c, id)) });
export const replaceInLayer = (trackId: string, find: string, repl: string, matchCase = false): Command => ({ label: "Replace in subtitles", apply: (p) => withRoot(p, (c) => cueOps.replaceAll(c, trackId, find, repl, matchCase)) });

/** Storyboard (V2-CUT-01): wrappers so storyboard edits are undoable like timeline edits. */
export const createStoryboard = (doc: StoryDoc): Command => ({ label: "Create storyboard", apply: (p) => board.setStoryboard(p, board.storyboardFromDoc(doc)) });
export const removeStoryboard = (): Command => ({ label: "Remove storyboard", apply: (p) => board.setStoryboard(p, undefined) });
export const addStoryVersion = (...args: Parameters<typeof board.addStoryVersion> extends [unknown, ...infer R] ? R : never): Command => ({ label: "Upload version", apply: (p) => board.addStoryVersion(p, ...args) });
export const selectStoryVersion = (assetId: string, versionId: string): Command => ({ label: "Choose version", apply: (p) => board.selectStoryVersion(p, assetId, versionId) });
export const setStorySkipped = (target: { slot: string } | { shot: string }, skipped: boolean): Command => ({ label: skipped ? "Skip step" : "Include step", apply: (p) => board.setStorySkipped(p, target, skipped) });
export const setQaResult = (versionId: string, checkId: string, result: board.QaResult | undefined): Command => ({ label: "QA check", apply: (p) => board.setQaResult(p, versionId, checkId, result) });
