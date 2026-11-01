/**
 * P25 regression: echo on dry audio effects. A mock Web Audio graph records every node and connection so the tests can
 * check which presets contain delay or reverb, and that the position stage is dry at the ear.
 */
import { describe, expect, it } from "vitest";
import { listPresets } from "../registry";
import { CENTRE, POSITION_PRESETS, spatialParams } from "../domain/spatial";
import { audioFxData, buildFxChain } from "./audioFx";
import { buildSpatial } from "./spatial";

type Kind = "gain" | "biquad" | "shaper" | "delay" | "convolver" | "osc" | "split" | "merge" | "panner" | "dest";
class Param { value = 0; events: number[] = []; setValueAtTime(v: number) { this.value = v; this.events.push(v); } linearRampToValueAtTime(v: number) { this.setValueAtTime(v); } setTargetAtTime(v: number) { this.setValueAtTime(v); } }
class Node {
  out: Node[] = []; gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param(); [k: string]: unknown;
  constructor(public kind: Kind) {}
  connect(n: Node | Param) { if (n instanceof Node) this.out.push(n); return n; }
  disconnect() { this.out = []; } start() {} stop() {}
}
function mockCtx() {
  const nodes: Node[] = [];
  const mk = (k: Kind) => () => { const n = new Node(k); nodes.push(n); return n; };
  const ctx = {
    sampleRate: 8000, currentTime: 0, destination: new Node("dest"),
    createGain: mk("gain"), createBiquadFilter: mk("biquad"), createWaveShaper: mk("shaper"), createDelay: mk("delay"),
    createConvolver: mk("convolver"), createOscillator: mk("osc"), createChannelSplitter: mk("split"), createChannelMerger: mk("merge"), createPanner: mk("panner"),
    createBuffer: () => ({ copyToChannel() {} }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, nodes };
}

/** Presets meant to add echo or reverb; every other preset must be dry (no delay line, no convolver). */
const WET: Record<string, "reverb" | "echo" | "echo+reverb"> = { hall: "reverb", room: "reverb", underwater: "reverb", "pa-announcement": "echo+reverb", robot: "echo" };

describe("P25 audio effects contain only their intended processing", () => {
  const ids = listPresets("audioFx").map((p) => p.id);
  it("knows every shipped preset", () => { for (const id of ["telephone", "radio", "hall", "room", "robot", "underwater", "pa-announcement"]) expect(ids).toContain(id); });
  for (const id of ids) it(`${id}: ${WET[id] ?? "dry"}`, () => {
    const { ctx, nodes } = mockCtx();
    buildFxChain(ctx, audioFxData(id)!, 1);
    const kinds = new Set(nodes.map((n) => n.kind));
    const w = WET[id] ?? "";
    expect(kinds.has("convolver")).toBe(w.includes("reverb"));
    expect(kinds.has("delay")).toBe(w.includes("echo") || (w.includes("reverb") && !!audioFxData(id)!.reverb?.preDelay));
  });
  it("Telephone is a 300-3400 Hz band with mild saturation and nothing else", () => {
    const { ctx, nodes } = mockCtx();
    buildFxChain(ctx, audioFxData("telephone")!, 1);
    const f = nodes.filter((n) => n.kind === "biquad");
    expect(f.map((n) => [n.type, Math.round(n.frequency.value)])).toEqual([["highpass", 300], ["lowpass", 3400], ["peaking", 1500]]);
    expect(nodes.filter((n) => n.kind === "shaper")).toHaveLength(1);
    expect(nodes.some((n) => ["delay", "convolver", "osc"].includes(n.kind))).toBe(false);
  });
  it("each chain is a single path: the input reaches the output once per branch, never through a feedback loop for dry presets", () => {
    const { ctx } = mockCtx();
    const c = buildFxChain(ctx, audioFxData("telephone")!, 1) as unknown as { input: Node; output: Node };
    let paths = 0; const walk = (n: Node, depth: number) => { if (depth > 50) throw new Error("loop"); if (n === c.output) { paths++; return; } n.out.forEach((m) => walk(m, depth + 1)); };
    walk(c.input, 0);
    expect(paths).toBe(1);
  });
});

describe("P25 position stage is transparent near the listener", () => {
  it("no reverb send at distance 0 at any angle, so a clip with a position at the ear stays dry", () => {
    for (const az of [0, -90, 90, 180]) for (const env of ["room", "outdoor"] as const) expect(spatialParams({ ...CENTRE, azimuth: az }, env).reverb).toBe(0);
  });
  it("near spots get at most a faint send; far spots keep their room sound", () => {
    const at = (id: string) => spatialParams(POSITION_PRESETS.find((p) => p.id === id)!).reverb;
    expect(at("front-centre")).toBeLessThan(0.02);
    expect(at("far-left")).toBeGreaterThan(0.2);
  });
  for (const mode of ["stereo", "binaural"] as const) it(`${mode}: the stage's send into the shared reverb is 0 at the centre`, () => {
    const { ctx, nodes } = mockCtx();
    buildSpatial(ctx, mode, "room").set({ ...CENTRE });
    const conv = nodes.find((n) => n.kind === "convolver")!;
    const sends = nodes.filter((n) => n.kind === "gain" && n.out.includes(conv));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBe(0);
  });
});
