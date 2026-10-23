/** Command factories for the MVP timeline. Each wraps a pure domain op. */
import type { Command } from "./engine";
import { DEFAULT_IMAGE_TICKS, newId, trackKindFor, type Asset, type AssetVersion, type Composition, type Placement, type Project, type TrackKind } from "../domain/model";
import * as ops from "../domain/ops";
import * as subs from "../domain/subtitles";
import * as edit from "../domain/edit";
import type { Subtitle } from "../domain/model";

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
      let tid = trackId && comp.tracks.find((t) => t.id === trackId && t.kind === kind) ? trackId : comp.tracks.find((t) => t.kind === kind)?.id;
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
