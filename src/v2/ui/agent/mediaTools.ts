/**
 * P62 (#312): WebMCP tools that bring media and storyboards into the project without driving the UI.
 * - attach_asset_version / attach_asset_versions: fetch a file from a URL (or take inline HTML text / a data: URL),
 *   validate it like the manual upload (HTML clip lint with the asset's bindings and params; media must decode), store
 *   it and add it as a version of a storyboard asset or shot. A batch is one undo step.
 * - import_storyboard: load storyboard JSON (inline or from a URL) into the project: create, replace by id (uploads
 *   kept) or start over, or merge a storyboard part.
 * Bytes never pass through the tool call: the page fetches the URL itself (CORS and Private Network Access apply).
 */
import { agentMedia, board, lintHtmlClip, newId, roundtrip, slotBindings, story, storyAgent, TICKS_PER_SECOND, type MediaKind, type MediaRef, type Project } from "../../domain";
import { cmd, type Command, type Engine } from "../../engine";
import { importFile, probeMedia } from "../../persistence";
import type { BlobStore } from "../../ports";
import { CLIP_LIBRARIES } from "../../render";
import { importHtmlPackage } from "../htmlPackage";
import { seriesStore } from "../series/seriesStore";

/** Injectable I/O (tests): the page's fetch, the media probe and the page origin. */
export interface MediaIO { fetch?: (url: string) => Promise<Response>; probe?: typeof probeMedia; origin?: string }
interface Result { ok: boolean; text: string; changed: boolean }
const fail = (text: string): Result => ({ ok: false, text, changed: false });
const r2 = (x: number) => Math.round(x * 100) / 100;

const pageOrigin = (io: MediaIO) => io.origin ?? (typeof location !== "undefined" ? location.origin : undefined);
const fetchOf = (io: MediaIO) => io.fetch ?? ((u: string) => fetch(u, { credentials: "omit" }));

/** Fetch an allowed URL as a File (a generic content type is dropped so the extension decides the kind). */
async function fetchFile(url: string, io: MediaIO, kind: MediaKind, label: string, opts: { base?: string; data?: boolean } = {}): Promise<File | string> {
  const ok = agentMedia.checkAgentUrl(url, { base: opts.base, origin: pageOrigin(io), allowData: opts.data });
  if (!ok.ok) return ok.error;
  let res: Response;
  try { res = await fetchOf(io)(ok.url); } catch (e) { return `Couldn't fetch ${ok.url.slice(0, 120)}: ${(e as Error).message || "network error"} (a local server must send Access-Control-Allow-Origin for this site and Access-Control-Allow-Private-Network: true).`; }
  if (!res.ok) return `Couldn't fetch ${ok.url.slice(0, 120)}: HTTP ${res.status}.`;
  const blob = await res.blob();
  const type = !blob.type || /^(application\/octet-stream|binary\/octet-stream|text\/plain)/i.test(blob.type) ? "" : blob.type.split(";")[0];
  return new File([blob], agentMedia.fileNameFor(opts.data ? undefined : ok.url, kind, label), { type });
}

interface Prepared {
  index: number; item: agentMedia.AttachItem; target: agentMedia.AttachTarget;
  media?: MediaRef; bytes?: number; warnings: string[]; error?: string; versionId: string;
}

