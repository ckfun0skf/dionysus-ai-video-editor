import { describe, expect, it } from "vitest";
import { isStoryPart, mergeStoryPart, parseStoryPart, runStoryTool, STORY_TOOLS, storyToolsMarkdown } from "./storyAgent";
import { AUDIO_KINDS, SHOT_RENDERS, STORY_ASSET_TYPES, type StoryDoc } from "./storyJson";
import { EXAMPLE_STORYBOARD } from "./storyPrompt";

const ctx = { guide: () => "GUIDE" };
const base: StoryDoc = EXAMPLE_STORYBOARD;
const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Shot ${id}`, durationSec: 4, prompt: "A slow push in", qa: ["a", "b"], ...extra });
const run = (name: string, args: unknown, doc: StoryDoc | null = base) => runStoryTool(name, args, doc ?? undefined, ctx);
const ids = (d?: StoryDoc) => d!.shots.map((s) => s.id);

describe("WebMCP storyboard tools (P4C)", () => {
  it("covers the requested tools, with schemas from the parser constants", () => {
    const names = STORY_TOOLS.map((t) => t.name);
    for (const n of ["get_guide", "get_storyboard", "add_asset", "update_asset", "remove_asset", "add_shot", "update_shot", "remove_shot", "add_cue", "update_cue", "remove_cue", "add_asset_state", "update_asset_state", "set_shot_layers", "set_shot_background", "set_shot_params", "reorder_shots", "validate", "export_json", "send_to_timeline"]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    const json = JSON.stringify(STORY_TOOLS.map((t) => t.inputSchema));
    for (const v of [...STORY_ASSET_TYPES, ...SHOT_RENDERS, ...AUDIO_KINDS]) expect(json).toContain(`"${v}"`);
    for (const t of STORY_TOOLS) expect(storyToolsMarkdown()).toContain(`\`${t.name}\``);
  });

  it("reads the guide, a summary and one item", () => {
    expect(run("get_guide", {}).text).toBe("GUIDE");
    const sum = run("get_storyboard", {});
    expect(sum.ok).toBe(true);
    for (const s of base.shots) expect(sum.text).toContain(s.id);
    const one = run("get_storyboard", { id: base.shots[0].id });
    expect(JSON.parse(one.text).id).toBe(base.shots[0].id);
    expect(run("get_storyboard", { id: "nope" }).ok).toBe(false);
    expect(run("get_storyboard", {}, null).text).toContain("create_storyboard");
  });

  it("adds, updates, moves and removes shots, each validated", () => {
    const first = base.shots[0].id;
    const a = run("add_shot", { shot: shot("x1"), after: first });
    expect(a.ok).toBe(true);
    expect(ids(a.doc)[1]).toBe("x1");
    expect(a.label).toBe("AI: add shot x1");
    expect(ids(run("add_shot", { shot: shot("x2"), after: null }).doc)[0]).toBe("x2");
    expect(ids(run("add_shot", { shot: shot("x3") }).doc).at(-1)).toBe("x3");
    expect(run("add_shot", { shot: shot(first) }).text).toContain("already exists");
    const bad = run("add_shot", { shot: shot("x4", { assets: ["ghost"] }) });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^Rejected, nothing changed/);
    expect(bad.text).toContain("(x4)");
    expect(run("add_shot", { shot: { id: "x5", title: "t", durationSec: 3, qa: ["a", "b"] } }).ok).toBe(false); // ai shot needs a prompt
    const u = run("update_shot", { id: first, patch: { title: "New title" } }, a.doc);
    expect(u.doc!.shots[0].title).toBe("New title");
    expect(run("update_shot", { id: first, patch: { id: "zz" } }).ok).toBe(false);
    const m = run("reorder_shots", { id: "x1", index: 0 }, a.doc);
    expect(ids(m.doc)[0]).toBe("x1");
    const order = [...ids(a.doc)].reverse();
    const rev = run("reorder_shots", { order }, a.doc); // a cue would end before it starts
    expect(rev.ok).toBe(false);
    expect(rev.text).toContain("audio[0] (wind)");
    const swap = [...ids(a.doc)]; [swap[0], swap[1]] = [swap[1], swap[0]];
    expect(ids(run("reorder_shots", { order: swap }, a.doc).doc)).toEqual(swap);
    expect(run("reorder_shots", { order: order.slice(1) }, a.doc).ok).toBe(false);
    const r = run("remove_shot", { id: "x1" }, a.doc);
    expect(ids(r.doc)).toEqual(ids(base));
  });

  it("edits assets and states, and refuses to remove an asset in use", () => {
    const add = run("add_asset", { asset: { id: "lamp", name: "Lamp", type: "prop", prompt: "a brass lamp", source: "generate", qa: ["a", "b"] } });
    expect(add.ok).toBe(true);
    const st = run("add_asset_state", { asset: "lamp", state: { id: "on", name: "Lamp on", prompt: "the lamp glowing" } }, add.doc);
    expect(st.ok).toBe(true);
    expect(run("update_asset_state", { asset: "lamp", id: "on", patch: { name: "Lit" } }, st.doc).ok).toBe(true);
    expect(run("update_asset", { id: "lamp", patch: { name: "Brass lamp" } }, add.doc).doc!.assets.find((a) => a.id === "lamp")!.name).toBe("Brass lamp");
    const used = base.shots.flatMap((s) => s.assets ?? [])[0];
    if (used) expect(run("remove_asset", { id: used }).ok).toBe(false);
    expect(run("remove_asset", { id: "lamp" }, add.doc).ok).toBe(true);
  });

  it("adds, updates and removes cues with an automatic id", () => {
    const audio = base.assets.find((a) => a.type === "audio");
    if (!audio) return;
    const n = base.audio?.length ?? 0;
    const c = run("add_cue", { cue: { kind: "music", asset: audio.id, from: base.shots[0].id } });
    expect(c.ok).toBe(true);
    const id = `audio${n + 1}`;
    expect(c.doc!.audio!.some((x) => x.id === id)).toBe(true);
    expect(run("update_cue", { id, patch: { volume: 0.5 } }, c.doc).ok).toBe(true);
    expect(run("remove_cue", { id }, c.doc).doc!.audio?.length ?? 0).toBe(n);
  });

  it("validate, export_json and send_to_timeline", () => {
    expect(run("validate", {}).ok).toBe(true);
    expect(JSON.parse(run("export_json", {}).text).format).toBe("dionysus.storyboard/1");
    expect(run("send_to_timeline", {}).send).toBe(true);
    expect(run("send_to_timeline", {}, null).ok).toBe(false);
  });

  it("creates a storyboard only when there is none", () => {
    const c = run("create_storyboard", { meta: { title: "New" }, shots: [shot("s1")] }, null);
    expect(c.ok).toBe(true);
    expect(c.doc!.meta.title).toBe("New");
    expect(run("create_storyboard", { meta: { title: "New" }, shots: [shot("s1")] }).ok).toBe(false);
    expect(run("add_shot", { shot: shot("s1") }, null).ok).toBe(false);
  });
});

