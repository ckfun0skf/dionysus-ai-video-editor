/// <reference types="vite/client" />
/**
 * Clip type UI table (P69/P70, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md Phase 1 steps 1.4–1.5). Each optional
 * `src/v2/clipTypes/<id>/ui.tsx` default-exports a `ClipTypeUi` with what the editor shows for that type: on the
 * timeline its name, icon, card body, background, filmstrip / waveform strips, and how its asset gets a thumbnail and
 * previews (P69); in the inspector its icon, title, tabs and header actions, on the mobile clip toolbar its primary
 * tools, and which shared tools, sheets and menu items apply (P70). Fields are declarative (decision Q4): tabs, tools
 * and actions are ids of panels and buttons the editor host owns (`V2App.tsx`). Anything a type leaves out takes
 * `DEFAULT_CLIP_UI` (a plain media clip named after its asset).
 *
 * P73 (step 1.8, decision 9): the host owns two entries no plugin provides. A placeholder of any type gets
 * `placeholderUi` (the P35 hatched card, checked before any type lookup), and a `clipType` this build does not register
 * gets `UNKNOWN_CLIP_UI` (a card naming the missing type and a read-only inspector tab).
 */
import type { CSSProperties, ReactNode } from "react";
import type { MediaKind, Placement, Project } from "../domain";
import { CLIP_TYPES, coreOf, isKnownClipType, isPlaceholder, isPluginEnabled, pluginIssueOf, pluginMetaOf, unknownSlateText, variantOf } from "../clipTypes";
import { Ic } from "./Icon";
import { pluginStatus } from "../render";

export type WaveKind = "audio" | "video";

/** Inspector tabs the host can show (P70). Optional ones appear only when they apply: `speed` (speed, time tools or
 * in point available), `transition` (the clip starts a cut). `label` renames a tab (text shows Basic as "Transform"). */
export type InspectorTabId = "basic" | "speed" | "audio" | "chroma" | "transition" | "text" | "effect" | "params" | "colour" | "unknown" | "scene" | "plugin";
export type InspectorTabRef = InspectorTabId | { id: InspectorTabId; label: string };
/** Buttons in the desktop inspector header (P70); `edit-all` only for a clip on a styled text layer. */
export type InspectorActionId = "edit-all" | "caption-style" | "subtitles" | "edit-code";
/** Primary tools on the mobile clip toolbar (P70); a nested list is "the first of these that applies". */
export type ToolId = "adjust" | "audio" | "speed" | "link" | "to-main" | "colour" | "fx" | "style" | "anim" | "subs" | "params" | "code" | "edit-audio" | "scene" | "plugin";
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

/**
 * P35 / P73: the placeholder card and inspector, for a placeholder of any type: the shot label and "Not generated" on a
 * hatched card, the Basic tab (its Fill section), chroma key when the intended type is keyable, Fill when the intended
 * type reads an asset. For the image placeholder Send makes, exactly the pre-P73 `clipTypes/placeholder/ui.tsx`.
 */
export const PLACEHOLDER_UI: ResolvedClipTypeUi = {
  ...DEFAULT_CLIP_UI,
  id: "placeholder",
  kindClass: "is-placeholder",
  inspectorIcon: "image",
  inspectorTabs: ["basic", "chroma", "transition"],
  extraTools: ["fill"],
  speed: false,
  volume: false,
  // A placeholder that also carries a blank flag keeps the blank colour behind its card, as before P69.
  background: (p) => (p.blank ? { background: p.blank.color } : undefined),
  body: (p) => (
    <span className="v2-clip-name v2-ph" title={`${p.placeholder!.label} — not generated yet. Add its clip on the storyboard and Send to timeline (Update), or Fill placeholder (pick or upload a clip).`}>
      <Ic g="board" size={12} /><span className="v2-ph-label">{p.placeholder!.label}</span><span className="v2-ph-state">Not generated</span>
    </span>
  ),
};
const placeholderUis = new Map<string, ResolvedClipTypeUi>([["image", PLACEHOLDER_UI]]);
/** The placeholder UI for a placeholder whose intended type is `clipType` (cached per type). */
export function placeholderUi(clipType: string): ResolvedClipTypeUi {
  let u = placeholderUis.get(clipType);
  if (!u) {
    const core = coreOf(clipType);
    u = {
      ...PLACEHOLDER_UI,
      inspectorIcon: (isKnownClipType(clipType) && CLIP_TYPE_UIS.get(clipType)?.inspectorIcon) || PLACEHOLDER_UI.inspectorIcon,
      inspectorTabs: core.caps.keyable ? PLACEHOLDER_UI.inspectorTabs : ["basic", "transition"],
      extraTools: core.caps.asset === "media" ? ["fill"] : [],
    };
    placeholderUis.set(clipType, u);
  }
  return u;
}

