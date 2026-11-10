// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProject } from "../domain";
import { cmd, Engine } from "../engine";
import { createMemoryStorage } from "../persistence";
import { Player } from "./player";

describe("P54 Player.snapshotWithout", () => {
  it("returns an offscreen frame without the omitted clip and restores the on-screen player", () => {
    const e = new Engine(createProject("mix"));
    e.dispatch(cmd.addBlankClip(0, "#ff0000", "main", undefined, "m1"));
    e.dispatch(cmd.addBlankClip(0, "#00ff00", "overlay", undefined, "o1"));
    const player = new Player(e.getState().project, createMemoryStorage().blobs, { kind: "wall", now: () => 0 } as never);
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 36;
    player.canvas = canvas;
    player.draw();
    const snap = player.snapshotWithout("o1");
    expect(snap?.image).toBeInstanceOf(HTMLCanvasElement);
    expect(snap?.image).not.toBe(canvas);
    expect(snap!.image.width).toBe(64);
    expect(snap!.image.height).toBe(36);
    expect(player.canvas).toBe(canvas);
    expect(player.time).toBe(0);
    player.dispose();
  });
});
