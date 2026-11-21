/**
 * P91: sampled instruments for `dionysus.audioclip/1` (docs/v2/AUDIO_CLIP_FORMAT.md, "Sampled instruments").
 * The built-in packs are recordings from VSCO-2-CE (Versilian Studios Chamber Orchestra 2, Community Edition, CC0),
 * served from public/samples/<pack>/ with a `dionysus.samplerpack/1` manifest each. This module holds the pack list
 * (ids are validated by the clip parser), the manifest types and the zone choice; loading and playback live in
 * render/sampler.ts.
 */
export const SAMPLER_PACK_FORMAT = "dionysus.samplerpack/1" as const;

export interface SamplerPackInfo {
  id: string;
  name: string;
  description: string;
  /** Lowest and highest MIDI note the recordings cover (notes outside are pitch-shifted from the nearest sample). */
  range: readonly [number, number];
  /** "sustain": held notes loop until released (strings, winds, brass); "decay": notes ring and fade (piano, harp, percussion). */
  kind: "sustain" | "decay";
  /** Octave the Audio editor's grid opens on. */
  octave: number;
}

export const SAMPLER_PACKS = [
  { id: "piano", name: "Piano", description: "Upright piano, two velocity layers; notes ring and decay naturally (hold them for sustain).", range: [21, 108], kind: "decay", octave: 4 },
  { id: "strings", name: "Strings", description: "String section (cellos, violas, violins) sustained with vibrato, two dynamics; the film-score bed.", range: [36, 86], kind: "sustain", octave: 3 },
  { id: "pizzicato", name: "Pizzicato", description: "Plucked string section (cellos and violins).", range: [36, 86], kind: "decay", octave: 3 },
  { id: "cello", name: "Cellos", description: "Cello section sustained with vibrato, two dynamics; warm low melodies and bass lines.", range: [36, 77], kind: "sustain", octave: 3 },
  { id: "violin", name: "Solo violin", description: "Solo violin sustained with vibrato, soft and loud layers; expressive high melodies.", range: [55, 96], kind: "sustain", octave: 5 },
  { id: "horn", name: "French horn", description: "French horn sustained, two dynamics; noble, soft brass.", range: [33, 77], kind: "sustain", octave: 3 },
  { id: "flute", name: "Flute", description: "Flute sustained with vibrato; airy melodies.", range: [60, 96], kind: "sustain", octave: 5 },
  { id: "harp", name: "Harp", description: "Concert harp, plucked; arpeggios and glissando-like runs.", range: [28, 101], kind: "decay", octave: 4 },
  { id: "glockenspiel", name: "Glockenspiel", description: "Glockenspiel, bright and high (G5–C8); music-box and sparkle lines.", range: [79, 108], kind: "decay", octave: 6 },
  { id: "timpani", name: "Timpani", description: "Orchestral timpani hits, soft and loud; tune notes around D2–A3.", range: [38, 57], kind: "decay", octave: 2 },
] as const satisfies readonly SamplerPackInfo[];
export type SamplerId = (typeof SAMPLER_PACKS)[number]["id"];
export const SAMPLER_IDS: readonly SamplerId[] = SAMPLER_PACKS.map((p) => p.id);
export const samplerPack = (id: string | undefined): SamplerPackInfo | undefined => SAMPLER_PACKS.find((p) => p.id === id);

/** One recording: plays notes `lo`..`hi` at velocities `velLo`..`velHi` (MIDI 1–127) by pitch-shifting from `root`. */
export interface SamplerZone {
  /** Path relative to the manifest: a file in the pack's folder, or "../<pack>/<file>" to share another pack's recording. */
  file: string;
  root: number;
  lo: number;
  hi: number;
  velLo: number;
  velHi: number;
  /** Extra gain for this recording (default 1). */
  gain?: number;
  /** Fine tuning in cents added to the pitch shift (default 0). */
  tune?: number;
  /** Sustain loop in seconds from the note's onset; the player crossfades it when the file is loaded. */
  loopStart?: number;
  loopEnd?: number;
}

