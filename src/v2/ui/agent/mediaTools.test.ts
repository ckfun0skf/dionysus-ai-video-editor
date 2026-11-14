// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentMedia, createProject, story, TICKS_PER_SECOND, type MediaKind, type Project } from "../../domain";
import { HTML_CLIP_FORMAT } from "../../domain/htmlClipPackage";
import { cmd, Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { runAttachTool, runImportStoryboard, type MediaIO } from "./mediaTools";
import { agentStore, callAgentTool } from "./webMcp";
import { runTimelineTool } from "./timelineTools";

// P62 (#312): attach media from URLs, import storyboard JSON, re-lay the timeline.
const S = TICKS_PER_SECOND;
const json = (t: string) => JSON.parse(t);
const DOC = {
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "vo", name: "VO", type: "audio", prompt: "Voice: hi" },
    { id: "bed", name: "Bed", type: "audio", prompt: "Music" },
    { id: "card", name: "Card", type: "html", prompt: "Title card" },
  ],
  shots: [
    { id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [] },
    { id: "b", title: "b", description: "", durationSec: 4, render: "html", clip: "card", assets: [], qa: [] },
  ],
  audio: [{ id: "vo1", asset: "vo", kind: "voiceover", from: "a", atSec: 1 }],
};
const CLIP = `<!doctype html><html><head><script type="application/json" id="dionysus-clip">${JSON.stringify({ format: HTML_CLIP_FORMAT, name: "c", durationSec: 2, width: 1920, height: 1080 })}</script></head><body><canvas></canvas><script>dionysus.clip({ render(t, ctx) {} });</script></body></html>`;

function memBlobs(): BlobStore & { map: Map<string, Blob> } {
  const map = new Map<string, Blob>();
  return { map, put: async (k, b) => { map.set(k, b); }, get: async (k) => map.get(k), delete: async (k) => { map.delete(k); }, keys: async () => [...map.keys()] } as BlobStore & { map: Map<string, Blob> };
}
/** Fake page fetch: path → [type, body]; anything else is a 404. Records the URLs asked for. */
function io(files: Record<string, [string, string]>, durationSec = 2): MediaIO & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls, origin: "https://app.example",
    fetch: async (u: string) => { urls.push(u); const f = files[new URL(u).pathname]; return { ok: !!f, status: f ? 200 : 404, blob: async () => new Blob([f?.[1] ?? ""], { type: f?.[0] ?? "" }) } as unknown as Response; },
    probe: async (kind: MediaKind) => (kind === "html" ? { width: 1920, height: 1080 } : kind === "image" ? { width: 64, height: 64 } : { durationTicks: durationSec * S }),
  };
}
const setup = () => { const e = new Engine(createProject("m")); const r = story.parseStoryboard(JSON.stringify(DOC)); if (!r.ok) throw new Error("doc"); e.dispatch(cmd.createStoryboard(r.doc)); return e; };
const sel = (p: Project, slot: string) => { const b = p.storyboard!, a = p.assets[b.slots[slot].assetId!]; return a ? { selected: a.selectedVersionId, versions: a.versions.length } : undefined; };

beforeEach(() => {
  // jsdom's Blob has no text(); browsers do.
  if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsText(this); }); };
  if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined });
  localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true);
});
afterEach(() => agentStore.reset());

