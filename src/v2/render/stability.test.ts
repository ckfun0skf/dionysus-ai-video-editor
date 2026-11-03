// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProject, TICKS_PER_SECOND as S, type Placement } from "../domain";
import { BufferGate, idleEvictions, mediaStalled } from "./stability";
import { Player } from "./player";

describe("P27 preview stability", () => {
  it("the buffer gate holds only after the grace period and releases at once", () => {
    const g = new BufferGate(250);
    expect(g.update(0, true)).toBe(false);
    expect(g.update(200, true)).toBe(false);
    expect(g.update(260, true)).toBe(true);
    expect(g.update(270, false)).toBe(false);
    expect(g.update(280, true)).toBe(false);
  });
  it("idle media beyond the cap are released least recently used first; live ones are kept", () => {
    const used = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]]);
    expect(idleEvictions(used, new Set(["a"]), 2)).toEqual(["b", "c"]);
    expect(idleEvictions(used, new Set(), 10)).toEqual([]);
  });
  it("a seeking or empty element is stalled; an errored one is not", () => {
    expect(mediaStalled({ readyState: 4, seeking: true })).toBe(true);
    expect(mediaStalled({ readyState: 2, seeking: false })).toBe(true);
    expect(mediaStalled({ readyState: 4, seeking: false })).toBe(false);
    expect(mediaStalled({ readyState: 0, seeking: false, error: {} })).toBe(false);
  });
  it("the player holds the playhead while a playing source has no data, then continues", async () => {
    const p = createProject("t");
    p.assets.a = { id: "a", name: "a", kind: "audio", selectedVersionId: "v", versions: [{ id: "v", createdAt: "", media: { blobKey: "b", mime: "audio/mpeg", durationTicks: 10 * S }, provenance: { source: "import", inputs: [] } }] } as never;
    const comp = p.compositions[p.rootCompositionId];
    comp.tracks.push({ id: "au", kind: "audio", name: "A", placements: [{ id: "c", startTicks: 0, durationTicks: 10 * S, sourceInTicks: 0, clipType: "audio", source: { kind: "assetVersion", assetId: "a", versionId: "v" } } as Placement] });
    let now = 0;
    const player = new Player(p, { get: async () => new Blob(["x"]) } as never, { now: () => now } as never);
    const states: boolean[] = [];
    player.onLoading = (l) => states.push(l);
    globalThis.URL.createObjectURL ??= () => "blob:x";
    player.draw(); await new Promise((r) => setTimeout(r, 0));
    player.play();
    const el = (player as unknown as { pool: Map<string, HTMLMediaElement> }).pool.get("c")!;
    expect(el).toBeTruthy();
    Object.defineProperty(el, "play", { value: () => Promise.resolve(), configurable: true });
    Object.defineProperty(el, "readyState", { value: 0, configurable: true });
    player.tick(); now = 0.1; player.tick(); now = 0.4; player.tick(); now = 1; player.tick();
    expect(player.loading).toBe(true);
    const held = player.time;
    expect(held).toBeLessThan(0.5 * S);
    Object.defineProperty(el, "readyState", { value: 4, configurable: true });
    player.tick(); now = 1.5; player.tick();
    expect(player.loading).toBe(false);
    expect(player.time).toBeGreaterThan(held);
    expect(states).toEqual([true, false]);
    player.dispose();
  });
});