/** Load, validate and store one item. Nothing is added to the project here. */
async function prepare(p: Project, blobs: BlobStore, item: agentMedia.AttachItem, index: number, io: MediaIO, base?: string): Promise<Prepared> {
  const t = agentMedia.attachTarget(p, item);
  const out: Prepared = { index, item, target: t.ok ? t.value : (undefined as never), warnings: [], versionId: newId("ver") };
  if (!t.ok) return { ...out, error: t.error };
  const { kind, label } = t.value;
  const sources = [item.url, item.path, item.text, item.dataUrl].filter((x) => typeof x === "string" && x).length;
  if (sources !== 1) return { ...out, error: 'Give exactly one of "url", "path" (with baseUrl), "text" (HTML) or "dataUrl".' };
  let file: File | string;
  if (item.text !== undefined) {
    if (kind !== "html") return { ...out, error: `"text" is for HTML clips; ${label} takes ${kind}. Pass "url" or "dataUrl".` };
    file = new File([item.text], agentMedia.fileNameFor(undefined, "html", label), { type: "text/html" });
  } else if (item.dataUrl) file = await fetchFile(item.dataUrl, io, kind, label, { data: true });
  else if (item.path && !base) return { ...out, error: '"path" needs "baseUrl" (or pass a full "url").' };
  else file = await fetchFile((item.url ?? item.path)!, io, kind, label, { base: item.path ? base : undefined });
  if (typeof file === "string") return { ...out, error: file };
  out.bytes = file.size;
  const probe = io.probe ?? probeMedia;
  if (kind === "html") {
    let html: string;
    try { html = await importHtmlPackage(file); } catch (e) { return { ...out, error: (e as Error).message }; }
    const b = p.storyboard!, slot = t.value.htmlSlot ? b.slots[t.value.htmlSlot] : undefined;
    const expectBindings = slot ? Object.fromEntries(slotBindings(b, slot).map((x) => [x.name, x.type])) : undefined;
    const lint = lintHtmlClip(html, { libs: CLIP_LIBRARIES, expectBindings, expectParams: slot?.params });
    const errors = lint.issues.filter((i) => i.level === "error");
    if (errors.length) return { ...out, error: `HTML clip rejected: ${errors.map((e) => e.message).join(" ")}` };
    out.warnings.push(...lint.issues.filter((i) => i.level === "warning").map((i) => i.message));
    const a = await importFile(new File([html], file.name.replace(/(\.dionysus-html)?\.zip$/i, ".html"), { type: "text/html" }), blobs, probe).catch((e: Error) => e);
    if (!a || a instanceof Error) return { ...out, error: a instanceof Error ? a.message : "Couldn't store the clip." };
    out.media = a.versions[0].media;
    return out;
  }
  const a = await importFile(file, blobs, probe).catch((e: Error) => e);
  if (a instanceof Error) return { ...out, error: `${file.name} can't be read as ${kind}: ${a.message}.` };
  if (!a) return { ...out, error: `${file.name}: unsupported file type${file.type ? ` (${file.type})` : ""}.` };
  if (a.kind !== kind) { await blobs.delete(a.versions[0].media.blobKey).catch(() => undefined); return { ...out, error: `${label} needs ${kind}, but ${file.name} is ${a.kind}.` }; }
  out.media = a.versions[0].media;
  const shot = t.value.shotId ? p.storyboard!.shots[t.value.shotId] : undefined;
  if (shot && kind === "video" && !shot.clipSlot && out.media.durationTicks && out.media.durationTicks / TICKS_PER_SECOND > shot.durationSec + 0.5)
    out.warnings.push(`The clip is ${r2(out.media.durationTicks / TICKS_PER_SECOND)} s; the shot plans ${shot.durationSec} s. It plays whole on the timeline.`);
  return out;
}

/** The project asset that holds a target's versions (after an add). */
const ownerAsset = (p: Project, t: agentMedia.AttachTarget): string | undefined => {
  const b = p.storyboard;
  if (!b) return undefined;
  if (t.slotId) return b.slots[t.slotId]?.assetId;
  return t.shotId ? b.shots[t.shotId]?.assetId : undefined;
};

/** Apply every prepared item in one engine step (one undo). Items that fail to apply are reported, the rest stay. */
function applyAll(engine: Engine, ready: Prepared[], label: string): boolean {
  const step: Command = {
    label,
    apply: (p0) => {
      let p = p0;
      for (const x of ready) {
        if (!x.media) continue;
        try {
          const prevAsset = ownerAsset(p, x.target), prevSel = prevAsset ? p.assets[prevAsset]?.selectedVersionId : undefined;
          let q = cmd.addStoryVersion(x.target.target, x.media, { versionId: x.versionId, ...(x.item.name ? { model: x.item.name } : {}), ...(x.item.mode === "replace" ? { mode: "replace" as const } : {}) }).apply(p);
          const aid = ownerAsset(q, x.target);
          if (x.item.makeCurrent === false && x.item.mode !== "replace" && aid && prevSel) q = board.selectStoryVersion(q, aid, prevSel);
          p = q;
          x.error = undefined;
        } catch (e) { x.error = (e as Error).message; }
      }
      return p;
    },
  };
  return engine.dispatch(step, label);
}

