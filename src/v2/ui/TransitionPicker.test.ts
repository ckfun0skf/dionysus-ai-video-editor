import { describe, expect, it } from "vitest";
import { createProject, transitions, type Placement } from "../domain";
import { cutOf, filterKinds, POPULAR_TAB, SAVED_TAB } from "./TransitionPicker";

const T = 120_000;
const clip = (id: string, start: number): Placement => ({ id, startTicks: start, durationTicks: 2 * T, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video" });

describe("TransitionPicker helpers", () => {
  it("cutOf finds the clip before a cut on video tracks only", () => {
    const p = createProject(); const c = p.compositions[p.rootCompositionId];
    c.tracks[0].placements = [clip("a", 0), clip("b", 2 * T), clip("c", 5 * T)];
    expect(cutOf(c, "b")?.prev.id).toBe("a");
    expect(cutOf(c, "a")).toBeUndefined();
    expect(cutOf(c, "c")).toBeUndefined();
    expect(cutOf(c, "missing")).toBeUndefined();
  });
  it("filterKinds: Popular, categories, Saved order, and search across all tabs", () => {
    const kinds = transitions.transitionKinds();
    expect(filterKinds(kinds, POPULAR_TAB, "", []).every((k) => k.popular)).toBe(true);
    expect(filterKinds(kinds, "Wipe", "", []).map((k) => k.id)).toContain("iris");
    expect(filterKinds(kinds, SAVED_TAB, "", ["glitch", "nope", "dip"]).map((k) => k.id)).toEqual(["glitch", "dip"]);
    const zoom = filterKinds(kinds, SAVED_TAB, " ZOOM ", []).map((k) => k.id);
    expect(zoom).toEqual(expect.arrayContaining(["zoom-in", "zoom-out"]));
    expect(filterKinds(kinds, POPULAR_TAB, "spark", [], (id) => (id === "flash" ? "a bright spark" : ""))).toHaveLength(1);
  });
});
