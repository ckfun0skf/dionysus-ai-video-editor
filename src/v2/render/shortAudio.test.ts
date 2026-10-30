import { describe, expect, it } from "vitest";
import { createProject, TICKS_PER_SECOND as S, type Placement } from "../domain";
import { audioPlan, fitFades, gainEvents } from "./export/plan";
import { upcomingMedia } from "./frame";

const clip = (id: string, start: number, dur: number, extra: Partial<Placement> = {}): Placement =>
  ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "audio", source: { kind: "assetVersion", assetId: "a", versionId: "v" }, ...extra }) as Placement;

describe("short audio clips (P1-SHORT-AUDIO)", () => {
  it("fades that overrun a short clip are scaled to fit", () => {
    expect(fitFades(0.3, 1, 2)).toEqual({ fadeIn: expect.closeTo(0.1, 9), fadeOut: expect.closeTo(0.2, 9) });
    expect(fitFades(5, 1, 2)).toEqual({ fadeIn: 1, fadeOut: 2 });
  });

  it("gain automation stays in time order and reaches the clip's volume", () => {
    for (const s of [{ start: 2, duration: 0.25, volume: 0.8, fadeIn: 1, fadeOut: 1 }, { start: 0, duration: 0.1, volume: 1, fadeIn: 0, fadeOut: 0 }, { start: 1, duration: 4, volume: 0.5, fadeIn: 1, fadeOut: 1 }]) {
      const ev = gainEvents(s);
      for (let i = 1; i < ev.length; i++) expect(ev[i].at).toBeGreaterThanOrEqual(ev[i - 1].at);
      expect(ev.at(-1)!.at).toBeLessThanOrEqual(s.start + s.duration + 1e-9);
      expect(Math.max(...ev.map((e) => e.value))).toBe(s.volume);
    }
  });

  it("a 0.2 s clip with long fades is still exported", () => {
    const p = createProject("t");
    p.assets.a = { id: "a", name: "hit", kind: "audio", versions: [{ id: "v", media: { blobKey: "b", mime: "audio/mpeg", durationTicks: S / 5 } }] } as never;
    const comp = p.compositions[p.rootCompositionId];
    comp.tracks.push({ id: "au", kind: "audio", name: "A", placements: [clip("c", S, S / 5, { fadeInTicks: S, fadeOutTicks: S }), clip("z", 2 * S, 0)] });
    const plan = audioPlan(p);
    expect(plan).toHaveLength(1);
    expect(plan[0].fadeIn + plan[0].fadeOut).toBeCloseTo(0.2, 9);
  });

  it("the player preloads media starting within the lookahead", () => {
    const p = createProject("t");
    const comp = p.compositions[p.rootCompositionId];
    comp.tracks.push({ id: "au", kind: "audio", name: "A", placements: [clip("soon", S, S / 10), clip("late", 5 * S, S)] }, { id: "h", kind: "audio", name: "H", hidden: true, placements: [clip("hid", S, S)] });
    expect(upcomingMedia(comp, 0, 2 * S).map((x) => x.placement.id)).toEqual(["soon"]);
  });
});
