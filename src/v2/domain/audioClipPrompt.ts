/**
 * P4A: the dionysus.audioclip/1 reference and the copy prompt for storyboard audio assets with source "json".
 * The reference is generated from the same tables the parser and renderer use, and is also the generated block of
 * docs/v2/AUDIO_CLIP_FORMAT.md (`npm run gen:ai`), so the prompt, the doc and the importer never disagree.
 */
import { AUDIO_CLIP_FORMAT, AUDIO_TEMPLATES, DRUMS, MAX_DURATION, MAX_STEPS, NOISE_PARAMS, noteName, REVERB_TYPES, SAMPLER_PARAMS, SFX, SFX_PARAMS, SYNTHS, SYNTH_PARAMS, type ParamSpec } from "./audioClip";
import { SAMPLER_PACKS } from "./samplerPacks";

const params = (ps: ParamSpec[]) => ps.map((p) => `${p.key} ${p.min === 0 && p.default === -1 ? "-1 or " : ""}${p.min}–${p.max}${p.unit ? ` ${p.unit}` : ""} (default ${p.default}): ${p.description}`).join("; ");

/** The field reference: what every key means, with ranges and defaults. */
export const AUDIO_CLIP_REFERENCE = `\`\`\`text
{
  "format": "${AUDIO_CLIP_FORMAT}",          // required
  "name": string,                            // shown in the editor and the library
  "tempo": 40–240,                           // beats per minute (default 120)
  "tempoMap"?: [ { "step": integer ≥ 0, "tempo": 10–1000 } ],   // tempo changes from a step on (an entry at step 0 replaces "tempo")
  "stepsPerBeat"?: 1–960,                    // grid resolution (default 4 = sixteenth notes; the editor's grid edits up to 8)
  "steps"?: 1–${MAX_STEPS},                       // grid length in steps (default 16)
  "duration"?: 0.05–${MAX_DURATION},                     // seconds; default = grid length, or the last event's end if longer
  "seed"?: integer,                          // every random choice (noise, rain, glitch) comes from it: same JSON = same audio
  "volume"?: 0–1,                            // master gain (default 0.8)
  "master"?: { "reverb"?: 0–1, "reverbType"?: ${REVERB_TYPES.map((x) => `"${x}"`).join(" | ")} },   // one shared space for the whole mix (default type "hall")
  "tracks": [ {
    "id": string, "name"?: string,
    "instrument": ${[...SYNTHS, "sampler", "drums", "noise", "sfx"].map((x) => `"${x}"`).join(" | ")},
    "sampler"?: ${SAMPLER_PACKS.map((x) => `"${x.id}"`).join(" | ")},   // instrument "sampler" only: a recorded instrument
    "sfx"?: ${SFX.map((x) => `"${x}"`).join(" | ")},   // instrument "sfx" only
    "notes"?: [ { "step": integer ≥ 0, "pitch": "C4" | MIDI 0–127, "len"?: steps (default 1), "vel"?: 0–1 } ],   // synths, sampler and drums
    "events"?: [ { "t": seconds, "dur": seconds, "vel"?: 0–1 } ],    // noise and sfx
    "volume"?: 0–1, "pan"?: -1–1, "mute"?: boolean,
    "fx"?: { "reverb"?: 0–1, "reverbType"?: ${REVERB_TYPES.map((x) => `"${x}"`).join(" | ")}, "delay"?: 0–0.95, "delayTime"?: 0.02–2 s, "filter"?: { "type": "lowpass" | "highpass" | "bandpass", "cutoff": 20–20000 Hz, "q"?: 0.1–30 } },
    "params"?: { … }                         // per instrument, below
  } ]
}
\`\`\`

- Synths (${SYNTHS.join(", ")}): play "notes" on the step grid. A step lasts 60 / tempo / stepsPerBeat seconds. Params: ${params(SYNTH_PARAMS)}.
- sampler: recorded orchestral instruments (VSCO-2-CE, CC0) playing "notes" like a synth; use them for film scores and anything that should sound real. "vel" picks the dynamic layer and loudness. Params: ${params(SAMPLER_PARAMS)}. Instruments:
${SAMPLER_PACKS.map((p) => `  - "${p.id}" (${noteName(p.range[0])}–${noteName(p.range[1])}, ${p.kind === "sustain" ? "sustains while held" : "rings and decays"}): ${p.description}`).join("\n")}
- drums: "notes" whose "pitch" is a drum name: ${DRUMS.join(", ")} ("len" is ignored).
- noise: "events" of filtered noise. Params: ${params(NOISE_PARAMS)}.
${SFX.map((s) => `- sfx "${s}": "events". Params: ${params(SFX_PARAMS[s])}.`).join("\n")}
- Reverb: "fx.reverb" is the wet amount; without "reverbType" it is the original short noise reverb. "reverbType" picks a space: room (small, ~0.6 s), hall (concert hall, ~2.2 s), church (cathedral, ~4 s), plate (bright, dense, ~2 s). "master.reverb" sends the whole mix into one space, so every instrument sits in the same room.
- Timing: a step lasts 60 / tempo / stepsPerBeat seconds (per "tempoMap" segment when there is one). For exact timing use a finer grid, e.g. "stepsPerBeat": 480 (MIDI resolution); MIDI and MusicXML imports do this.
- Unknown fields are ignored with a warning; out-of-range numbers are clamped with a warning; an unknown instrument, sampler pack, sfx, drum name or reverb type is an error.`;

/** Example clips (the editor's templates), as JSON blocks. */
export const audioClipExamples = (ids = ["notification", "tension-riser", "lofi-beat", "film-cue-dminor"]) =>
  AUDIO_TEMPLATES.filter((t) => ids.includes(t.id)).map((t) => `${t.name}: ${t.description}\n\`\`\`json\n${JSON.stringify(t.clip, null, 2)}\n\`\`\``).join("\n\n");

/** The prompt a user copies to their AI for an audio asset with source "json". */
export function audioClipPrompt(input: { name: string; brief: string; durationSec?: number; specUrl: string }): string {
  return `Write a sound for my video in the ${AUDIO_CLIP_FORMAT} JSON format. Dionysus renders it in the browser (Web Audio, deterministic), so reply with ONLY one \`\`\`json code block containing the clip: no commentary.

Sound: ${input.name}
Brief: ${input.brief || "(none given)"}${input.durationSec ? `\nLength: about ${Math.round(input.durationSec * 10) / 10} seconds (set "duration").` : ""}

Rules:
- "format" must be "${AUDIO_CLIP_FORMAT}". Use only the instruments, sfx names, drum names, fields and params below.
- Music: synth, sampler and drum tracks with "notes" on the step grid; set "tempo", "steps" (and "stepsPerBeat" if not 4). Keep chords and bass in one key.
- For cinematic or acoustic music use "sampler" tracks (piano, strings, cello, violin, horn, flute, harp, glockenspiel, timpani, pizzicato) and a shared "master" reverb (hall or church); synths suit electronic music, UI sounds and lo-fi.
- Sound effects: "sfx" or "noise" tracks with "events" in seconds; shape them with "params" and "fx".
- Keep it to about 1–6 tracks and leave headroom (track volumes 0.5–0.9).

Format reference (full spec: ${input.specUrl}):
${AUDIO_CLIP_REFERENCE}

Examples:

${audioClipExamples()}
`;
}