describe("agentMedia (P62)", () => {
  it("allows https, local http and the page's own origin only", () => {
    const ok = (u: string, o = {}) => agentMedia.checkAgentUrl(u, o).ok;
    expect(ok("https://cdn.example/a.mp3")).toBe(true);
    expect(ok("http://127.0.0.1:8000/a.mp3")).toBe(true);
    expect(ok("http://localhost/a.mp3")).toBe(true);
    expect(ok("http://[::1]:9/a.mp3")).toBe(true);
    expect(ok("http://example.com/a.mp3")).toBe(false);
    expect(ok("http://example.com/a.mp3", { origin: "http://example.com" })).toBe(true);
    expect(ok("file:///tmp/a.mp3")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("data:audio/mpeg;base64,AA==")).toBe(false);
    expect(ok("data:audio/mpeg;base64,AA==", { allowData: true })).toBe(true);
    expect(agentMedia.checkAgentUrl("vo/a b.mp3", { base: "http://127.0.0.1:8000/audio/" })).toEqual({ ok: true, url: "http://127.0.0.1:8000/audio/vo/a%20b.mp3" });
    expect(ok("not a url")).toBe(false);
  });

  it("finds the target and its kind, and expands patterns", () => {
    const p = setup().getState().project;
    expect(agentMedia.attachTarget(p, { assetId: "vo" })).toMatchObject({ ok: true, value: { kind: "audio", slotId: "vo" } });
    expect(agentMedia.attachTarget(p, { assetId: "card" })).toMatchObject({ ok: true, value: { kind: "html", htmlSlot: "card" } });
    expect(agentMedia.attachTarget(p, { shotId: "a" })).toMatchObject({ ok: true, value: { kind: "video", shotId: "a" } });
    expect(agentMedia.attachTarget(p, { shotId: "b" })).toMatchObject({ ok: true, value: { kind: "html", slotId: "card" } });
    expect(agentMedia.attachTarget(p, { assetId: "nope" }).ok).toBe(false);
    expect(agentMedia.attachTarget(p, { assetId: "vo", shotId: "a" }).ok).toBe(false);
    expect(agentMedia.attachTarget(createProject("x"), { assetId: "vo" }).ok).toBe(false);
    const ex = agentMedia.expandAttachPattern(p, "audio/en/{assetId}.mp3", { type: "audio" });
    expect(ex.ok && ex.items).toEqual([{ assetId: "vo", path: "audio/en/vo.mp3" }, { assetId: "bed", path: "audio/en/bed.mp3" }]);
    const shots = agentMedia.expandAttachPattern(p, "clips/{shotId}.mp4", { ids: ["a"] });
    expect(shots.ok && shots.items).toEqual([{ shotId: "a", path: "clips/a.mp4" }]);
    expect(agentMedia.expandAttachPattern(p, "x.mp3").ok).toBe(false);
    expect(agentMedia.expandAttachPattern(p, "{assetId}/{shotId}").ok).toBe(false);
    expect(agentMedia.fileNameFor("http://h/a/vo-en.mp3", "audio", "VO")).toBe("vo-en.mp3");
    expect(agentMedia.fileNameFor(undefined, "html", "Shot 1 · Card")).toBe("Shot_1_Card.html");
  });
});