function outcome(engine: Engine, x: Prepared): Record<string, unknown> {
  const base = { ...(x.item.assetId ? { assetId: x.item.assetId } : {}), ...(x.item.shotId ? { shotId: x.item.shotId } : {}) };
  if (x.error || !x.media) return { ...base, ok: false, error: x.error ?? "Not added." };
  const p = engine.getState().project, aid = ownerAsset(p, x.target), asset = aid ? p.assets[aid] : undefined;
  const v = asset?.versions.find((y) => y.id === x.versionId);
  const replaced = x.item.mode === "replace";
  const m = v?.media ?? x.media;
  return {
    ...base, ok: true, kind: x.target.kind, versionId: replaced ? asset?.selectedVersionId : x.versionId, ...(replaced ? { replaced: true } : {}),
    mediaAssetId: aid, versions: asset?.versions.length, current: asset?.selectedVersionId === (replaced ? asset?.selectedVersionId : x.versionId),
    bytes: x.bytes, ...(m.durationTicks ? { durationSec: r2(m.durationTicks / TICKS_PER_SECOND) } : {}), ...(m.width ? { width: m.width, height: m.height } : {}),
    ...(x.warnings.length ? { warnings: x.warnings } : {}),
  };
}

/** Run up to `n` tasks at a time, keeping result order. */
async function pool<T, R>(list: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } }));
  return out;
}

const pickItem = (o: Record<string, unknown>, d: Record<string, unknown> = {}): agentMedia.AttachItem => {
  const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : typeof d[k] === "string" && d[k] ? (d[k] as string) : undefined);
  const mc = typeof o.makeCurrent === "boolean" ? o.makeCurrent : typeof d.makeCurrent === "boolean" ? d.makeCurrent : undefined;
  const mode = s("mode");
  return { assetId: s("assetId"), shotId: s("shotId"), url: s("url"), path: s("path"), text: typeof o.text === "string" ? o.text : undefined, dataUrl: s("dataUrl"), name: s("name"), ...(mc !== undefined ? { makeCurrent: mc } : {}), ...(mode === "replace" || mode === "new" ? { mode } : {}) };
};

/** attach_asset_version / attach_asset_versions. */
export async function runAttachTool(engine: Engine, blobs: BlobStore | undefined, name: string, a: Record<string, unknown>, io: MediaIO = {}): Promise<Result> {
  if (!blobs) return fail("Storing media isn't available here.");
  const p = engine.getState().project;
  if (!p.storyboard) return fail("No storyboard yet. Create or import one first (create_storyboard / import_storyboard).");
  if (a.mode !== undefined && a.mode !== "new" && a.mode !== "replace") return fail('"mode" must be "new" or "replace".');
  const base = typeof a.baseUrl === "string" && a.baseUrl ? a.baseUrl : undefined;
  if (name === "attach_asset_version") {
    const x = await prepare(p, blobs, pickItem(a), 0, io, base);
    if (x.error) return fail(x.error);
    const changed = applyAll(engine, [x], `AI: attach ${x.item.assetId ?? x.item.shotId}`);
    const o = outcome(engine, x);
    if (x.error && x.media) await blobs.delete(x.media.blobKey).catch(() => undefined);
    return { ok: o.ok === true, changed, text: JSON.stringify(o, null, 1) };
  }
  let items: agentMedia.AttachItem[];
  const defaults = { makeCurrent: a.makeCurrent, mode: a.mode, name: a.name };
  if (typeof a.pattern === "string" && a.pattern) {
    if (Array.isArray(a.items)) return fail('Give "items" or "pattern", not both.');
    const ex = agentMedia.expandAttachPattern(p, a.pattern, { type: typeof a.type === "string" ? a.type : undefined, ids: Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === "string") : undefined });
    if (!ex.ok) return fail(ex.error);
    items = ex.items.map((x) => pickItem({ ...x }, defaults));
  } else if (Array.isArray(a.items)) items = a.items.map((x) => pickItem(x && typeof x === "object" ? x as Record<string, unknown> : {}, defaults));
  else return fail('Give "items" (each { assetId | shotId, url | path | text | dataUrl }) or "pattern" (with {assetId} or {shotId}).');
  if (!items.length) return fail("Nothing to attach: the list is empty (or the pattern matched no asset).");
  if (items.length > agentMedia.MAX_ATTACH_ITEMS) return fail(`At most ${agentMedia.MAX_ATTACH_ITEMS} items per call (got ${items.length}). Split the list.`);
  const prepared = await pool(items, 4, (it, i) => prepare(p, blobs, it, i, io, base));
  const ready = prepared.filter((x) => !x.error);
  const changed = ready.length ? applyAll(engine, ready, `AI: attach ${ready.length} version${ready.length === 1 ? "" : "s"}`) : false;
  const results: Record<string, unknown>[] = prepared.map((x) => ({ index: x.index, ...outcome(engine, x) }));
  // Stored files whose add failed are not referenced by anything: remove them.
  for (const x of prepared) if (x.error && x.media) await blobs.delete(x.media.blobKey).catch(() => undefined);
  const added = results.filter((r) => r.ok).length;
  return { ok: added > 0, changed, text: JSON.stringify({ added, failed: results.length - added, results }, null, 1) };
}

