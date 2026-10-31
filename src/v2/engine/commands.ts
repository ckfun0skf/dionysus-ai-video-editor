/** Command factories for the MVP timeline. Each wraps a pure domain op. */
import { setLink } from "../domain/links";
import type { Command } from "./engine";
import { DEFAULT_EFFECT_TICKS, DEFAULT_IMAGE_TICKS, findPlacement, newId, sourceInMax, trackKindFor, type Asset, type AssetVersion, type Composition, type Placement, type Project, type TrackKind, transformOf } from "../domain/model";
import * as ops from "../domain/ops";
import * as clipRange from "../domain/clipRange";
import { mergeStoryboard } from "../domain/storyRoundtrip";
import * as layers from "../domain/layerStyle";
import * as cueOps from "../domain/subtitleLayer";
import * as subs from "../domain/subtitles";
import * as edit from "../domain/edit";
import * as transitions from "../domain/transitions";
import type { ChromaKey, Keyframe, Subtitle } from "../domain/model";
import { DEFAULT_EFFECT_SCOPE, TEXT_SOURCE, type EffectScope } from "../domain/model";
import * as board from "../domain/storyboard";
import * as storyEdit from "../domain/storyEdit";
import * as storyRefs from "../domain/storyRefs";
import * as storySteps from "../domain/storySteps";
import { replaceStory, sendStory, updateStory } from "../domain/storySend";
import { syncPlan } from "../domain/storySync";
import { promoteOverlay as promoteToMain, type PromoteOptions } from "../domain/promote";
import type { StoryDoc } from "../domain/storyJson";
import { DEFAULT_TEXT, DEFAULT_TEXT_TICKS, textOf, type TextData } from "../domain/text";

/**
 * Add a text clip at `at`: onto the first text track with room, else a new text track on top.
 * Text clips trim/split/move/duplicate/delete like media clips (they are ordinary placements).
 */
export const addTextClip = (at: number, data: Partial<TextData> = {}, id = newId("plc")): Command => ({
  label: "Add text", autoLink: true,
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
  label: "Add effect", autoLink: true,
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

/** P6-FX-SCOPE: set which picture an effect clip changes ("main" is stored as no field, the backward-compatible default). */
export const setEffectScope = (id: string, applyTo: EffectScope): Command => ({
  label: applyTo === "all" ? "Effect: apply to all" : applyTo === "overlay" ? "Effect: apply to overlays" : "Effect: apply to main track",
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => {
    if (pl.id !== id || pl.clipType !== "effect" || !pl.effect) return pl;
    const { applyTo: _old, ...rest } = pl.effect;
    return { ...pl, effect: applyTo === DEFAULT_EFFECT_SCOPE ? rest : { ...rest, applyTo } };
  }) })) })),
});

/** V2-101: change an effect clip's preset (params reset) or patch its params. Param drags coalesce. */
export const setEffect = (id: string, patch: { preset?: string; params?: Record<string, number | string> }, label = patch.preset ? "Change effect" : "Effect settings"): Command => ({
  label,
  coalesceKey: patch.preset ? undefined : `fx:${id}:${Object.keys(patch.params ?? {}).sort().join(",")}`,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => (pl.id === id && pl.clipType === "effect" && pl.effect ? { ...pl, effect: patch.preset ? { preset: patch.preset, ...(pl.effect.applyTo ? { applyTo: pl.effect.applyTo } : {}) } : { ...pl.effect, params: { ...pl.effect.params, ...patch.params } } } : pl)) })) })),
});

/**
 * Per-use values for an HTML clip's exposed params (V2-HTML-PARAMS). `null` removes an override (back to the clip's
 * default); `undefined` patch = reset all. Edits to one param inside a gesture (a slider drag, typing) are one undo step.
 */
