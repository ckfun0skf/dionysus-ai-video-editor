/**
 * P4A: the dionysus.audioclip/1 reference and the copy prompt for storyboard audio assets with source "json".
 * The reference is generated from the same tables the parser and renderer use, and is also the generated block of
 * docs/v2/AUDIO_CLIP_FORMAT.md (`npm run gen:ai`), so the prompt, the doc and the importer never disagree.
 */
import { AUDIO_CLIP_FORMAT, AUDIO_TEMPLATES, DRUMS, NOISE_PARAMS, SFX, SFX_PARAMS, SYNTHS, SYNTH_PARAMS, type ParamSpec } from "./audioClip";

const params = (ps: ParamSpec[]) => ps.map((p) => `${p.key} ${p.min === 0 && p.default === -1 ? "-1 or " : ""}${p.min}–${p.max}${p.unit ? ` ${p.unit}` : ""} (default ${p.default}): ${p.description}`).join("; ");

/** The field reference: what every key means, with ranges and defaults. */
export const AUDIO_CLIP_REFERENCE = `\`\`\`text
{
  "format": "${AUDIO_CLIP_FORMAT}",          // required
  "name": string,                            // shown in the editor and the library
  "tempo": 40–240,                           // beats per minute (default 120)
  "stepsPerBeat"?: 1–8,                      // grid resolution (default 4 = sixteenth notes)
  "steps"?: 1–256,                           // grid length in steps (default 16)
  "duration"?: 0.05–120,                     // seconds; default = grid length, or the last event's end if longer
  "seed"?: integer,                          // every random choice (noise, rain, glitch) comes from it: same JSON = same audio
  "volume"?: 0–1,                            // master gain (default 0.8)
  "tracks": [ {
    "id": string, "name"?: string,
    "instrument": ${[...SYNTHS, "drums", "noise", "sfx"].map((x) => `"${x}"`).join(" | ")},
    "sfx"?: ${SFX.map((x) => `"${x}"`).join(" | ")},   // instrument "sfx" only
    "notes"?: [ { "step": integer ≥ 0, "pitch": "C4" | MIDI 0–127, "len"?: steps (default 1), "vel"?: 0–1 } ],   // synths and drums
    "events"?: [ { "t": seconds, "dur": seconds, "vel"?: 0–1 } ],    // noise and sfx
    "volume"?: 0–1, "pan"?: -1–1, "mute"?: boolean,
    "fx"?: { "reverb"?: 0–1, "delay"?: 0–0.95, "delayTime"?: 0.02–2 s, "filter"?: { "type": "lowpass" | "highpass" | "bandpass", "cutoff": 20–20000 Hz, "q"?: 0.1–30 } },
    "params"?: { … }                         // per instrument, below
  } ]
}
\`\`\`

- Synths (${SYNTHS.join(", ")}): play "notes" on the step grid. A step lasts 60 / tempo / stepsPerBeat seconds. Params: ${params(SYNTH_PARAMS)}.
- drums: "notes" whose "pitch" is a drum name: ${DRUMS.join(", ")} ("len" is ignored).
- noise: "events" of filtered noise. Params: ${params(NOISE_PARAMS)}.
${SFX.map((s) => `- sfx "${s}": "events". Params: ${params(SFX_PARAMS[s])}.`).join("\n")}
- Unknown fields are ignored with a warning; out-of-range numbers are clamped with a warning; an unknown instrument, sfx or drum name is an error.`;

/** Example clips (the editor's templates), as JSON blocks. */
export const audioClipExamples = (ids = ["notification", "tension-riser", "lofi-beat"]) =>
  AUDIO_TEMPLATES.filter((t) => ids.includes(t.id)).map((t) => `${t.name}: ${t.description}\n\`\`\`json\n${JSON.stringify(t.clip, null, 2)}\n\`\`\``).join("\n\n");

/** The prompt a user copies to their AI for an audio asset with source "json". */
export function audioClipPrompt(input: { name: string; brief: string; durationSec?: number; specUrl: string }): string {
  return `Write a sound for my video in the ${AUDIO_CLIP_FORMAT} JSON format. Dionysus renders it in the browser (Web Audio, deterministic), so reply with ONLY one \`\`\`json code block containing the clip: no commentary.

Sound: ${input.name}
Brief: ${input.brief || "(none given)"}${input.durationSec ? `\nLength: about ${Math.round(input.durationSec * 10) / 10} seconds (set "duration").` : ""}

Rules:
- "format" must be "${AUDIO_CLIP_FORMAT}". Use only the instruments, sfx names, drum names, fields and params below.
- Music: synth and drum tracks with "notes" on the step grid; set "tempo", "steps" (and "stepsPerBeat" if not 4). Keep chords and bass in one key.
- Sound effects: "sfx" or "noise" tracks with "events" in seconds; shape them with "params" and "fx".
- Keep it to about 1–6 tracks and leave headroom (track volumes 0.5–0.9).

Format reference (full spec: ${input.specUrl}):
${AUDIO_CLIP_REFERENCE}

Examples:

${audioClipExamples()}
`;
}
