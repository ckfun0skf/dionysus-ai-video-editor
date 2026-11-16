/// <reference types="vite/client" />
/**
 * Clip type UI table (P69/P70, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 steps 1.4–1.5). Each optional
 * `src/v2/clipTypes/<id>/ui.tsx` default-exports a `ClipTypeUi` with what the editor shows for that type: on the
 * timeline its name, icon, card body, background, filmstrip / waveform strips, and how its asset gets a thumbnail and
 * previews (P69); in the inspector its icon, title, tabs and header actions, on the mobile clip toolbar its primary
 * tools, and which shared tools, sheets and menu items apply (P70). Fields are declarative (decision Q4): tabs, tools
 * and actions are ids of panels and buttons the editor host owns (`V2App.tsx`). Anything a type leaves out takes
 * `DEFAULT_CLIP_UI` (a plain media clip named after its asset), and so does a `clipType` this build does not register.
 */
import type { CSSProperties, ReactNode } from "react";
import type { MediaKind, Placement, Project } from "../domain";
import { CLIP_TYPES, variantOf } from "../clipTypes";

export type WaveKind = "audio" | "video";

/** Inspector tabs the host can show (P70). Optional ones appear only when they apply: `speed` (speed, time tools or
 * in point available), `transition` (the clip starts a cut). `label` renames a tab (text shows Basic as "Transform"). */
export type InspectorTabId = "basic" | "speed" | "audio" | "chroma" | "transition" | "text" | "effect" | "params" | "colour";
export type InspectorTabRef = InspectorTabId | { id: InspectorTabId; label: string };
/** Buttons in the desktop inspector header (P70); `edit-all` only for a clip on a styled text layer. */
export type InspectorActionId = "edit-all" | "caption-style" | "subtitles" | "edit-code";
/** Primary tools on the mobile clip toolbar (P70); a nested list is "the first of these that applies". */
export type ToolId = "adjust" | "audio" | "speed" | "link" | "to-main" | "colour" | "fx" | "style" | "anim" | "subs" | "params" | "code" | "edit-audio";
export type ToolRef = ToolId | ToolId[];

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
  // ---- P70: inspector, toolbar, sheets and menus ----
  /** Inspector header icon (default "▭") and title (default: the asset's name, else the clip type id). */
  inspectorIcon?: string;
  inspectorTitle?(p: Placement, project: Project): string;
  /** Inspector tabs in order (default: basic, speed, audio, chroma, transition). */
  inspectorTabs?: InspectorTabRef[];
  /** Inspector header buttons (default none). */
  inspectorActions?: InspectorActionId[];
  /** Mobile clip toolbar primary tools: on an overlay / other track (default adjust, link, to-main) and on the main
   * track (default adjust, audio, speed; a type that sets only `toolbar` uses it on both). */
  toolbar?: ToolRef[];
  toolbarMain?: ToolRef[];
  /** Extra tools this type adds to the shared groups: `fill` (placeholder), `adjust` next to the source tools (text). */
  extraTools?: ("fill" | "adjust")[];
  /** The type-specific data editor: text panel, effect picker or code editor (gizmo edit, sheets). */
  editor?: "text" | "effect" | "code";
  /** Playback speed applies (default true). */
  speed?: boolean;
  /** Volume slider in the audio sheet (default true). */
  volume?: boolean;
  /** Freeze frame and reverse (toolbar, Speed tab, context menu). */
  timeTools?: boolean;
  /** In / out frame strip in the Basic tab and the Adjust sheet. */
  inOutFrames?: boolean;
  /** The clip owns linked audio: extract, duplicate, mute clip audio. */
  linkedAudio?: boolean;
  /** Fades and keyframes live in the Audio tab (the type has no Basic tab). */
  transformInAudioTab?: boolean;
}

type Optional = "body" | "background" | "icon" | "emptyName" | "titlePrefix" | "kindClass" | "editor";
export type ResolvedClipTypeUi = Required<Omit<ClipTypeUi, Optional>> & Pick<ClipTypeUi, Optional>;

/** A plain media clip: named after its asset, thumbnail background, a waveform when there are peaks. */
export const DEFAULT_CLIP_UI: ResolvedClipTypeUi = {
  id: "default",
  name: (p, project) => project.assets[p.source.assetId]?.name,
  thumbBackground: true,
  filmstrip: false,
  waveform: () => "video",
  assetThumb: "frame",
  assetPreviews: { peaks: true, filmstrip: false },
  inspectorIcon: "▭",
  inspectorTitle: (p, project) => project.assets[p.source.assetId]?.name ?? p.clipType,
  inspectorTabs: ["basic", "speed", "audio", "chroma", "transition"],
  inspectorActions: [],
  toolbar: ["adjust", "link", "to-main"],
  toolbarMain: ["adjust", "audio", "speed"],
  extraTools: [],
  speed: true,
  volume: true,
  timeTools: false,
  inOutFrames: false,
  linkedAudio: false,
  transformInAudioTab: false,
};

/** Problems with one UI module (empty = valid). */
export function checkClipTypeUi(u: unknown, folder: string): string[] {
  const x = u as Partial<ClipTypeUi> | undefined;
  if (!x || typeof x !== "object") return ["no default export (export default { id, … })"];
  const out: string[] = [];
  if (x.id !== folder) out.push(`id "${String(x.id)}" must equal its folder name "${folder}"`);
  if (typeof x.id === "string" && !CLIP_TYPES.core(x.id)) out.push(`no clip type "${x.id}" is registered (add clipTypes/${x.id}/core.ts)`);
  for (const k of ["name", "body", "background", "waveform", "inspectorTitle"] as const) if (x[k] !== undefined && typeof x[k] !== "function") out.push(`${k} must be a function`);
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
    const m = mod.default!;
    uis.set(folder, { ...DEFAULT_CLIP_UI, ...m, toolbarMain: m.toolbarMain ?? m.toolbar ?? DEFAULT_CLIP_UI.toolbarMain });
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
