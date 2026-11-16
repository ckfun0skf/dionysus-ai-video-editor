/**
 * P79: storyboard scene assets may carry their dionysus.scene/1 scene inline ("scene" on an asset of type "scene").
 * Importing such a board (import_storyboard, the Import screen) stores each inline scene as a version of its asset in
 * the SAME undo step as the import. A scene equal to the asset's current version is not stored again (re-importing an
 * unchanged board adds no versions).
 */
import { board, type Project, type SceneDoc, type StoryDoc } from "../../domain";
import type { Command } from "../../engine";
import type { BlobStore } from "../../ports";
import { blobText } from "../AssetPreview";
import { storeSceneMedia } from "../sceneAsset";

const canon = (v: unknown) => JSON.stringify(v);

/** Is `doc` the scene the board's asset `id` shows now? */
async function sameAsCurrent(p: Project, id: string, doc: SceneDoc, blobs: Pick<BlobStore, "get">): Promise<boolean> {
  const slot = p.storyboard?.slots[id];
  const a = slot?.assetId ? p.assets[slot.assetId] : undefined;
  const v = a?.versions.find((x) => x.id === a.selectedVersionId);
  if (!slot || !v || a?.kind !== "scene") return false;
  const b = await blobs.get(v.media.blobKey);
  if (!b) return false;
  try { return canon(JSON.parse(await blobText(b))) === canon(doc); } catch { return false; }
}

/**
 * The step to dispatch after the import command (same `engine.dispatch([...])`): stores the new inline scenes and adds
 * them as versions. `stored` / `same` list asset ids for the reply.
 */
export async function inlineSceneStep(p: Project, doc: StoryDoc, blobs: Pick<BlobStore, "get" | "put">): Promise<{ command?: Command; stored: string[]; same: string[] }> {
  const stored: string[] = [], same: string[] = [], adds: { id: string; media: Awaited<ReturnType<typeof storeSceneMedia>> }[] = [];
  for (const a of doc.assets) {
    if (a.type !== "scene" || !a.scene) continue;
    if (await sameAsCurrent(p, a.id, a.scene, blobs)) { same.push(a.id); continue; }
    adds.push({ id: a.id, media: await storeSceneMedia(blobs, a.scene) });
    stored.push(a.id);
  }
  if (!adds.length) return { stored, same };
  const command: Command = {
    label: `Store ${adds.length} inline scene${adds.length === 1 ? "" : "s"}`,
    apply: (p0) => adds.reduce((q, x) => (q.storyboard?.slots[x.id] ? board.addStoryVersion(q, { slot: x.id }, x.media) : q), p0),
  };
  return { command, stored, same };
}

/** For callers that only need the commands (one undo step with the import). */
export const withInlineScenes = (importCmd: Command, step: { command?: Command }): Command[] => (step.command ? [importCmd, step.command] : [importCmd]);
