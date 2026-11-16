/**
 * P71 (Phase 1 step 1.6 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): storyboard mapping and media-kind detection read the
 * clip type cores (`story`, `accepts`) instead of switches in storyboard.ts, storySend.ts, storySync.ts and
 * persistence/media.ts. Pure (core layer): `domain` only through `import type`.
 */
import { CLIP_TYPES, coreOf } from "./index";
import type { ClipStory } from "./types";
import type { MediaKind } from "../domain/model";
import type { StoryAssetType } from "../domain/storyJson";

/** The mapping of a type without `story` (text, effect, the variants, unknown): what the old switches did for them. */
export const DEFAULT_CLIP_STORY: ClipStory = { assetTypes: [], slotType: "image", layerType: "image", layer: false, sendLength: "media", takes: false, params: false };

/** The storyboard mapping of a stored `clipType` or asset kind (no variant lookup). */
export const storyOf = (kind: string): ClipStory => coreOf(kind).story ?? DEFAULT_CLIP_STORY;

/** The asset kind a storyboard slot type holds: the type listing it in `story.assetTypes`, else the fallback (image). */
export function kindForSlotType(t: StoryAssetType | string): MediaKind {
  const all = CLIP_TYPES.list();
  const hit = all.find((c) => c.story?.assetTypes.includes(t as StoryAssetType)) ?? all.find((c) => c.story?.slotFallback);
  return (hit?.id ?? "image") as MediaKind;
}

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The asset kind of an imported file: its MIME type first, then its extension; undefined = not importable. */
export function kindForFile(file: { type: string; name: string }): MediaKind | undefined {
  const all = CLIP_TYPES.list().filter((c) => c.accepts);
  const byMime = all.find((c) => (c.accepts!.mimePrefix && file.type.startsWith(c.accepts!.mimePrefix)) || c.accepts!.mime?.includes(file.type));
  if (byMime) return byMime.id as MediaKind;
  const ext = extOf(file.name);
  return all.find((c) => c.accepts!.ext.includes(ext))?.id as MediaKind | undefined;
}

/** The file's MIME type, or one guessed from its extension (iOS picker files sometimes arrive with an empty type). */
export function mimeForFile(file: { type: string; name: string }): string {
  if (file.type) return file.type;
  const ext = extOf(file.name);
  for (const c of CLIP_TYPES.list()) { const m = c.accepts && Object.prototype.hasOwnProperty.call(c.accepts.mimeByExt, ext) ? c.accepts.mimeByExt[ext] : undefined; if (m) return m; }
  return "";
}