/** P73 (§6): a clip of a type this build does not register: a card naming the type; only moving, trimming and deleting. */
export const UNKNOWN_CLIP_UI: ResolvedClipTypeUi = {
  ...DEFAULT_CLIP_UI,
  id: "unknown",
  kindClass: "is-unknown",
  name: (p) => (p.clipType.startsWith("x-") ? unknownSlateText(p.clipType)[0] : `Unknown type “${p.clipType}”`),
  thumbBackground: false,
  waveform: () => undefined,
  assetThumb: "none",
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "⚠",
  inspectorTitle: (p) => (p.clipType.startsWith("x-") ? unknownSlateText(p.clipType)[0] : `Unknown clip type “${p.clipType}”`),
  inspectorTabs: ["unknown"],
  toolbar: ["link", "to-main"],
  toolbarMain: [],
  speed: false,
  volume: false,
  body: (p) => (
    <span className="v2-clip-name v2-ph v2-unknown" title={`This clip's type “${p.clipType}” is not in this version of the editor. Its data is kept as is; it shows as a slate and exports as a black frame.`}>
      <Ic g="⚠" size={12} /><span className="v2-ph-label">{pluginIssueOf(p.clipType)?.name ?? p.clipType}</span><span className="v2-ph-state">{p.clipType.startsWith("x-") ? (pluginIssueOf(p.clipType)?.state === "missing" || !pluginIssueOf(p.clipType) ? "Plugin missing" : "Plugin error") : "Unknown type"}</span>
    </span>
  ),
};

/**
 * P84: a clip of a registered third-party plugin type (Phase 3): a neutral card with the plugin's name and "Not
 * enabled", the Plugin inspector tab (details and settings, read-only for now) and transitions; move, trim, split,
 * delete, link and undo work. Its sandboxed renderer comes in P85, so it draws the slate until then.
 */
export const PLUGIN_CLIP_UI: ResolvedClipTypeUi = {
  ...DEFAULT_CLIP_UI,
  id: "plugin",
  kindClass: "is-plugin",
  name: (p) => pluginMetaOf(p.clipType)?.name ?? p.clipType,
  thumbBackground: false,
  waveform: () => undefined,
  assetThumb: "none",
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "puzzle",
  inspectorTitle: (p) => `Plugin “${pluginMetaOf(p.clipType)?.name ?? p.clipType}”`,
  inspectorTabs: ["plugin", "transition"],
  toolbar: ["plugin", "link", "to-main"],
  toolbarMain: ["plugin"],
  speed: false,
  volume: false,
  body: (p) => {
    const name = pluginMetaOf(p.clipType)?.name ?? p.clipType;
    // P85: an enabled plugin draws in its sandbox, so its card is a plain named card.
    if (isPluginEnabled(p.clipType)) {
      // P86: a clip whose plugin stopped in the preview says so on its card too.
      const stop = pluginStatus.stopped(p.id);
      return stop
        ? <span className="v2-clip-name v2-ph" title={`Plugin “${name}” stopped: it hung or failed. Select the clip and choose Retry.`}><Ic g="puzzle" size={12} /><span className="v2-ph-label">{name}</span><span className="v2-ph-state is-stopped">Stopped</span></span>
        : <span className="v2-clip-name" title={`Plugin “${name}”`}><Ic g="puzzle" size={12} /> {name}</span>;
    }
    return (
      <span className="v2-clip-name v2-ph" title={`Plugin “${name}” is not enabled. Its settings are kept; it shows as a slate and exports as a black frame.`}>
        <Ic g="puzzle" size={12} /><span className="v2-ph-label">{name}</span><span className="v2-ph-state">Not enabled</span>
      </span>
    );
  },
};

/** P85: an enabled plugin's card: solid (it draws in its sandbox), not the hatched "not enabled" look. */
export const PLUGIN_ENABLED_CLIP_UI: ResolvedClipTypeUi = { ...PLUGIN_CLIP_UI, kindClass: "is-plugin is-on" };

/** The timeline UI for a placement: a placeholder first (any type), then its variant or type; unknown types get UNKNOWN_CLIP_UI. */
export const clipUi = (p: Placement): ResolvedClipTypeUi => {
  if (isPlaceholder(p)) return placeholderUi(p.clipType);
  if (pluginMetaOf(p.clipType)) return isPluginEnabled(p.clipType) ? PLUGIN_ENABLED_CLIP_UI : PLUGIN_CLIP_UI;
  const id = variantOf(p);
  return CLIP_TYPE_UIS.get(id) ?? (isKnownClipType(id) ? DEFAULT_CLIP_UI : UNKNOWN_CLIP_UI);
};
/** The UI for an asset kind (thumbnails and previews of the Media panel and timeline). */
export const assetUi = (kind: MediaKind | string): ResolvedClipTypeUi => CLIP_TYPE_UIS.get(kind) ?? DEFAULT_CLIP_UI;
