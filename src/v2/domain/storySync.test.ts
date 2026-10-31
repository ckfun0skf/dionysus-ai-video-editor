import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";
import { storyboardToDoc, mergeStoryboard } from "./storyRoundtrip";
import { needsPromptItems, syncPlan } from "./storySync";
import { mainTrack } from "./ops";
import { TICKS_PER_SECOND } from "./time";
import { Engine, cmd } from "../engine";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 6 * S, width: 1920, height: 1080 };
const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, description: "", durationSec: 5, prompt: `P ${id}`, assets: [], qa: [], ...extra });
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };

function sent(): Project {
  const d = parse({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [], shots: [
    shot("a", { layers: [{ id: "t1", type: "text", text: "Hi", startSec: 0, endSec: 2, position: { x: 0.5, y: 0.5 } }] }), shot("b"),
  ] });
  let p: Project = board.setStoryboard(createProject("s"), board.storyboardFromDoc(d));
  p = board.addStoryVersion(p, { shot: "a" }, vid, { versionId: "v1", now: "2026-10-30T00:00:00Z" });
  p = board.addStoryVersion(p, { shot: "b" }, vid, { versionId: "v2", now: "2026-10-30T00:00:00Z" });
  return sendStory(p).project;
}
const comp = (p: Project) => p.compositions[p.rootCompositionId];
const main = (p: Project) => mainTrack(comp(p))!;
const mains = (p: Project) => main(p).placements.filter((x) => x.storyShot);

describe("Sync to Storyboard (P10-SYNC)", () => {
  it("is a no-op right after Send", () => {
    expect(syncPlan(sent()).changes.map((c) => c.label)).toEqual([]);
  });

  it("writes back a trimmed length and the shot order", () => {
    const p = structuredClone(sent());
    const [a, b] = [...mains(p)].sort((x, y) => x.startTicks - y.startTicks);
    a.durationTicks = 3 * S;
    const st = a.startTicks; a.startTicks = b.startTicks + 3 * S; b.startTicks = st; // swap order
    const r = syncPlan(p);
    const sb = r.project.storyboard!;
    expect(sb.shots[a.storyShot!].durationSec).toBe(3);
    expect(sb.order.indexOf("b")).toBeLessThan(sb.order.indexOf("a"));
    expect(r.changes.some((c) => c.kind === "order")).toBe(true);
  });

  it("turns a main clip with no shot into a needsPrompt shot, and a removed clip flags its shot", () => {
    const p = structuredClone(sent());
    const m = main(p), last = [...m.placements].sort((x, y) => x.startTicks - y.startTicks).at(-1)!;
    const extra = { ...structuredClone(last), id: "pl-new", startTicks: last.startTicks + last.durationTicks, durationTicks: 4 * S };
    delete extra.storyShot; delete extra.link;
    m.placements.push(extra);
    const bId = mains(p).find((x) => x.storyShot === "b")!.id;
    m.placements = m.placements.filter((x) => x.id !== bId);
    const r = syncPlan(p), sb = r.project.storyboard!;
    const nid = sb.order.find((id) => id.startsWith("shot-tl-"))!;
    expect(sb.shots[nid].needsPrompt).toBe(true);
    expect(sb.shots[nid].durationSec).toBe(4);
    expect(sb.shots.b).toBeDefined();
    expect(sb.shots.b.removedFromTimeline).toBe(true);
    expect(r.changes.find((c) => c.kind === "newShot")?.needsPrompt).toBe(true);
    expect(needsPromptItems(sb).length).toBeGreaterThan(0);

    // Export carries the flags; re-import with a prompt clears needsPrompt.
    const json = JSON.parse(storyDocJson(storyboardToDoc(sb)));
    const js = json.shots.find((s: { id: string }) => s.id === nid);
    expect(js.needsPrompt).toBe(true);
    expect(json.shots.find((s: { id: string }) => s.id === "b").removedFromTimeline).toBe(true);
    js.prompt = "A harbour at dusk"; js.description = "Harbour";
    const merged = mergeStoryboard(r.project, parse(json));
    expect(merged.shots[nid].needsPrompt).toBeUndefined();
    expect(merged.shots[nid].prompt).toBe("A harbour at dusk");
  });

  it("turns a linked non-main text clip into a needsPrompt layer of its parent's shot", () => {
    const p = structuredClone(sent());
    const a = mains(p).find((x) => x.storyShot === "a")!;
    const txt = comp(p).tracks.flatMap((t) => t.placements).find((x) => x.clipType === "text")!;
    const track = comp(p).tracks.find((t) => t.placements.includes(txt))!;
    track.placements.push({ ...structuredClone(txt), id: "pl-t2", storyLink: undefined, storyLayer: undefined, text: { ...txt.text!, text: "New title" }, link: { parent: a.id } });
    const sb = syncPlan(p).project.storyboard!;
    const l = sb.shots.a.layers!.find((x) => x.id.startsWith("tl-layer-"))!;
    expect(l.needsPrompt).toBe(true);
    expect(l.type === "text" && l.text).toBe("New title");
    expect(sb.shots.a.layers!.find((x) => x.id === "t1")).toBeDefined();
  });

  it("is one undo step through the engine", () => {
    const p = structuredClone(sent());
    mains(p)[0].durationTicks = 2 * S;
    const e = new Engine(p);
    const before = structuredClone(e.getState().project.storyboard);
    expect(e.dispatch(cmd.syncToStoryboard())).toBe(true);
    expect(e.getState().project.storyboard).not.toEqual(before);
    e.undo();
    expect(e.getState().project.storyboard).toEqual(before);
  });
});
