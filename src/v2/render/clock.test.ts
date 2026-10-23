// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AudioClock, correctDrift, wallClock } from "./clock";
import { Player } from "./player";
import { createMemoryStorage } from "../persistence";
import { createProject, ops, TICKS_PER_SECOND } from "../domain";

const fakeCtx = () => {
  const c = { currentTime: 0, state: "suspended" as AudioContextState, resume: async () => { c.state = "running"; } };
  return c;
};

describe("AudioClock", () => {
  it("follows AudioContext.currentTime once running, without jumping from the fallback", async () => {
    let wall = 10;
    const ctx = fakeCtx();
    const clock = new AudioClock(ctx, { kind: "wall", now: () => wall });
    expect(clock.now()).toBe(10);
    wall = 11;
    expect(clock.now()).toBe(11);
    clock.start();
    await Promise.resolve();
    ctx.currentTime = 100;
    expect(clock.now()).toBe(11); // switch is continuous
    ctx.currentTime = 100.5; wall = 50; // wall clock is ignored now
    expect(clock.now()).toBeCloseTo(11.5);
  });
  it("wallClock uses performance time in seconds", () => {
    expect(wallClock({ now: () => 2500 }).now()).toBe(2.5);
  });
});

describe("correctDrift", () => {
  it("hard-seeks large drift, nudges small drift, leaves tiny drift", () => {
    expect(correctDrift(5.5, 5)).toEqual({ seek: 5, rate: 1 });
    expect(correctDrift(5.1, 5)).toEqual({ rate: 0.95 });
    expect(correctDrift(4.9, 5)).toEqual({ rate: 1.05 });
    expect(correctDrift(5.01, 5)).toEqual({ rate: 1 });
  });
});

describe("Player master clock", () => {
  it("advances timeline time from the injected clock, not wall time", () => {
    let t = 0;
    const p0 = createProject("c");
    const comp = p0.compositions[p0.rootCompositionId];
    const vid = comp.tracks[0].id;
    const withClip = ops.insertPlacement(comp, vid, { id: "pl", startTicks: 0, durationTicks: 10 * TICKS_PER_SECOND, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "x", versionId: "y" }, clipType: "video" });
    const project = { ...p0, compositions: { [comp.id]: withClip } };
    const player = new Player(project, createMemoryStorage().blobs, { kind: "audio", now: () => t });
    expect(player.clockKind).toBe("audio");
    player.play();
    t = 1.5; player.tick();
    expect(player.time).toBe(1.5 * TICKS_PER_SECOND);
    player.seek(5 * TICKS_PER_SECOND);
    t = 2; player.tick();
    expect(player.time).toBe(5.5 * TICKS_PER_SECOND);
    t = 100; player.tick();
    expect(player.isPlaying).toBe(false);
    expect(player.time).toBe(10 * TICKS_PER_SECOND);
    player.dispose();
  });
});
