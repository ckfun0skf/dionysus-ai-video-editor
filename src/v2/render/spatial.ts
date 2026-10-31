/**
 * P14-SPATIAL: the position stage of the audio mixer, built the same way on the preview AudioContext (Player) and the
 * export OfflineAudioContext (export/encode.ts mixAudio). See domain/spatial for the maths and conventions.
 *
 * in → lowpass → split L/R → mid (L+R)/2 → [stereo: equal-power L/R gains | binaural: PannerNode HRTF at unit distance]
 *                          → side (L−R)/2 → ±width                                 → merge → distance gain → out
 * mid → reverb send → shared per-context reverb bus (generated impulse, no network) → destination.
 */
import { REVERB, spatialParams, type AudioEnvironment, type AudioOutputMode, type SpatialPos } from "../domain/spatial";
import { impulseSamples } from "./audioFx";

export interface SpatialStage { input: AudioNode; output: AudioNode; set(pos: SpatialPos, at?: number, how?: "set" | "ramp" | "smooth"): void; dispose(): void }

const buses = new WeakMap<BaseAudioContext, Map<string, AudioNode>>();
/** One reverb per context and environment, wired to the destination. */
export function reverbBus(ctx: BaseAudioContext, env: AudioEnvironment): AudioNode {
  let m = buses.get(ctx); if (!m) buses.set(ctx, (m = new Map()));
  let n = m.get(env);
  if (!n) {
    const r = REVERB[env], conv = ctx.createConvolver();
    const [l, rr] = impulseSamples(ctx.sampleRate, r.seconds, r.decay);
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate); buf.copyToChannel(l, 0); buf.copyToChannel(rr, 1);
    conv.buffer = buf; conv.connect(ctx.destination); m.set(env, (n = conv));
  }
  return n;
}

export function buildSpatial(ctx: BaseAudioContext, mode: AudioOutputMode, env: AudioEnvironment): SpatialStage {
  const nodes: AudioNode[] = [];
  const mk = <N extends AudioNode>(n: N) => { nodes.push(n); return n; };
  const gain = (v = 1) => { const g = mk(ctx.createGain()); g.gain.value = v; return g; };
  // Upmix here (a ChannelSplitter is fixed to "discrete"): a mono source becomes L = R, so it has no side and is a point source.
  const input = gain(); input.channelCount = 2; input.channelCountMode = "explicit"; input.channelInterpretation = "speakers";
  const lp = mk(ctx.createBiquadFilter()); lp.type = "lowpass"; lp.Q.value = 0.707; lp.frequency.value = 20000;
  const split = mk(ctx.createChannelSplitter(2));
  input.connect(lp).connect(split);
  const mid = gain(), side = gain();
  split.connect(gain(0.5), 0).connect(mid); split.connect(gain(0.5), 1).connect(mid);
  split.connect(gain(0.5), 0).connect(side); split.connect(gain(-0.5), 1).connect(side);
  const merge = mk(ctx.createChannelMerger(2));
  const dist = gain(), output = gain();
  merge.connect(dist).connect(output);
  const sideL = gain(1), sideR = gain(-1);
  side.connect(sideL).connect(merge, 0, 0); side.connect(sideR).connect(merge, 0, 1);
  let midL: GainNode | undefined, midR: GainNode | undefined, panner: PannerNode | undefined;
  if (mode === "binaural") {
    panner = mk(ctx.createPanner()); panner.panningModel = "HRTF"; panner.distanceModel = "linear"; panner.refDistance = 1; panner.maxDistance = 10000; panner.rolloffFactor = 0;
    panner.channelCount = 1; panner.channelCountMode = "explicit";
    mid.connect(panner).connect(dist);
  } else {
    midL = gain(1); midR = gain(1);
    mid.connect(midL).connect(merge, 0, 0); mid.connect(midR).connect(merge, 0, 1);
  }
  const send = gain(0); mid.connect(send).connect(reverbBus(ctx, env));
  const put = (p: AudioParam, v: number, at: number, how: "set" | "ramp" | "smooth") => {
    if (how === "smooth") p.setTargetAtTime(v, at, 0.03); else if (how === "ramp") p.linearRampToValueAtTime(v, at); else p.setValueAtTime(v, at);
  };
  return {
    input, output,
    set(pos, at = ctx.currentTime, how = "set") {
      const s = spatialParams(pos, env);
      put(lp.frequency, s.lowpass, at, how); put(dist.gain, s.gain, at, how); put(send.gain, s.reverb * s.gain, at, how);
      put(sideL.gain, s.side, at, how); put(sideR.gain, -s.side, at, how);
      if (midL && midR) { put(midL.gain, s.midL, at, how); put(midR.gain, s.midR, at, how); }
      if (panner) { put(panner.positionX, s.xyz.x, at, how); put(panner.positionY, 0, at, how); put(panner.positionZ, s.xyz.z, at, how); }
    },
    dispose() { for (const n of nodes) n.disconnect(); },
  };
}