describe("storyboard parts (P4C)", () => {
  it("recognises parts", () => {
    expect(isStoryPart({ part: { index: 2 } })).toBe(true);
    expect(isStoryPart({ shots: [] })).toBe(true);
    expect(isStoryPart({ meta: { title: "x" }, shots: [] })).toBe(false);
  });

  it("merges shots after part.after in order, replaces by id and removes", () => {
    const first = base.shots[0].id;
    const r = mergeStoryPart(base, { part: { index: 2, after: first }, shots: [shot("p1"), shot("p2"), { ...base.shots[0], title: "Changed" }] });
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return;
    expect(ids(r.result.doc).slice(0, 3)).toEqual([first, "p1", "p2"]);
    expect(r.result.doc.shots[0].title).toBe("Changed");
    expect(r.counts!.shots).toBe(3);
    const rm = mergeStoryPart(r.result.doc, { part: { remove: ["p1"] } });
    expect(rm.result.ok && ids(rm.result.doc)).not.toContain("p1");
    expect(rm.counts!.removed).toBe(1);
  });

  it("rejects a part that breaks the merged board, with merged paths", () => {
    const r = mergeStoryPart(base, { shots: [shot("p9", { assets: ["ghost"] })] });
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.errors[0].path).toMatch(/^merged shots\[\d+\] \(p9\)/);
    expect(mergeStoryPart(base, { part: { after: "nope" }, shots: [shot("p1")] }).result.ok).toBe(false);
    expect(mergeStoryPart(base, { part: { remove: ["nope"] } }).result.ok).toBe(false);
  });

  it("parses pasted text only when there is a board", () => {
    const text = "```json\n" + JSON.stringify({ part: { index: 2 }, shots: [shot("p1")] }) + "\n```";
    expect(parseStoryPart(text, undefined)).toBeUndefined();
    expect(parseStoryPart(text, base)?.result.ok).toBe(true);
    expect(parseStoryPart(JSON.stringify({ meta: { title: "x" }, shots: [] }), base)).toBeUndefined();
  });
});

describe("WebMCP tools on schema 3.1 (P16)", () => {
  it("get_storyboard returns 3.1; shots share a clip and the clip prompt is edited on the asset", () => {
    const raw = JSON.parse(run("export_json", {}).text.replace(/^[^{]*/, ""));
    expect(raw.schemaVersion).toBe("3.1");
    for (const s of raw.shots) if (!s.render || s.render === "ai") expect(s.prompt).toBeUndefined();
    // A clip without a keyframe (sharing a keyframed clip is not supported yet).
    const plain = (id: string) => !raw.assets.find((x: { id: string; keyframe?: unknown }) => x.id === id)?.keyframe;
    const first = raw.shots.find((s: { clip?: string; render?: string }) => !s.render && s.clip && plain(s.clip));
    const a = run("add_shot", { shot: { id: "re1", title: "Again", durationSec: 2, clip: first.clip, inSec: 1 } });
    expect(a.ok, a.text).toBe(true);
    const b = run("update_asset", { id: first.clip, patch: { prompt: "A new clip prompt" } }, a.doc!);
    expect(b.ok, b.text).toBe(true);
    const out = JSON.parse(run("export_json", {}, b.doc!).text.replace(/^[^{]*/, ""));
    expect(out.assets.find((x: { id: string }) => x.id === first.clip).prompt).toBe("A new clip prompt");
    expect(out.shots.find((s: { id: string }) => s.id === "re1")).toMatchObject({ clip: first.clip, inSec: 1 });
  });
  it("remove_shot drops the shot's own auto clip", () => {
    const a = run("add_shot", { shot: shot("gone1") });
    const raw = JSON.parse(run("export_json", {}, a.doc!).text.replace(/^[^{]*/, ""));
    expect(raw.assets.some((x: { id: string }) => x.id === "gone1-clip")).toBe(true);
    const r = run("remove_shot", { id: "gone1" }, a.doc!);
    const after = JSON.parse(run("export_json", {}, r.doc!).text.replace(/^[^{]*/, ""));
    expect(after.assets.some((x: { id: string }) => x.id === "gone1-clip")).toBe(false);
  });
});
