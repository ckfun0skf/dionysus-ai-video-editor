import { readManifest, resolveClipBindings, resolveHtmlParams, type Project } from "../domain";
import type { BlobStore } from "../ports";
import { HtmlClipHost, type HtmlClipInit } from "../render";

const THUMB_H = 96;
let queue: Promise<unknown> = Promise.resolve();

/** The clip-local second a thumbnail shows: about 1 s in, or the middle of a shorter clip. */
export const htmlThumbTime = (durationSec: number | undefined) => (durationSec && durationSec > 0 ? Math.min(1, durationSec / 2) : 1);

/**
 * Thumbnail (JPEG data URL) of an HTML clip version (V2-SB-130): the page runs in the same sandboxed runtime the player
 * uses, with its bound assets, and the frame at `htmlThumbTime` is drawn 96 px tall. One page at a time (thumbnails
 * queue), so a board full of HTML versions never opens many iframes at once. Undefined when the page gives no frame.
 * `params` are per-use overrides (V2-HTML-PARAMS: a shot's title text), merged over the manifest defaults.
 */
export function grabHtml(blob: Blob, project: Project, blobs: BlobStore, durationSec?: number, params?: Record<string, unknown>): Promise<string | undefined> {
  const go = () => renderHtmlThumb(blob, project, blobs, durationSec, params);
  const run = queue.then(go, go);
  queue = run.catch(() => undefined);
  return run;
}

async function renderHtmlThumb(blob: Blob, project: Project, blobs: BlobStore, durationSec?: number, params?: Record<string, unknown>): Promise<string | undefined> {
  if (typeof document === "undefined") return undefined;
  const html = await blob.text();
  const m = readManifest(html);
  // Drawn at the project's frame shape, as the clip plays on the timeline.
  const aw = project.settings.width, ah = project.settings.height;
  const h = 180, w = Math.max(1, Math.round((h * aw) / Math.max(1, ah)));
  const dur = durationSec ?? m.durationSec;
  const host = new HtmlClipHost(Promise.resolve(html), w, h, () => undefined, async (): Promise<HtmlClipInit> => {
    const binds = resolveClipBindings(project, m);
    const got = await Promise.all(binds.map((b) => blobs.get(b.blobKey).catch(() => undefined)));
    const bindings: NonNullable<HtmlClipInit["bindings"]> = {};
    binds.forEach((b, i) => { const bl = got[i]; if (bl) bindings[b.name] = { type: b.type, blob: bl }; });
    return { width: w, height: h, ...(dur ? { duration: dur } : {}), bindings, params: resolveHtmlParams(m.params, params) };
  });
  try {
    host.request(htmlThumbTime(dur), dur);
    const issue = await host.settle(6000);
    if (issue || !host.frame) return undefined;
    const c = document.createElement("canvas");
    c.height = THUMB_H; c.width = Math.max(1, Math.round((THUMB_H * w) / h));
    const g = c.getContext("2d");
    if (!g) return undefined;
    g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(host.frame, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.75);
  } finally { host.dispose(); }
}