describe("attach_asset_version (P62)", () => {
  it("fetches, probes and stores an audio file as the asset's current version, in one undo step", async () => {
    const e = setup(), blobs = memBlobs(), f = io({ "/vo.mp3": ["audio/mpeg", "ID3"] }, 2.5);
    const r = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "vo", url: "http://127.0.0.1:8000/vo.mp3", name: "en take" }, f);
    expect(r).toMatchObject({ ok: true, changed: true });
    const o = json(r.text);
    expect(o).toMatchObject({ assetId: "vo", ok: true, kind: "audio", durationSec: 2.5, versions: 1, current: true, bytes: 3 });
    const p = e.getState().project, a = p.assets[o.mediaAssetId];
    expect(a.selectedVersionId).toBe(o.versionId);
    expect(a.versions[0]).toMatchObject({ id: o.versionId, media: { mime: "audio/mpeg", durationTicks: 2.5 * S } });
    expect(blobs.map.size).toBe(1);
    e.undo();
    expect(sel(e.getState().project, "vo")).toBeUndefined();
  });

  it("rejects bad URLs, missing files, wrong kinds and bad sources without changing anything", async () => {
    const e = setup(), blobs = memBlobs(), f = io({ "/v.mp4": ["video/mp4", "x"], "/x.bin": ["application/octet-stream", "x"] });
    const err = async (a: Record<string, unknown>) => { const r = await runAttachTool(e, blobs, "attach_asset_version", a, f); expect(r.ok).toBe(false); return r.text; };
    expect(await err({ assetId: "vo", url: "http://example.com/vo.mp3" })).toMatch(/not allowed/);
    expect(await err({ assetId: "vo", url: "http://127.0.0.1/missing.mp3" })).toMatch(/HTTP 404/);
    expect(await err({ assetId: "vo", url: "http://127.0.0.1/v.mp4" })).toMatch(/needs audio/);
    expect(await err({ assetId: "vo", url: "http://127.0.0.1/x.bin" })).toMatch(/unsupported/);
    expect(await err({ assetId: "vo", text: "<p>" })).toMatch(/for HTML clips/);
    expect(await err({ assetId: "vo", url: "https://a/b.mp3", dataUrl: "data:," })).toMatch(/exactly one/);
    expect(await err({ assetId: "vo", path: "vo.mp3" })).toMatch(/baseUrl/);
    expect(await err({ assetId: "zz", url: "https://a/b.mp3" })).toMatch(/No storyboard asset/);
    const failing: MediaIO = { ...f, probe: async () => { throw new Error("Unsupported or corrupt media"); } };
    const r = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "vo", url: "http://127.0.0.1/v.mp4" }, { ...failing, fetch: io({ "/v.mp3": ["audio/mpeg", "x"] }).fetch, origin: f.origin });
    expect(r.ok).toBe(false);
    expect(blobs.map.size).toBe(0); // nothing stored
    expect(e.undo()).toBe(true); // the only step is the storyboard creation
    expect(e.getState().project.storyboard).toBeUndefined();
  });

  it("lints HTML clips like a manual upload (inline text or a URL) and adds them to an html shot", async () => {
    const e = setup(), blobs = memBlobs(), f = io({ "/card.html": ["text/html", CLIP] });
    const bad = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "card", text: CLIP.replace("render(t, ctx) {}", "render(t, ctx) { fetch('https://evil.example/x.png'); }") }, f);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/HTML clip rejected: Network access is blocked/);
    const ok = await runAttachTool(e, blobs, "attach_asset_version", { shotId: "b", url: "https://cdn.example/card.html" }, f);
    expect(json(ok.text)).toMatchObject({ shotId: "b", ok: true, kind: "html" });
    const inline = await runAttachTool(e, blobs, "attach_asset_version", { assetId: "card", text: CLIP, makeCurrent: false }, f);
    const o = json(inline.text);
    expect(o).toMatchObject({ ok: true, versions: 2, current: false });
    expect(sel(e.getState().project, "card")!.selected).toBe(json(ok.text).versionId);
  });
});