export const setHtmlParams = (id: string, patch: Record<string, number | string | boolean | null> | undefined, label = patch ? "Clip params" : "Reset clip params"): Command => ({
  label,
  coalesceKey: patch ? `hp:${id}:${Object.keys(patch).sort().join(",")}` : undefined,
  apply: (p) => withRoot(p, (c) => ({ ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((pl) => {
    if (pl.id !== id || pl.clipType !== "html") return pl;
    const next: Record<string, number | string | boolean> = { ...(patch ? pl.htmlParams : {}) };
    for (const [k, v] of Object.entries(patch ?? {})) { if (v === null) delete next[k]; else next[k] = v; }
    const { htmlParams: _drop, ...rest } = pl;
    return Object.keys(next).length ? { ...rest, htmlParams: next } : rest;
  }) })) })),
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
  label: "Add to timeline", autoLink: true,
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
/** P1-ADD-TRACK: the [+] at the bottom of a track-type mode adds an empty track of that group. */
export const GROUP_TRACK_KIND: Record<Exclude<ops.TrackGroup, "main">, TrackKind> = { overlay: "video", text: "text", audio: "audio", effect: "effect" };
export const addGroupTrack = (group: Exclude<ops.TrackGroup, "main">): Command => ({ label: `Add ${ops.GROUP_LABEL[group]} track`, apply: (p) => withRoot(p, (c) => ops.addTrack(c, GROUP_TRACK_KIND[group])) });
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
  label: mode === "extract" ? "Extract audio" : "Duplicate audio", autoLink: true,
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
/** "Apply to all": the same transition (or none) on every cut of the clip's track, one undo step. */
export const setTransitionAll = (id: string, t: transitions.Transition | undefined): Command => ({ label: t ? `${(transitions.transitionKind(t.kind)?.label ?? "Transition")} on all cuts` : "Remove all transitions", apply: (p) => withRoot(p, (c) => transitions.setTransitionAll(c, id, t)) });
/** V2-SB-133: the clip's in point (where it starts in its video), clamped so the clip still fits in the media. */
export const setSourceIn = (id: string, ticks: number): Command => ({
  label: "In point", coalesceKey: `sourceIn:${id}`,
  apply: (p) => {
    const pl = findPlacement(p.compositions[p.rootCompositionId], id)?.placement;
    const max = pl ? sourceInMax(p, pl) : undefined;
    return max === undefined ? p : withRoot(p, (c) => ops.setSourceIn(c, id, ticks, max));
  },
});
/** P3A-24: exact in/out (source ticks, out exclusive) for a clip; its timeline start stays. */
export const setSourceRange = (id: string, inTicks: number, outTicks: number): Command => ({
  label: "In/out frames", coalesceKey: `range:${id}`,
  apply: (p) => {
    const pl = findPlacement(p.compositions[p.rootCompositionId], id)?.placement;
    const media = pl && clipRange.canSetRange(p, pl) ? clipRange.sourceSpan(p, pl).mediaTicks : undefined;
    return media === undefined ? p : withRoot(p, (c) => clipRange.setSourceRange(c, id, inTicks, outTicks, media));
  },
});
/** P3A-23: join two adjacent clips at a matched frame pair (A's out, B's in), one undo step. */
export const matchJoin = (aId: string, bId: string, aOut: number, bIn: number): Command => ({
  label: "Match frames", apply: (p) => withRoot(p, (c) => clipRange.matchJoin(c, aId, bId, aOut, bIn)),
});
export const setBlend = (id: string, blend: string | undefined): Command => ({ label: "Blend mode", coalesceKey: `blend:${id}`, apply: (p) => withRoot(p, (c) => ops.setBlend(c, id, blend)) });
/** P3B-12: chroma key on a video / image / html clip (null removes it). Slider drags coalesce into one undo step. */
export const setChromaKey = (id: string, key: ChromaKey | null): Command => ({ label: key ? "Chroma key" : "Remove chroma key", coalesceKey: key ? `chroma:${id}` : undefined, apply: (p) => withRoot(p, (c) => ops.setChromaKey(c, id, key)) });
/** P3B-11: the whole volume envelope of a sound clip (a drag coalesces into one undo step). */
export const setVolumeKeys = (id: string, keys: Keyframe[], label = "Volume curve"): Command => ({ label, coalesceKey: `vkeys:${id}`, apply: (p) => withRoot(p, (c) => ops.setVolumeKeys(c, id, keys)) });
/** P3B-11: an audio effect preset and its amount (null removes it). */
export const setAudioFx = (id: string, fx: { preset: string; amount: number } | null): Command => ({ label: fx ? "Audio effect" : "Remove audio effect", coalesceKey: fx ? `afx:${id}` : undefined, apply: (p) => withRoot(p, (c) => ops.setAudioFx(c, id, fx)) });
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
/** P14-SPATIAL: a sound clip's position / position keys (one undo step; drags coalesce). */
export const setPosition = (id: string, pos: { azimuth: number; distance: number; width?: number } | null | undefined, keys?: import("../domain").PositionKey[] | null, label = "Sound position"): Command => ({ label, coalesceKey: keys === undefined && pos ? `pos:${id}` : undefined, apply: (p) => withRoot(p, (c) => ops.setPosition(c, id, pos, keys)) });
export const setTrackPosition = (trackId: string, pos: { azimuth: number; distance: number; width?: number } | null): Command => ({ label: "Track sound position", coalesceKey: pos ? `tpos:${trackId}` : undefined, apply: (p) => withRoot(p, (c) => ops.setTrackPosition(c, trackId, pos)) });
/** V2-106: project canvas size / frame rate / background. Sizes are clamped even (H.264) and within 16..8192. */
export type ProjectSettingsPatch = Partial<{ width: number; height: number; fps: number; background: string; autoLink: boolean; audioOutput: import("../domain").AudioOutput | null }>;
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
    if (patch.audioOutput !== undefined) {
      const a = patch.audioOutput;
      if (a && !["stereo", "binaural"].includes(a.mode)) throw new Error('audioOutput.mode must be "stereo" or "binaural"');
      if (a?.environment && !["room", "outdoor"].includes(a.environment)) throw new Error('audioOutput.environment must be "room" or "outdoor"');
      if (!a || (a.mode === "stereo" && (a.environment ?? "room") === "room")) delete s.audioOutput; else s.audioOutput = { mode: a.mode, ...(a.environment && a.environment !== "room" ? { environment: a.environment } : {}) };
    }
    if (patch.autoLink !== undefined) { if (patch.autoLink) delete s.autoLink; else s.autoLink = false; }
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
  label: "Duplicate", autoLink: true,
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
  label: group === "text" ? "Add stickers" : overlayTrackId ? "Add overlay" : "Add media", autoLink: true,
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

