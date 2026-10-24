import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { createProject } from "../domain/model";
import { migrateProject } from "../persistence";

describe("setProjectSettings (V2-106)", () => {
  it("changes aspect, fps and background undoably and stays schema-valid", () => {
    const e = new Engine(createProject("t"));
    const s = () => e.getState().project.settings;
    const before = { ...s() };
    expect(e.dispatch(cmd.setProjectSettings({ width: 1080, height: 1920 }))).toBe(true);
    expect(s()).toMatchObject({ width: 1080, height: 1920 });
    e.dispatch(cmd.setProjectSettings({ fps: 60 }));
    e.dispatch(cmd.setProjectSettings({ background: "#ffffff" }));
    expect(s()).toMatchObject({ fps: 60, background: "#ffffff" });
    expect(migrateProject(JSON.parse(JSON.stringify(e.getState().project))).settings).toMatchObject({ width: 1080, height: 1920, fps: 60, background: "#ffffff" });
    e.undo(); e.undo(); e.undo();
    expect(s()).toEqual(before);
  });
  it("clamps sizes to even numbers and fps to 1..120; rejects bad colours", () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.setProjectSettings({ width: 1081, height: 9, fps: 500 }));
    expect(e.getState().project.settings).toMatchObject({ width: 1080, height: 16, fps: 120 });
    expect(e.dispatch(cmd.setProjectSettings({ background: "red" }))).toBe(false);
  });
  it("coalesces a colour-picker drag into one undo step", () => {
    const e = new Engine(createProject("t"));
    e.beginGesture();
    for (const c of ["#111111", "#222222", "#333333"]) e.dispatch(cmd.setProjectSettings({ background: c }));
    e.endGesture();
    expect(e.getState().project.settings.background).toBe("#333333");
    e.undo();
    expect(e.getState().project.settings.background).toBeUndefined();
  });
});
