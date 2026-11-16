/**
 * P73 (Phase 1 step 1.8, decision 9 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): clip **states** the host owns for every
 * type, checked before any plugin lookup. Today there is one: a placeholder (a storyboard shot with no clip yet, P35).
 * Any clip type can be a placeholder: the `placeholder` field marks it and `clipType` keeps the intended type, so Fill
 * can offer matching assets. Plugins never see a placeholder: the player, timeline and export draw it with the shared
 * slate (`render/placeholderSlate.ts`, `ui/clipTypeUi.tsx` PLACEHOLDER_UI) and the caps below.
 * No schema change: Send to timeline still writes `clipType: "image"` + `placeholder`, as since P35.
 * Pure (core layer): `domain` only through `import type`.
 */
import type { ClipCaps, ClipTypeCore } from "./types";
import type { MediaKind, Placement } from "../domain/model";

/** The id the state answers to (`clipTypeOf(p).id`, `clipUi(p).id`). Not a registered type: there is no clipTypes/placeholder. */
export const PLACEHOLDER_STATE = "placeholder";

/** Is this clip a placeholder (any clipType)? */
export const isPlaceholder = (p: Partial<Pick<Placement, "placeholder">>): boolean => !!p.placeholder;

/**
 * A placeholder's caps: no media, no sound, one still frame; drawn (as the slate) and keyable when its intended type
 * is. For the image placeholder these are exactly the pre-P73 placeholder caps.
 */
export const placeholderCaps = (intended: ClipCaps): ClipCaps => ({ sourceTime: false, still: true, sound: false, visual: intended.visual, keyable: intended.keyable, thumb: false, asset: "none" });

const cores = new Map<ClipTypeCore, ClipTypeCore>();
/** The state core for a placeholder of `intended` type: the placeholder caps, the intended type's track kind, nothing else. */
export function placeholderCore(intended: ClipTypeCore): ClipTypeCore {
  let c = cores.get(intended);
  if (!c) {
    c = { id: PLACEHOLDER_STATE, version: 1, description: "A storyboard shot with no clip yet: a labelled slate in preview, a dark frame in export (warned first).", trackKind: intended.trackKind, caps: placeholderCaps(intended.caps) };
    cores.set(intended, c);
  }
  return c;
}

/**
 * Which asset kinds Fill offers a placeholder of `clipType`. The image placeholder (what Send to timeline makes, whose
 * real kind is not known) takes any asset but audio, as since P35; a placeholder of another type takes its own kind.
 */
export function placeholderAccepts(clipType: string): (kind: MediaKind) => boolean {
  if (clipType === "image") return (k) => k !== "audio";
  return (k) => k === clipType;
}