/**
 * Append the storyboard's ready shots, in story order, to the end of the main track, with their layers, captions,
 * effects and transitions (domain/storySend). One undo.
 */
export const sendStoryToTimeline = (): Command => ({
  label: "Send to timeline",
  apply: (p) => sendStory(p).project,
});
/** P10-SYNC: write timeline edits back to the storyboard (domain/storySync). One undo. */
export const syncToStoryboard = (): Command => ({ label: "Sync to storyboard", apply: (p) => syncPlan(p).project });
/** P2A: Send in Update mode: only what changed since the last send (see storySend.updateStory). */
export const updateStoryTimeline = (): Command => ({ label: "Update timeline", apply: (p) => updateStory(p).project });
/** P2A: Send in Replace mode: clear the timeline and rebuild it from the board. */
export const replaceStoryTimeline = (): Command => ({ label: "Replace timeline", apply: (p) => replaceStory(p).project });

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
/** P2A: re-import a revised document into the current storyboard by id (see storyRoundtrip.mergeStoryboard). */
export const mergeStoryboardDoc = (doc: StoryDoc): Command => ({ label: "Update storyboard", apply: (p) => board.setStoryboard(p, mergeStoryboard(p, doc)) });
export const removeStoryboard = (): Command => ({ label: "Remove storyboard", apply: (p) => board.setStoryboard(p, undefined) });
/** P15: dismiss a frameOf slot's "source shot changed" warning for the source shot's current version only. */
export const dismissFrameWarning = (slotId: string): Command => ({ label: "Dismiss frame warning", apply: (p) => board.dismissFrameWarning(p, slotId) });
export const addStoryVersion = (...args: Parameters<typeof board.addStoryVersion> extends [unknown, ...infer R] ? R : never): Command => ({ label: "Upload version", apply: (p) => board.addStoryVersion(p, ...args) });
export const selectStoryVersion = (assetId: string, versionId: string): Command => ({ label: "Choose version", apply: (p) => board.selectStoryVersion(p, assetId, versionId) });
/**
 * V2-SB-121: upload a shot clip longer than planned, either trimmed (`trim`) or kept whole (`keepFullSec` extends
 * the shot's planned length). One undo step.
 */
