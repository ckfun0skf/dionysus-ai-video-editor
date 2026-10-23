import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { createProject } from "../domain/model";

describe("text clips", () => {
  it("adds onto a text track, reuses it, edits undoably", () => {
    const e = new Engine(createProject("t"));
    expect(e.dispatch(cmd.addTextClip(0, { text: "Hi" }, "a"))).toBe(true);
    const comp = () => e.getState().project.compositions[e.getState().project.rootCompositionId];
    expect(comp().tracks[0].kind).toBe("text");
    e.dispatch(cmd.addTextClip(0, {}, "b"));
    expect(comp().tracks.filter((t) => t.kind === "text")).toHaveLength(2);
    e.dispatch(cmd.updateText("a", { color: "#ff0000" }));
    expect(comp().tracks.flatMap((t) => t.placements).find((p) => p.id === "a")!.text!.color).toBe("#ff0000");
    e.undo();
    expect(comp().tracks.flatMap((t) => t.placements).find((p) => p.id === "a")!.text!.color).not.toBe("#ff0000");
  });
  it("splits like a media clip", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.addTextClip(0, {}, "a"));
    expect(e.dispatch(cmd.splitPlacement("a", 120000, "b"))).toBe(true);
    expect(e.getState().project.compositions[e.getState().project.rootCompositionId].tracks[0].placements).toHaveLength(2);
  });
});