describe("attach_asset_versions (P62)", () => {
  it("attaches by pattern with one result per item, one undo step, and keeps going after a failure", async () => {
    const e = setup(), blobs = memBlobs(), f = io({ "/audio/en/vo.mp3": ["audio/mpeg", "ID3"] });
    const r = await runTimelineTool(e, undefined, "attach_asset_versions", { baseUrl: "http://127.0.0.1:8000/audio/en/", pattern: "{assetId}.mp3", type: "audio" }, undefined, blobs, f);
    const o = json(r.text);
    expect(o).toMatchObject({ added: 1, failed: 1 });
    expect(o.results.map((x: { assetId: string; ok: boolean }) => [x.assetId, x.ok])).toEqual([["vo", true], ["bed", false]]);
    expect(o.results[1].error).toMatch(/404/);
    expect(f.urls).toEqual(["http://127.0.0.1:8000/audio/en/vo.mp3", "http://127.0.0.1:8000/audio/en/bed.mp3"]);
    expect(sel(e.getState().project, "vo")!.versions).toBe(1);
    e.undo();
    expect(sel(e.getState().project, "vo")).toBeUndefined();
  });

  it("takes an items list with per-item options and limits its size", async () => {
    const e = setup(), blobs = memBlobs(), f = io({ "/vo1.mp3": ["audio/mpeg", "a"], "/vo2.mp3": ["audio/mpeg", "b"], "/bed.mp3": ["audio/mpeg", "c"] });
    const r = await runAttachTool(e, blobs, "attach_asset_versions", { baseUrl: "https://files.example/", items: [{ assetId: "vo", path: "vo1.mp3" }, { assetId: "vo", path: "vo2.mp3", makeCurrent: false }, { assetId: "bed", url: "https://files.example/bed.mp3" }] }, f);
    const o = json(r.text);
    expect(o).toMatchObject({ added: 3, failed: 0 });
    expect(sel(e.getState().project, "vo")).toEqual({ selected: o.results[0].versionId, versions: 2 });
    expect(e.getState().project.assets[o.results[0].mediaAssetId].versions.map((v) => v.id)).toContain(o.results[1].versionId);
    const many = Array.from({ length: agentMedia.MAX_ATTACH_ITEMS + 1 }, () => ({ assetId: "vo", url: "https://a/b.mp3" }));
    expect((await runAttachTool(e, blobs, "attach_asset_versions", { items: many }, f)).text).toMatch(/At most/);
    expect((await runAttachTool(e, blobs, "attach_asset_versions", { items: [] }, f)).ok).toBe(false);
    expect((await runAttachTool(e, blobs, "attach_asset_versions", {}, f)).ok).toBe(false);
    expect((await runAttachTool(new Engine(createProject("x")), blobs, "attach_asset_versions", { items: [] }, f)).text).toMatch(/No storyboard/);
  });
});

describe("import_storyboard (P62)", () => {
  it("creates a board, refuses to overwrite without replace, and replaces by id keeping uploads", async () => {
    const e = new Engine(createProject("i"));
    const c = await runImportStoryboard(e, { json: DOC });
    expect(json(c.text)).toMatchObject({ mode: "created", shots: 2, assets: 3 });
    const blobs = memBlobs();
    await runAttachTool(e, blobs, "attach_asset_version", { assetId: "vo", url: "https://f.example/vo.mp3" }, io({ "/vo.mp3": ["audio/mpeg", "x"] }));
    const next = { ...DOC, meta: { title: "T2", aspect: "16:9" }, shots: [...DOC.shots, { id: "c", title: "c", description: "", durationSec: 3, prompt: "Q", assets: [], qa: [] }] };
    const refused = await runImportStoryboard(e, { json: JSON.stringify(next) });
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/replace/);
    const r = await runImportStoryboard(e, { json: next, replace: true });
    expect(json(r.text)).toMatchObject({ mode: "replaced", keepUploads: true, shots: 3, added: { shots: 1 } });
    let p = e.getState().project;
    expect(p.storyboard!.order).toEqual(["a", "b", "c"]);
    expect(sel(p, "vo")!.versions).toBe(1); // upload kept
    e.undo();
    expect(e.getState().project.storyboard!.order).toEqual(["a", "b"]);
    const fresh = await runImportStoryboard(e, { json: next, replace: true, keepUploads: false });
    expect(json(fresh.text)).toMatchObject({ mode: "replaced", keepUploads: false });
    p = e.getState().project;
    expect(sel(p, "vo")).toBeUndefined();
  });

  it("merges a part, fetches from a URL and reports invalid JSON without changes", async () => {
    const e = setup();
    const part = await runImportStoryboard(e, { json: { shots: [{ id: "c", title: "c", description: "", durationSec: 3, prompt: "Q", assets: [], qa: [] }] } });
    expect(json(part.text)).toMatchObject({ mode: "part" });
    expect(e.getState().project.storyboard!.order).toContain("c");
    const bad = await runImportStoryboard(e, { json: { format: "dionysus.storyboard/1", meta: { title: "x" }, shots: "nope" }, replace: true });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/rejected, nothing changed/);
    const f = io({ "/board.json": ["application/json", JSON.stringify(DOC)] });
    const viaUrl = await runImportStoryboard(e, { url: "http://localhost:8000/board.json", replace: true }, f);
    expect(json(viaUrl.text)).toMatchObject({ mode: "replaced", shots: 2 });
    expect(e.getState().project.storyboard!.order).toEqual(["a", "b"]);
    expect((await runImportStoryboard(e, { url: "http://example.com/b.json" }, f)).text).toMatch(/not allowed/);
    expect((await runImportStoryboard(e, {})).ok).toBe(false);
  });
});

