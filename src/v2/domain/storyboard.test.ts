import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { EXAMPLE_STORYBOARD } from "./storyPrompt";
import { validateStoryboard } from "./storyJson";

const doc = (() => { const r = validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad example"); return r.doc; })();
const img: MediaRef = { blobKey: "b", mime: "image/png", width: 16, height: 9 };
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 600_000 };
let n = 0;
const up = (p: Project, t: { slot: string } | { shot: string }) => board.addStoryVersion(p, t, "slot" in t ? img : vid, { versionId: `v${++n}`, now: "2026-10-24T00:00:00Z" });
const fresh = () => board.setStoryboard(createProject("s"), board.storyboardFromDoc(doc));
/** Every asset and clip uploaded once, in production order. */
function produced(): Project {
  let p = fresh();
  for (const s of ["keeper", "cliff", "lantern"]) p = up(p, { slot: s });
  p = up(p, { shot: "s1" });
  p = up(p, { slot: "s1-end" });
  p = up(p, { shot: "s2" });
  return up(p, { shot: "s3" });
}
const staleIds = (p: Project) => { const st = board.storyStatus(p); return [...Object.keys(st.slots).filter((k) => st.slots[k].stale), ...Object.keys(st.shots).filter((k) => st.shots[k].stale)].sort(); };

describe("storyboard domain", () => {
  it("builds from an imported doc", () => {
    const b = board.storyboardFromDoc(doc);
    expect(b.order).toEqual(["s1", "s2", "s3"]);
    expect(b.slots["s1-end"].source).toEqual({ type: "lastFrame", shotId: "s1" });
    expect(b.shots.s2.slotIds).toContain("s1-end");
    expect(b.shots.s1.qa[0].id).toBe("s1.qa1");
    expect(b.versions).toEqual({});
  });

  it("uploads create a backing asset, select the version and freeze inputs", () => {
    let p = fresh();
    p = up(p, { slot: "keeper" });
    const keeper = p.storyboard!.slots.keeper;
    expect(p.assets[keeper.assetId!]).toMatchObject({ kind: "image", name: "The keeper", selectedVersionId: `v${n}` });
    p = up(p, { shot: "s1" });
    const s1 = p.storyboard!.shots.s1;
    expect(p.assets[s1.assetId!].kind).toBe("video");
    expect(p.assets[s1.assetId!].name).toMatch(/^1\. /);
    expect(p.storyboard!.versions[board.selectedOf(p, s1)!].inputs).toEqual([{ slotId: "keeper", versionId: board.selectedOf(p, keeper) }]);
    expect(p.assets[s1.assetId!].versions[0].provenance).toMatchObject({ source: "manual-generation", promptText: s1.prompt });
  });

  it("records which clip version a last frame came from", () => {
    const p = produced();
    const end = p.storyboard!.slots["s1-end"];
    const info = p.storyboard!.versions[board.selectedOf(p, end)!];
    expect(info.derivedFrom).toEqual({ shotId: "s1", versionId: board.selectedOf(p, p.storyboard!.shots.s1) });
    expect(p.assets[end.assetId!].versions[0].provenance.source).toBe("derived");
    expect(staleIds(p)).toEqual([]);
  });

  it("a new clip version flags its last frame and everything made from it, transitively", () => {
    let p = produced();
    const s1Asset = p.storyboard!.shots.s1.assetId!;
    const old = board.selectedOf(p, p.storyboard!.shots.s1)!;
    p = up(p, { shot: "s1" });
    expect(staleIds(p)).toEqual(["s1-end", "s2"]);
    const st = board.storyStatus(p);
    expect(st.slots["s1-end"].reasons[0]).toMatch(/older version of shot 1/);
    expect(st.shots.s2.reasons).toContain("“Last frame of shot 1” may not match");
    // Re-extract the frame from the new version: the frame is fine, shot 2 now uses an older frame.
    p = up(p, { slot: "s1-end" });
    expect(staleIds(p)).toEqual(["s2"]);
    expect(board.storyStatus(p).shots.s2.reasons[0]).toMatch(/older version of “Last frame of shot 1”/);
    // Going back to the original clip version: the new frame now mismatches instead.
    p = board.selectStoryVersion(p, s1Asset, old);
    expect(staleIds(p)).toEqual(["s1-end", "s2"]);
  });

  it("changing a reference asset flags every shot using it and what derives from those shots", () => {
    let p = produced();
    p = up(p, { slot: "keeper" });
    expect(staleIds(p)).toEqual(["s1", "s1-end", "s2"]);
    expect(board.storyStatus(p).shots.s1.reasons).toEqual(["made with an older version of “The keeper”"]);
    // Picking the original keeper again clears all warnings.
    const k = p.storyboard!.slots.keeper.assetId!;
    p = board.selectStoryVersion(p, k, p.assets[k].versions[0].id);
    expect(staleIds(p)).toEqual([]);
  });

  it("follows reference chains between assets and survives cycles", () => {
    let p = fresh();
    const b = p.storyboard!;
    p = board.setStoryboard(p, { ...b, slots: { ...b.slots, cliff: { ...b.slots.cliff, references: ["keeper"] }, keeper: { ...b.slots.keeper, references: ["cliff"] } } });
    p = up(p, { slot: "keeper" }); p = up(p, { slot: "cliff" });
    expect(board.storyStatus(p).slots.keeper.reasons).toEqual(["made before “Cliff and lighthouse” was uploaded"]);
    expect(board.storyStatus(p).slots.cliff.reasons).toEqual(["“The keeper” may not match"]);
  });

  it("stores QA results per version and ignores unknown targets", () => {
    let p = produced();
    const v = board.selectedOf(p, p.storyboard!.shots.s1)!;
    p = board.setQaResult(p, v, "s1.qa1", "pass");
    p = board.setQaResult(p, v, "s1.qa2", "fail");
    p = board.setQaResult(p, v, "s1.qa2", undefined);
    expect(p.storyboard!.versions[v].qa).toEqual({ "s1.qa1": "pass" });
    expect(board.setQaResult(p, "nope", "x", "pass")).toBe(p);
    expect(board.addStoryVersion(p, { slot: "nope" }, img)).toBe(p);
    expect(board.selectStoryVersion(p, "nope", "x")).toBe(p);
    expect(board.storyStatus(createProject())).toEqual({ slots: {}, shots: {} });
  });

  it("lists production steps in a workable order with states and QA progress", () => {
    let p = fresh();
    const keys = () => board.productionSteps(p).map((x) => x.key);
    const stateOf = (k: string) => board.productionSteps(p).find((x) => x.key === k)!;
    const k = keys();
    for (const [a, b2] of [["slot:keeper", "shot:s1"], ["shot:s1", "slot:s1-end"], ["slot:s1-end", "shot:s2"], ["shot:s2", "shot:s3"]]) expect(k.indexOf(a)).toBeLessThan(k.indexOf(b2));
    expect(new Set(k).size).toBe(k.length);
    expect(k.length).toBe(Object.keys(p.storyboard!.slots).length + 3);
    expect(stateOf("slot:keeper").state).toBe("todo");
    expect(stateOf("slot:s1-end")).toMatchObject({ state: "blocked", blockedBy: "s1" });
    p = up(p, { slot: "keeper" });
    const ks = stateOf("slot:keeper");
    expect(ks.state).toBe(ks.qaTotal ? "check" : "done");
    const v = board.selectedOf(p, p.storyboard!.slots.keeper)!;
    for (const q of p.storyboard!.slots.keeper.qa) p = board.setQaResult(p, v, q.id, "pass");
    expect(stateOf("slot:keeper")).toMatchObject({ state: "done", qaDone: ks.qaTotal });
    p = board.setStorySkipped(p, { slot: "cliff" }, true);
    expect(stateOf("slot:cliff").state).toBe("skipped");
    expect(board.setStorySkipped(p, { slot: "cliff" }, true)).toBe(p);
    p = board.setStorySkipped(p, { slot: "cliff" }, false);
    expect(stateOf("slot:cliff").state).toBe("todo");
    p = produced();
    p = board.addStoryVersion(p, { shot: "s1" }, vid, { versionId: "late" });
    expect(stateOf("slot:s1-end").state).toBe("stale");
  });
});
