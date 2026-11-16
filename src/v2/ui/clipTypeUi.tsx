/// <reference types="vite/client" />
/**
 * Clip type UI table (P69, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 step 1.4). Each optional
 * `src/v2/clipTypes/<id>/ui.tsx` default-exports a `ClipTypeUi` with what the timeline shows for that type: its name,
 * icon, card body, background, filmstrip / waveform strips, and how its asset gets a thumbnail and previews. Fields
 * are declarative (decision Q4); anything a type leaves out takes `DEFAULT_CLIP_UI` (a plain media clip named after
 * its asset), and so does a `clipType` this build does not register.
 */
import type { CSSProperties, ReactNode } from "react";
import type { MediaKind, Placement, Project } from "../domain";
import { CLIP_TYPES, variantOf } from "../clipTypes";

export type WaveKind = "audio" | "video";

export interface ClipTypeUi {
  /** The clip type id (folder name). */
  id: string;
  /** Name on the timeline clip and in its tooltip (default: the asset's name). */
  name?(p: Placement, project: Project): string | undefined;
  /** Line icon before the name inside timeline clips (ui/Icon.tsx key); with one, an empty name shows `emptyName`. */
  icon?: string;
  emptyName?: string;
  /** Tooltip prefix on the expanded timeline ("Effect: "). */
  titlePrefix?: string;
  /** Extra `.v2-clip` class (the P35 placeholder card, the P36 blank swatch). */
  kindClass?: string;
  /** Replaces the whole clip body (name, strips, badges): the placeholder card and the blank swatch. */
  body?(p: Placement): ReactNode;
  /** Clip box background instead of the asset thumbnail (blank: its colour); undefined = the thumbnail rule. */
  background?(p: Placement): CSSProperties | undefined;
  /** Show the asset thumbnail as the clip background (default true; audio: false). */
  thumbBackground?: boolean;
  /** Draw the asset version's filmstrip in the clip (video). */
  filmstrip?: boolean;
  /** Waveform inside the clip, when the asset version has peaks: its look, or none (default "video"). */
  waveform?(p: Placement): WaveKind | undefined;
  /** How an asset of this kind gets its tile thumbnail: a decoded frame (default), a rendered HTML page, or none. */
  assetThumb?: "frame" | "html" | "none";
  /** Which per-version previews are computed for an asset of this kind (default: peaks only). */
  assetPreviews?: { peaks: boolean; filmstrip: boolean };
}

export type ResolvedClipTypeUi = Required<Omit<ClipTypeUi, "body" | "background" | "icon" | "emptyName" | "titlePrefix" | "kindClass">> & Pick<ClipTypeUi, "body" | "background" | "icon" | "emptyName" | "titlePrefix" | "kindClass">;

/** A plain media clip: named after its asset, thumbnail background, a waveform when there are peaks. */
export const DEFAULT_CLIP_UI: ResolvedClipTypeUi = {
  id: "default",
  name: (p, project) => project.assets[p.source.assetId]?.name,
  thumbBackground: true,
  filmstrip: false,
  waveform: () => "video",
  assetThumb: "frame",
  assetPreviews: { peaks: true, filmstrip: false },
};

/** Problems with one UI module (empty = valid). */
export function checkClipTypeUi(u: unknown, folder: string): string[] {
  const x = u as Partial<ClipTypeUi> | undefined;
  if (!x || typeof x !== "object") return ["no default export (export default { id, … })"];
  const out: string[] = [];
  if (x.id !== folder) out.push(`id "${String(x.id)}" must equal its folder name "${folder}"`);
  if (typeof x.id === "string" && !CLIP_TYPES.core(x.id)) out.push(`no clip type "${x.id}" is registered (add clipTypes/${x.id}/core.ts)`);
  for (const k of ["name", "body", "background", "waveform"] as const) if (x[k] !== undefined && typeof x[k] !== "function") out.push(`${k} must be a function`);
  if (x.assetThumb !== undefined && !["frame", "html", "none"].includes(x.assetThumb)) out.push(`assetThumb must be "frame", "html" or "none"`);
  return out;
}

export function loadClipTypeUis(found: Record<string, { default?: ClipTypeUi }>): { uis: Map<string, ResolvedClipTypeUi>; problems: string[] } {
  const uis = new Map<string, ResolvedClipTypeUi>();
  const problems: string[] = [];
  for (const [path, mod] of Object.entries(found).sort(([a], [b]) => a.localeCompare(b))) {
    const folder = path.split("/").at(-2) ?? "";
    const issues = checkClipTypeUi(mod.default, folder);
    if (issues.length) { problems.push(...issues.map((i) => `${path}: ${i}`)); continue; }
    uis.set(folder, { ...DEFAULT_CLIP_UI, ...mod.default! });
  }
  return { uis, problems };
}

const found = import.meta.glob<{ default?: ClipTypeUi }>("../clipTypes/*/ui.tsx", { eager: true });
export const { uis: CLIP_TYPE_UIS, problems: CLIP_TYPE_UI_PROBLEMS } = loadClipTypeUis(found);
export const CLIP_TYPE_UI_PATHS = Object.keys(found);
if (CLIP_TYPE_UI_PROBLEMS.length) console.error(`[clipTypeUi] ${CLIP_TYPE_UI_PROBLEMS.length} invalid clip type UI module(s):\n  ${CLIP_TYPE_UI_PROBLEMS.join("\n  ")}`);

/** The timeline UI for a placement (its variant first; unknown types get the default). */
export const clipUi = (p: Placement): ResolvedClipTypeUi => CLIP_TYPE_UIS.get(variantOf(p)) ?? DEFAULT_CLIP_UI;
/** The UI for an asset kind (thumbnails and previews of the Media panel and timeline). */
export const assetUi = (kind: MediaKind | string): ResolvedClipTypeUi => CLIP_TYPE_UIS.get(kind) ?? DEFAULT_CLIP_UI;