/** import_storyboard: create, replace (by id, uploads kept), start over, or merge a part. One undo step. */
export async function runImportStoryboard(engine: Engine, a: Record<string, unknown>, io: MediaIO = {}): Promise<Result> {
  let text: string;
  if (typeof a.json === "string") text = a.json;
  else if (a.json && typeof a.json === "object") text = JSON.stringify(a.json);
  else if (typeof a.url === "string" && a.url) {
    const f = await fetchFile(a.url, io, "html", "storyboard");
    if (typeof f === "string") return fail(f);
    text = await f.text();
  } else return fail('Give "json" (the storyboard JSON, as an object or text) or "url".');
  const p = engine.getState().project;
  const seriesOf = seriesStore.get(p.seriesId);
  const base = p.storyboard ? roundtrip.storyboardToDoc(p.storyboard) : undefined;
  const part = storyAgent.parseStoryPart(text, base, { series: seriesOf });
  const lines = (errs: { path?: string; message: string }[]) => errs.slice(0, 30).map((e) => `- ${e.path ? `${e.path}: ` : ""}${e.message}`).join("\n") + (errs.length > 30 ? `\n- … and ${errs.length - 30} more` : "");
  if (part) {
    if (!part.result.ok) return fail(`Storyboard part rejected, nothing changed:\n${lines(part.result.errors)}`);
    const changed = engine.dispatch(cmd.mergeStoryboardDoc(part.result.doc), "AI: import storyboard part");
    return { ok: true, changed, text: JSON.stringify({ mode: "part", ...part.counts, warnings: part.result.warnings.length }, null, 1) };
  }
  const r = story.parseStoryboard(text, { series: seriesOf });
  if (!r.ok) return fail(`Storyboard rejected, nothing changed:\n${lines(r.errors)}`);
  const summary = { shots: r.doc.shots.length, assets: r.doc.assets.length, warnings: r.warnings.length, ...(r.warnings.length ? { firstWarnings: r.warnings.slice(0, 5).map((w) => `${w.path ? `${w.path}: ` : ""}${w.message}`) } : {}) };
  if (!p.storyboard) {
    const changed = engine.dispatch(cmd.createStoryboard(r.doc), "AI: import storyboard");
    return { ok: true, changed, text: JSON.stringify({ mode: "created", ...summary }, null, 1) };
  }
  if (a.replace !== true) return fail('A storyboard already exists. Pass "replace": true to replace it (uploads are kept for matching asset and shot ids), or send a storyboard part to merge.');
  if (a.keepUploads === false) {
    const changed = engine.dispatch(cmd.createStoryboard(r.doc), "AI: replace storyboard");
    return { ok: true, changed, text: JSON.stringify({ mode: "replaced", keepUploads: false, ...summary }, null, 1) };
  }
  const d = roundtrip.storyDiff(p, r.doc);
  const changed = engine.dispatch(cmd.mergeStoryboardDoc(r.doc), "AI: replace storyboard");
  const n = (g: "added" | "changed" | "removed") => ({ shots: d.shots[g].length, assets: d.assets[g].length });
  return { ok: true, changed, text: JSON.stringify({ mode: "replaced", keepUploads: true, ...summary, added: n("added"), changed: n("changed"), removed: n("removed"), other: d.other }, null, 1) };
}