export const addTrimmedShotVersion = (shotId: string, media: Parameters<typeof board.addStoryVersion>[2], opts: { trim?: board.VersionTrim; keepFullSec?: number; versionId?: string; model?: string } = {}): Command => ({
  label: opts.trim ? "Upload trimmed version" : "Upload version",
  apply: (p) => {
    const next = opts.keepFullSec ? storyEdit.updateShot(p, shotId, { durationSec: opts.keepFullSec }) : p;
    return board.addStoryVersion(next, { shot: shotId }, media, { versionId: opts.versionId, model: opts.model, trim: opts.trim });
  },
});
export const setVersionTrim = (assetId: string, versionId: string, trim: board.VersionTrim | undefined): Command => ({ label: trim ? "Trim version" : "Use full clip", apply: (p) => board.setVersionTrim(p, assetId, versionId, trim) });
export const setStorySkipped = (target: { slot: string } | { shot: string }, skipped: boolean): Command => ({ label: skipped ? "Skip step" : "Include step", apply: (p) => board.setStorySkipped(p, target, skipped) });
export const setQaResult = (versionId: string, checkId: string, result: board.QaResult | undefined): Command => ({ label: "QA check", apply: (p) => board.setQaResult(p, versionId, checkId, result) });

/** Storyboard editing (V2-CUT-02, domain/storyEdit). Each is one undo step. */
export const addShot = (id: string, init: storyEdit.ShotPatch = {}, afterId?: string | null): Command => ({ label: "Add shot", apply: (p) => storyEdit.addShot(p, id, init, afterId) });
export const updateShot = (id: string, patch: storyEdit.ShotPatch, label = "Edit shot"): Command => ({ label, apply: (p) => storyEdit.updateShot(p, id, patch) });
export const duplicateShot = (id: string, copyId: string): Command => ({ label: "Duplicate shot", apply: (p) => storyEdit.duplicateShot(p, id, copyId) });
export const deleteShot = (id: string): Command => ({ label: "Delete shot", apply: (p) => storyEdit.deleteShot(p, id) });
export const moveShot = (id: string, index: number): Command => ({ label: "Move shot", apply: (p) => storyEdit.moveShot(p, id, index) });
export const setConnection = (from: string, to: string, patch: storyEdit.ConnectionPatch): Command => ({ label: "Edit connection", apply: (p) => storyEdit.setConnection(p, from, to, patch) });

