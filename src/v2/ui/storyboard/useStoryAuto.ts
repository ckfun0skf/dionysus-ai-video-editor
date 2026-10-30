/**
 * P2B: keeps app-made storyboard media up to date while the storyboard is open (see domain/storyAuto):
 * draws still-shot backgrounds (item 20) and takes last frames of picked clip versions (item 17).
 * Each job runs once per signature; failures are reported through `onNote` and not retried until the input changes.
 */
import { useEffect, useRef } from "react";
import { story, storyAuto, type Project } from "../../domain";
type StoryBackground = story.StoryBackground;
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { extractLastFrame } from "./lastFrame";

/** Draw a background as a PNG (undefined when the browser has no 2D canvas, e.g. in tests). */
export async function drawBackground(bg: StoryBackground, aspect: string): Promise<{ blob: Blob; width: number; height: number } | undefined> {
  const { width, height } = storyAuto.aspectSize(aspect);
  const c = document.createElement("canvas"); c.width = width; c.height = height;
  let g: CanvasRenderingContext2D | null = null;
  try { g = c.getContext("2d"); } catch { g = null; }
  if (!g) return undefined;
  if (typeof bg === "string") g.fillStyle = bg;
  else {
    const q = storyAuto.gradientGeometry(bg, width, height);
    const grad = q.r !== undefined ? g.createRadialGradient(q.x0, q.y0, 0, q.x1, q.y1, q.r) : g.createLinearGradient(q.x0, q.y0, q.x1, q.y1);
    for (const s of storyAuto.resolvedStops(bg.stops)) grad.addColorStop(s.at, s.color);
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  return blob ? { blob, width, height } : undefined;
}

export function useStoryAuto(project: Project, engine: Engine, blobs: BlobStore, onNote?: (text: string) => void) {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    for (const j of storyAuto.backgroundJobs(project)) {
      const key = `bg|${j.slotId}|${j.signature}`;
      if (tried.current.has(key)) continue;
      tried.current.add(key);
      void (async () => {
        const fr = await drawBackground(j.background, j.aspect).catch(() => undefined);
        if (!fr) return;
        const blobKey = `background/${j.slotId}/${Date.now()}`;
        await blobs.put(blobKey, fr.blob);
        engine.dispatch(cmd.addStoryVersion({ slot: j.slotId }, { blobKey, mime: "image/png", width: fr.width, height: fr.height }, { bg: j.signature }));
      })().catch(() => undefined);
    }
    // jsdom (tests) can't decode video; the manual "Use last frame" button stays available everywhere.
    const canDecode = typeof navigator === "undefined" || !/jsdom/i.test(navigator.userAgent);
    for (const j of canDecode ? storyAuto.lastFrameJobs(project) : []) {
      const key = `lf|${j.slotId}|${j.versionId}|${j.endSec ?? ""}`;
      if (tried.current.has(key)) continue;
      tried.current.add(key);
      void (async () => {
        const blob = await blobs.get(j.blobKey);
        if (!blob) return;
        const fr = await extractLastFrame(blob, 8000, j.endSec);
        const blobKey = `lastframe/${j.slotId}/${j.versionId}/${Date.now()}`;
        await blobs.put(blobKey, fr.blob);
        engine.dispatch(cmd.addStoryVersion({ slot: j.slotId }, { blobKey, mime: "image/png", width: fr.width, height: fr.height }, { derivedFrom: { shotId: j.shotId, versionId: j.versionId }, ...(j.endSec !== undefined ? { lfEnd: j.endSec } : {}) }));
      })().catch((e) => onNote?.(`Couldn't take the last frame for “${project.storyboard?.slots[j.slotId]?.name ?? j.slotId}” automatically (${e instanceof Error ? e.message : String(e)}). Open it to take or upload it.`));
    }
  }, [project, engine, blobs, onNote]);
}