export interface SamplerManifest {
  format: typeof SAMPLER_PACK_FORMAT;
  id: string;
  name: string;
  kind: "sustain" | "decay";
  /** Default envelope in seconds (a track's attack/release params override them). */
  attack: number;
  release: number;
  /** Pack level, so packs sit together at the same note velocity. */
  gain: number;
  source?: string;
  license?: string;
  zones: SamplerZone[];
}

/** Velocity 0–1 → MIDI 1–127. */
export const midiVelocity = (vel: number) => Math.min(127, Math.max(1, Math.round(vel * 127)));

/**
 * Which zone plays a note: the velocity layer that contains the velocity (all zones if none does), then the zone whose
 * range contains the note, nearest root first (ties: the lower root); if none contains it, the nearest root. Returns
 * the zone's index, or -1 for an empty manifest.
 */
export function pickZone(m: Pick<SamplerManifest, "zones">, midi: number, vel: number): number {
  const v = midiVelocity(vel);
  let cands = m.zones.map((z, i) => ({ z, i })).filter(({ z }) => v >= z.velLo && v <= z.velHi);
  if (!cands.length) cands = m.zones.map((z, i) => ({ z, i }));
  if (!cands.length) return -1;
  const inside = cands.filter(({ z }) => midi >= z.lo && midi <= z.hi);
  const pool = inside.length ? inside : cands;
  let best = pool[0];
  for (const c of pool) {
    const d = Math.abs(c.z.root - midi), bd = Math.abs(best.z.root - midi);
    if (d < bd || (d === bd && c.z.root < best.z.root)) best = c;
  }
  return best.i;
}

/**
 * Gain for a velocity inside its layer: the layer's own recording is the loudness at the top of the layer, and lower
 * velocities scale down on a gentle curve (the layer change already makes loud notes brighter and louder).
 */
export function velocityGain(vel: number, layerTop = 127): number {
  const v = midiVelocity(vel);
  return Math.pow(v / Math.max(v, layerTop), 1.2);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A zone's file: a name in the pack's folder, or in a sibling pack's ("../cello/48-p.mp3", shared recordings). */
const SAFE_FILE = /^(\.\.\/[a-z0-9-]+\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Check a fetched manifest; throws with a readable message (the editor shows it). */
export function parseSamplerManifest(raw: unknown, id: string): SamplerManifest {
  const bad = (why: string) => new Error(`The "${id}" instrument's manifest is invalid: ${why}.`);
  if (!isObj(raw) || raw.format !== SAMPLER_PACK_FORMAT) throw bad(`"format" must be "${SAMPLER_PACK_FORMAT}"`);
  if (!Array.isArray(raw.zones) || !raw.zones.length) throw bad('"zones" must be a non-empty array');
  const zones = raw.zones.map((z: unknown, i: number): SamplerZone => {
    if (!isObj(z) || typeof z.file !== "string" || !SAFE_FILE.test(z.file) || ![z.root, z.lo, z.hi, z.velLo, z.velHi].every(num)) throw bad(`zones[${i}] needs a relative "file" and numbers root, lo, hi, velLo, velHi`);
    const out: SamplerZone = { file: z.file, root: z.root as number, lo: z.lo as number, hi: z.hi as number, velLo: z.velLo as number, velHi: z.velHi as number };
    if (num(z.gain)) out.gain = z.gain;
    if (num(z.tune)) out.tune = z.tune;
    if (num(z.loopStart) && num(z.loopEnd) && z.loopEnd > z.loopStart && z.loopStart > 0) { out.loopStart = z.loopStart; out.loopEnd = z.loopEnd; }
    return out;
  });
  return {
    format: SAMPLER_PACK_FORMAT, id: typeof raw.id === "string" ? raw.id : id, name: typeof raw.name === "string" ? raw.name : id,
    kind: raw.kind === "sustain" ? "sustain" : "decay", attack: num(raw.attack) ? raw.attack : 0.005, release: num(raw.release) ? raw.release : 0.3,
    gain: num(raw.gain) ? raw.gain : 1, ...(typeof raw.source === "string" ? { source: raw.source } : {}), ...(typeof raw.license === "string" ? { license: raw.license } : {}), zones,
  };
}