/** Per-shot references and asset slots (V2-CUT-05, domain/storyRefs). Each is one undo step. */
export const setRefOverride = (shotId: string, slotId: string, versionId: string | null): Command => ({ label: versionId ? "Pin reference version" : "Unpin reference version", apply: (p) => storyRefs.setRefOverride(p, shotId, slotId, versionId) });
export const addSlot = (id: string, patch: storyRefs.SlotPatch): Command => ({ label: "Add asset", apply: (p) => storyRefs.addSlot(p, id, patch) });
export const updateSlot = (id: string, patch: storyRefs.SlotPatch): Command => ({ label: "Edit asset", apply: (p) => storyRefs.updateSlot(p, id, patch) });
/** V2-SB-136: add a state of asset slot `baseId` (see storyRefs.addState). */
export const addAssetState = (baseId: string, name: string, prompt?: string): Command => ({ label: "Add state", apply: (p) => storyRefs.addState(p, baseId, name, prompt) });
export const deleteSlot = (id: string): Command => ({ label: "Delete asset", apply: (p) => storyRefs.deleteSlot(p, id) });
export const addKeyframe = (shotId: string, slotId: string): Command => ({ label: "Add keyframe", apply: (p) => storyRefs.addKeyframe(p, shotId, slotId) });

/** Production step order (V2-CUT-07, domain/storySteps): move step `key` to index `to`, clamped to dependency order. */
export const moveStep = (key: string, to: number): Command => ({ label: "Move step", apply: (p) => storySteps.moveStep(p, board.productionSteps(p).map((s) => s.key), key, to) });
export const resetStepOrder = (): Command => ({ label: "Reset step order", apply: (p) => storySteps.resetStepOrder(p) });

/** P9-LINK: link clip `id` to the main clip under its start (`on`), or unlink it. */
export const setClipLink = (id: string, on: boolean): Command => ({
  label: on ? "Link to main" : "Unlink from main",
  apply: (p) => withRoot(p, (c) => setLink(c, id, on)),
});

/**
 * P18: Add audio → From Video in one undo step: import the audio asset taken from a video, put its placement on the
 * first audio track free at its time (else a new one), and optionally mute the source video's clips (`muteClips`).
 */
export const addAudioFromVideo = (asset: Asset, placement: Placement, muteClips: string[] = []): Command => ({
  label: "Add audio from video",
  apply: (p) => {
    const next = { ...p, assets: { ...p.assets, [asset.id]: asset } };
    return withRoot(next, (c) => {
      let comp = c;
      let tid = comp.tracks.find((t) => t.kind === "audio" && !t.placements.some((q) => q.startTicks < placement.startTicks + placement.durationTicks && placement.startTicks < q.startTicks + q.durationTicks))?.id;
      if (!tid) { tid = newId("trk"); comp = ops.addTrack(comp, "audio", tid); }
      comp = ops.insertPlacement(comp, tid, placement);
      for (const id of muteClips) comp = ops.setLinkedAudioMuted(comp, id, true);
      return comp;
    });
  },
});

/**
 * P20: move overlay clip `id` onto the main track (domain/promote): "replace" covers the main track over the clip's
 * range, "insert" ripples it later. One undo step. The promoted clip maps to a storyboard shot when its asset is a
 * shot's clip; otherwise Sync to Storyboard makes it a new shot that needs a prompt.
 */
export const promoteOverlay = (id: string, opts: PromoteOptions = {}): Command => ({
  label: "Promote to main track",
  apply: (p) => withRoot(p, (c) => {
    const r = promoteToMain(c, id, opts);
    if (r.plan.mode === "insert" && r.plan.inside && !opts.position) throw new Error(`The clip starts inside main clip ${r.plan.inside.id}: choose position "before" or "after"`);
    const pl = r.comp.tracks.flatMap((t) => t.placements).find((x) => x.id === id);
    if (!pl || pl.storyShot) return r.comp;
    const shot = Object.values(p.storyboard?.shots ?? {}).find((s) => s.assetId && s.assetId === pl.source.assetId);
    if (!shot) return r.comp;
    return { ...r.comp, tracks: r.comp.tracks.map((t) => ({ ...t, placements: t.placements.map((x) => (x.id === id ? { ...x, storyShot: shot.id } : x)) })) };
  }),
});