describe("send_to_timeline modes (P62)", () => {
  it("relayout re-times placed shots from the board in one undo step", async () => {
    const e = setup(), blobs = memBlobs();
    await runAttachTool(e, blobs, "attach_asset_versions", { items: [{ shotId: "a", url: "https://f.example/a.mp4" }, { shotId: "b", text: CLIP }] }, io({ "/a.mp4": ["video/mp4", "v"] }, 5));
    expect(callAgentTool(e, "send_to_timeline", {}).isError).toBeFalsy();
    const lengths = () => { const p = e.getState().project; return p.compositions[p.rootCompositionId].tracks.find((t) => t.kind === "video")!.placements.map((x) => x.durationTicks / S).sort(); };
    expect(lengths()).toEqual([4, 5]);
    callAgentTool(e, "update_shot", { id: "b", patch: { durationSec: 2 } });
    callAgentTool(e, "send_to_timeline", {});
    expect(lengths()).toEqual([4, 5]); // Update keeps lengths
    const r = callAgentTool(e, "send_to_timeline", { mode: "relayout" });
    expect(json(r.content[0].text)).toMatchObject({ mode: "relayout", shots: 2, resized: 1 });
    expect(lengths()).toEqual([2, 5]);
    e.undo();
    expect(lengths()).toEqual([4, 5]);
    expect(callAgentTool(e, "send_to_timeline", { mode: "nope" }).isError).toBe(true);
  });
  it("P63 (#314): a shot added by import_storyboard goes in at its story position with its clip's version", async () => {
    const e = setup(), blobs = memBlobs();
    await runAttachTool(e, blobs, "attach_asset_versions", { items: [{ shotId: "a", url: "https://f.example/a.mp4" }, { shotId: "b", text: CLIP }] }, io({ "/a.mp4": ["video/mp4", "v"] }, 5));
    callAgentTool(e, "send_to_timeline", {});
    const next = { ...DOC, shots: [{ id: "h0", title: "h0", description: "", durationSec: 2.25, render: "html", clip: "card", assets: [], qa: [] }, ...DOC.shots] };
    expect(json((await runImportStoryboard(e, { json: next, replace: true })).text)).toMatchObject({ added: { shots: 1 } });
    const r = callAgentTool(e, "send_to_timeline", { mode: "relayout" });
    expect(json(r.content[0].text)).toMatchObject({ mode: "relayout", inserted: ["h0"] });
    expect(json(r.content[0].text).placeholderShots).toBeUndefined();
    const p = e.getState().project, clips = p.compositions[p.rootCompositionId].tracks.find((t) => t.kind === "video")!.placements.slice().sort((x, y) => x.startTicks - y.startTicks);
    expect(clips.map((x) => [x.storyShot, x.startTicks / S])).toEqual([["h0", 0], ["a", 2.25], ["b", 7.25]]);
    expect(clips[0]).toMatchObject({ clipType: "html", source: { assetId: p.storyboard!.slots.card.assetId } });
    // Update mode names what it did, too.
    callAgentTool(e, "add_shot", { shot: { id: "z", title: "z", description: "", durationSec: 1, render: "html", clip: "card", assets: [], qa: [] }, after: "h0" });
    const u = callAgentTool(e, "send_to_timeline", {});
    expect(u.content[0].text).toMatch(/Inserted in story order: z\./);
  });

});
