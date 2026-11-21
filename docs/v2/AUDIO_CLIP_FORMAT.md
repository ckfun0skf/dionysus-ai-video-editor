# Audio clip format (`dionysus.audioclip/1`)

An audio clip is a small JSON document that describes music or a sound effect: tempo, length, and tracks of synth
notes, recorded orchestral instruments (P91), drum hits, noise or generated sound effects, each with volume, pan,
simple effects and params. Dionysus renders it in the browser with Web Audio (`OfflineAudioContext`) into a WAV, so the
same JSON always produces the same audio.

Where it is used:

- **Editor → Add audio → Create Audio** opens the Audio editor (templates, a step grid per track, an SFX designer,
  a mix panel, play/loop preview and undo). Saving adds an audio asset. Its version stores the rendered WAV, which
  the timeline and export use, and the JSON, which **Edit audio** reopens. Saving after an edit adds a new version.
- **Storyboard:** an audio asset with `"source": "json"` is written by an AI. Its **Copy prompt** includes this
  reference and examples; paste the AI's reply into the import box (or import a `.json` file) to add a version.
- **Import / export:** the editor imports `.json` clips, MIDI files (`.mid`, `.midi`) and MusicXML (`.musicxml`,
  `.xml`, `.mxl`), and exports `.json` clips and a WAV.

## Reference

<!-- reference:start -->
```text
{
  "format": "dionysus.audioclip/1",          // required
  "name": string,                            // shown in the editor and the library
  "tempo": 40–240,                           // beats per minute (default 120)
  "tempoMap"?: [ { "step": integer ≥ 0, "tempo": 10–1000 } ],   // tempo changes from a step on (an entry at step 0 replaces "tempo")
  "stepsPerBeat"?: 1–960,                    // grid resolution (default 4 = sixteenth notes; the editor's grid edits up to 8)
  "steps"?: 1–1000000,                       // grid length in steps (default 16)
  "duration"?: 0.05–600,                     // seconds; default = grid length, or the last event's end if longer
  "seed"?: integer,                          // every random choice (noise, rain, glitch) comes from it: same JSON = same audio
  "volume"?: 0–1,                            // master gain (default 0.8)
  "master"?: { "reverb"?: 0–1, "reverbType"?: "room" | "hall" | "church" | "plate" },   // one shared space for the whole mix (default type "hall")
  "tracks": [ {
    "id": string, "name"?: string,
    "instrument": "piano" | "pad" | "bass" | "pluck" | "lead" | "sampler" | "drums" | "noise" | "sfx",
    "sampler"?: "piano" | "strings" | "pizzicato" | "cello" | "violin" | "horn" | "flute" | "harp" | "glockenspiel" | "timpani",   // instrument "sampler" only: a recorded instrument
    "sfx"?: "whoosh" | "impact" | "riser" | "beep" | "glitch" | "wind" | "rain",   // instrument "sfx" only
    "notes"?: [ { "step": integer ≥ 0, "pitch": "C4" | MIDI 0–127, "len"?: steps (default 1), "vel"?: 0–1 } ],   // synths, sampler and drums
    "events"?: [ { "t": seconds, "dur": seconds, "vel"?: 0–1 } ],    // noise and sfx
    "volume"?: 0–1, "pan"?: -1–1, "mute"?: boolean,
    "fx"?: { "reverb"?: 0–1, "reverbType"?: "room" | "hall" | "church" | "plate", "delay"?: 0–0.95, "delayTime"?: 0.02–2 s, "filter"?: { "type": "lowpass" | "highpass" | "bandpass", "cutoff": 20–20000 Hz, "q"?: 0.1–30 } },
    "params"?: { … }                         // per instrument, below
  } ]
}
```

- Synths (piano, pad, bass, pluck, lead): play "notes" on the step grid. A step lasts 60 / tempo / stepsPerBeat seconds. Params: attack -1 or 0–2 s (default -1): Seconds to full level (-1 = the instrument's own).; release -1 or 0–4 s (default -1): Seconds to fade after the note (-1 = the instrument's own).; tone 0–1 (default 0.6): Brightness: low-pass cutoff of the voice.; detune 0–50 ct (default 8): Cents between the voice's oscillators (pad, lead)..
- sampler: recorded orchestral instruments (VSCO-2-CE, CC0) playing "notes" like a synth; use them for film scores and anything that should sound real. "vel" picks the dynamic layer and loudness. Params: attack -1 or 0–4 s (default -1): Seconds to full level (-1 = the recording's own attack).; release -1 or 0–6 s (default -1): Seconds to fade after the note (-1 = the instrument's own).; tone 0–1 (default 1): Brightness: 1 = the recording as is, lower = a darker low-pass.. Instruments:
  - "piano" (A0–C8, rings and decays): Upright piano, two velocity layers; notes ring and decay naturally (hold them for sustain).
  - "strings" (C2–D6, sustains while held): String section (cellos, violas, violins) sustained with vibrato, two dynamics; the film-score bed.
  - "pizzicato" (C2–D6, rings and decays): Plucked string section (cellos and violins).
  - "cello" (C2–F5, sustains while held): Cello section sustained with vibrato, two dynamics; warm low melodies and bass lines.
  - "violin" (G3–C7, sustains while held): Solo violin sustained with vibrato, soft and loud layers; expressive high melodies.
  - "horn" (A1–F5, sustains while held): French horn sustained, two dynamics; noble, soft brass.
  - "flute" (C4–C7, sustains while held): Flute sustained with vibrato; airy melodies.
  - "harp" (E1–F7, rings and decays): Concert harp, plucked; arpeggios and glissando-like runs.
  - "glockenspiel" (G5–C8, rings and decays): Glockenspiel, bright and high (G5–C8); music-box and sparkle lines.
  - "timpani" (D2–A3, rings and decays): Orchestral timpani hits, soft and loud; tune notes around D2–A3.
- drums: "notes" whose "pitch" is a drum name: kick, snare, hat, openhat, clap, tom ("len" is ignored).
- noise: "events" of filtered noise. Params: color 0–2 (default 1): 0 white, 1 pink, 2 brown.; tone 0–1 (default 0.5): Low-pass cutoff (dark to bright).; attack 0–4 s (default 0.2): Fade-in seconds.; release 0–4 s (default 0.4): Fade-out seconds..
- sfx "whoosh": "events". Params: tone 0–1 (default 0.55): Centre brightness.; sweep 0–1 (default 0.7): How far the band moves.; peak 0.1–0.9 (default 0.6): Where the loudest point falls (fraction of the event)..
- sfx "impact": "events". Params: pitch 30–200 Hz (default 60): Body frequency.; punch 0–1 (default 0.7): Noise crack at the hit.; tail 0.1–4 s (default 1.2): Decay seconds..
- sfx "riser": "events". Params: pitch 40–800 Hz (default 120): Start frequency.; pitchEnd 200–4000 Hz (default 1600): End frequency.; noise 0–1 (default 0.4): Noise mixed in..
- sfx "beep": "events". Params: pitch 200–3000 Hz (default 880): Tone frequency.; count 1–6 (default 2): Beeps in the event.; gap 0.02–0.5 s (default 0.08): Silence between beeps.; wave 0–3 (default 0): 0 sine, 1 square, 2 triangle, 3 saw..
- sfx "glitch": "events". Params: density 1–40 (default 14): Bursts per second.; pitch 100–4000 Hz (default 900): Mean burst frequency.; chaos 0–1 (default 0.6): Spread of pitch and length..
- sfx "wind": "events". Params: tone 0–1 (default 0.35): Brightness of the gusts.; gust 0–1 (default 0.5): How much the level and band move.; rate 0.05–2 Hz (default 0.25): Gusts per second..
- sfx "rain": "events". Params: density 0–1 (default 0.6): Drop density.; tone 0–1 (default 0.6): Hiss brightness.; hiss 0–1 (default 0.5): Background hiss level..
- Reverb: "fx.reverb" is the wet amount; without "reverbType" it is the original short noise reverb. "reverbType" picks a space: room (small, ~0.6 s), hall (concert hall, ~2.2 s), church (cathedral, ~4 s), plate (bright, dense, ~2 s). "master.reverb" sends the whole mix into one space, so every instrument sits in the same room.
- Timing: a step lasts 60 / tempo / stepsPerBeat seconds (per "tempoMap" segment when there is one). For exact timing use a finer grid, e.g. "stepsPerBeat": 480 (MIDI resolution); MIDI and MusicXML imports do this.
- Unknown fields are ignored with a warning; out-of-range numbers are clamped with a warning; an unknown instrument, sampler pack, sfx, drum name or reverb type is an error.
<!-- reference:end -->

## Rendering

- Time: a grid step lasts `60 / tempo / stepsPerBeat` seconds. Note `step` and `len` are in steps. Event `t` and
  `dur` are in seconds.
- The clip lasts `duration` seconds, or the grid length (or the last event's end, if that is later). When a track uses
  reverb or delay, a 1.5 s tail is rendered after the end.
- Determinism: noise, rain drops and glitch bursts use a seeded generator (`seed` combined with each track's `id`), and
  reverb impulses are seeded too. The same JSON always renders the same samples on the same engine.
- Output: 48 kHz stereo, through a master gain (`volume`) and a gentle compressor, encoded as a 16-bit WAV.
- A synth `attack` or `release` of `-1` means the instrument's own envelope.
- P91: a clip without the new fields (`sampler` tracks, `reverbType`, `master`, `tempoMap`) renders exactly as before:
  the same synths, the same seeded noise reverb, the same timing and tail. Values that used to be clamped with a warning
  (`stepsPerBeat` above 8, `steps` above 256, `len` above 256, `duration` above 120 s) are now within range.

## Sampled instruments (P91)

`"instrument": "sampler"` with `"sampler": "<pack>"` plays notes on recordings of real instruments instead of
oscillators, for film scores and anything that should sound acoustic. The built-in packs are cut from
[VSCO-2-CE](https://github.com/sgossner/VSCO-2-CE) (Versilian Studios Chamber Orchestra 2, Community Edition, CC0);
credits and the processing are in `public/samples/CREDITS.md`.

| Pack | Range | Kind | Notes |
|---|---|---|---|
| `piano` | A0–C8 | decay | upright piano, soft and loud layers, every 4th semitone |
| `strings` | C2–D6 | sustain | cello, viola and violin sections with vibrato, two dynamics |
| `pizzicato` | C2–D6 | decay | plucked cello and violin sections |
| `cello` | C2–F5 | sustain | cello section with vibrato, two dynamics |
| `violin` | G3–C7 | sustain | solo violin with vibrato, p and f |
| `horn` | A1–F5 | sustain | French horn, two dynamics |
| `flute` | C4–C7 | sustain | flute with vibrato |
| `harp` | E1–F7 | decay | concert harp |
| `glockenspiel` | G5–C8 | decay | glockenspiel |
| `timpani` | D2–A3 | decay | timpani hits, soft and loud |

How a note plays:

- **Zone choice.** `vel` (0–1, MIDI 1–127) picks the velocity layer (soft 1–80, loud 81–127), then the recording whose
  key range holds the note, nearest root first. The recording is pitch-shifted with `playbackRate`
  (`2^((note − root) / 12)`), so it is at most a few semitones from its natural pitch.
- **Level.** Inside a layer the gain follows `(velocity / layer top)^1.2`; the layer change makes loud notes brighter
  and louder. Recordings are loudness-normalised, so packs sit together at the same velocity.
- **Envelope.** `attack` and `release` params (`-1` = the pack's own, e.g. 0.35 s damper for the piano, 0.6 s for the
  strings). Sustained packs loop a 2.6 s region of each recording while the note is held (the loop is crossfaded when
  the file is loaded, so it is click-free), then fade over the release. Decaying packs ring naturally and are damped at
  the note's end; hold a piano note (a long `len`) for a pedal-like ring. `tone` below 1 adds a low-pass for a darker sound.
- **Loading.** Files are fetched from `<app base>/samples/<pack>/` the first time a clip needs them (only the recordings
  its notes use) and cached for the session; the render waits for them. The editor shows "Loading instruments…", and
  an error naming the instrument if a file can't be loaded. About 10 MB for all packs; a typical cue needs 1–3 MB.

### Pack manifest (`dionysus.samplerpack/1`)

Each pack folder has a `manifest.json`:

```jsonc
{
  "format": "dionysus.samplerpack/1",
  "id": "cello", "name": "Cellos",
  "kind": "sustain",            // "sustain" loops while held; "decay" rings and fades
  "attack": 0.01, "release": 0.5, // default envelope, seconds
  "gain": 1,                    // pack level
  "source": "VSCO-2-CE …", "license": "CC0-1.0",
  "zones": [
    { "file": "48-p.mp3", "root": 48, "lo": 46, "hi": 50, "velLo": 1, "velHi": 80,
      "tune": 0,                // optional cents added to the pitch shift
      "loopStart": 2.6, "loopEnd": 5.2 } // optional sustain loop, seconds from the onset
  ]
}
```

`file` is relative to the manifest; `"../<pack>/<file>"` shares a recording of another pack (the `strings` pack uses
the `cello` pack's low notes). Files are mono MP3, which every browser decodes, Safari included. User-supplied packs are
a planned follow-up (#345).

## Reverb spaces (P91)

`fx.reverbType` picks a convolution space for a track's `fx.reverb` (the wet amount):

| Type | Space | Decay (RT60 low / mid / high) |
|---|---|---|
| `room` | small room, strong early reflections | 0.7 / 0.55 / 0.35 s |
| `hall` | concert hall, 22 ms pre-delay | 2.8 / 2.2 / 1.3 s |
| `church` | cathedral, 35 ms pre-delay | 5.0 / 4.0 / 2.2 s |
| `plate` | bright, dense plate | 2.1 / 2.1 / 1.7 s |

Without `reverbType` the track keeps the original seeded noise reverb. The impulse responses are synthetic and
deterministic (nothing is downloaded): a pre-delay, an early-reflection pattern, then a decorrelated stereo tail whose
low, mid and high bands decay at their own rates. Each IR is energy-normalised so a space at the same `reverb` amount is
about as loud as the classic reverb.

`"master": { "reverb": 0–1, "reverbType": … }` (default type `hall`) sends the whole mix into one space, so every
instrument sits in the same room; it is the usual choice for an orchestral cue. Track reverbs still apply on top. The
render tail grows to the longest space used (up to 5.8 s for `church`).

## Timing (P91)

The step grid stays the unit of time, with wider limits: `stepsPerBeat` up to 960 (MIDI resolution, so imported notes
keep their exact timing), `steps` and `len` up to 1,000,000, `duration` up to 600 s. A step lasts
`60 / tempo / stepsPerBeat` seconds.

`tempoMap: [{ "step", "tempo" }]` adds tempo changes: from each entry's `step` on, steps run at its `tempo` (10–1000
BPM). An entry at step 0 replaces `tempo` (MIDI imports use this for a first tempo outside 40–240). Entries are sorted
and one per step (the last one wins).

The Audio editor's step grid edits clips of up to 8 steps per beat and 256 steps without a tempo map. Finer clips
(imports) show a read-only piano roll; their instrument, sound, mix and clip settings stay editable, and notes can be
edited in the JSON.

## MIDI import (P91)

Audio editor → Clip → **Import…** accepts Standard MIDI Files (type 0 and 1). The parser is built in (no library):
delta times, running status, note-on with velocity 0 as note-off, tempo, track names, program changes, CC7 volume,
CC10 pan and CC64 sustain pedal; sysex and other events are skipped.

- One audio track per MIDI track and channel, named after the track.
- Steps are MIDI ticks (`stepsPerBeat` = the file's ticks per quarter, divided down to at most 960), so timing is exact.
  The first tempo is `tempo`; later changes become `tempoMap`.
- The General MIDI program picks the closest built-in instrument: pianos → `piano`, celesta/glockenspiel/music box/
  vibraphone/bells → `glockenspiel`, guitars/harpsichord/marimba → `harp`, violin → `violin`, cello/contrabass → `cello`,
  viola/ensembles/choir → `strings`, pizzicato → `pizzicato`, timpani/taiko → `timpani`, brass/saxophones/bassoon →
  `horn`, flutes/oboe/clarinet → `flute`; organs and synth pads → the `pad` synth, electric basses → `bass`, synth
  leads and distorted guitars → `lead`, anything else → `pluck`.
- Channel 10 maps General MIDI drum keys to the kit (kick, snare, clap, hats, crash/ride → open hat, toms); other keys
  are skipped with a warning.
- The sustain pedal extends notes released while it is down until the pedal lifts (or the key is struck again).
- Velocity becomes `vel`; the clip gets `"master": { "reverb": 0.25, "reverbType": "hall" }`.

## MusicXML import (P91)

The same Import accepts MusicXML: uncompressed `.musicxml` / `.xml` (score-partwise) and compressed `.mxl` (unzipped
with the project archive's ZIP reader). A small built-in XML reader is used (no DOM).

- Each part becomes a track. `<divisions>` (the least common multiple of all of them, at most 960) become
  `stepsPerBeat`.
- Notes, rests, `<chord/>`, ties (`<tie>` / `<tied>`), `<backup>` and `<forward>` (several voices or staves in a
  part) are read; grace notes take no time; unpitched percussion is skipped.
- Tempo from `<sound tempo>` (or a metronome mark); later changes become `tempoMap`.
- Dynamics marks (ppp … fff, sf, fz) and `<sound dynamics>` / `<note dynamics>` set the velocity.
- `<transpose>` is applied, so transposing instruments (clarinet in B♭, horn in F) sound at concert pitch.
- The part's MIDI program, or else its instrument or part name ("Violoncello", "Horn in F", "Violins I"), picks the
  instrument; unknown names get the piano.
- Repeats are played once, as written (a warning says so).

## Examples

<!-- examples:start -->
Ambient pad: Slow evolving chords with reverb and soft noise.
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Ambient pad",
  "tempo": 70,
  "steps": 32,
  "seed": 7,
  "tracks": [
    {
      "id": "pad",
      "name": "Pad",
      "instrument": "pad",
      "volume": 0.7,
      "fx": {
        "reverb": 0.6,
        "filter": {
          "type": "lowpass",
          "cutoff": 2400
        }
      },
      "params": {
        "attack": 1.2,
        "release": 2
      },
      "notes": [
        {
          "step": 0,
          "len": 16,
          "pitch": "C3"
        },
        {
          "step": 0,
          "len": 16,
          "pitch": "G3"
        },
        {
          "step": 0,
          "len": 16,
          "pitch": "E4"
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "A2"
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "E3"
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "C4"
        }
      ]
    },
    {
      "id": "air",
      "name": "Air",
      "instrument": "noise",
      "volume": 0.15,
      "params": {
        "color": 1,
        "tone": 0.3,
        "attack": 2,
        "release": 2
      },
      "events": [
        {
          "t": 0,
          "dur": 6.86
        }
      ]
    }
  ]
}
```

Tension riser: A 4-second riser into an impact.
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Tension riser",
  "tempo": 120,
  "duration": 5.5,
  "seed": 3,
  "tracks": [
    {
      "id": "rise",
      "name": "Riser",
      "instrument": "sfx",
      "sfx": "riser",
      "volume": 0.7,
      "fx": {
        "reverb": 0.3
      },
      "params": {
        "pitch": 90,
        "pitchEnd": 1800,
        "noise": 0.5
      },
      "events": [
        {
          "t": 0,
          "dur": 4
        }
      ]
    },
    {
      "id": "hit",
      "name": "Impact",
      "instrument": "sfx",
      "sfx": "impact",
      "volume": 0.9,
      "fx": {
        "reverb": 0.4
      },
      "params": {
        "pitch": 50,
        "punch": 0.8,
        "tail": 1.4
      },
      "events": [
        {
          "t": 4,
          "dur": 1.5
        }
      ]
    }
  ]
}
```

Lo-fi beat: A relaxed 2-bar beat with keys and bass.
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Lo-fi beat",
  "tempo": 84,
  "steps": 32,
  "seed": 11,
  "volume": 0.8,
  "tracks": [
    {
      "id": "drums",
      "name": "Drums",
      "instrument": "drums",
      "volume": 0.8,
      "fx": {
        "filter": {
          "type": "lowpass",
          "cutoff": 6000
        }
      },
      "notes": [
        {
          "step": 0,
          "pitch": "kick"
        },
        {
          "step": 10,
          "pitch": "kick"
        },
        {
          "step": 16,
          "pitch": "kick"
        },
        {
          "step": 26,
          "pitch": "kick"
        },
        {
          "step": 4,
          "pitch": "snare"
        },
        {
          "step": 12,
          "pitch": "snare"
        },
        {
          "step": 20,
          "pitch": "snare"
        },
        {
          "step": 28,
          "pitch": "snare"
        },
        {
          "step": 0,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 2,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 4,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 6,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 8,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 10,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 12,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 14,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 16,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 18,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 20,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 22,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 24,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 26,
          "pitch": "hat",
          "vel": 0.45
        },
        {
          "step": 28,
          "pitch": "hat",
          "vel": 0.7
        },
        {
          "step": 30,
          "pitch": "hat",
          "vel": 0.45
        }
      ]
    },
    {
      "id": "keys",
      "name": "Keys",
      "instrument": "piano",
      "volume": 0.55,
      "fx": {
        "reverb": 0.35
      },
      "notes": [
        {
          "step": 0,
          "len": 8,
          "pitch": "D4"
        },
        {
          "step": 0,
          "len": 8,
          "pitch": "F4"
        },
        {
          "step": 0,
          "len": 8,
          "pitch": "A4"
        },
        {
          "step": 8,
          "len": 8,
          "pitch": "C4"
        },
        {
          "step": 8,
          "len": 8,
          "pitch": "E4"
        },
        {
          "step": 8,
          "len": 8,
          "pitch": "G4"
        },
        {
          "step": 16,
          "len": 8,
          "pitch": "Bb3"
        },
        {
          "step": 16,
          "len": 8,
          "pitch": "D4"
        },
        {
          "step": 16,
          "len": 8,
          "pitch": "F4"
        },
        {
          "step": 24,
          "len": 8,
          "pitch": "A3"
        },
        {
          "step": 24,
          "len": 8,
          "pitch": "C4"
        },
        {
          "step": 24,
          "len": 8,
          "pitch": "E4"
        }
      ]
    },
    {
      "id": "bass",
      "name": "Bass",
      "instrument": "bass",
      "volume": 0.7,
      "notes": [
        {
          "step": 0,
          "len": 6,
          "pitch": "D2"
        },
        {
          "step": 8,
          "len": 6,
          "pitch": "C2"
        },
        {
          "step": 16,
          "len": 6,
          "pitch": "Bb1"
        },
        {
          "step": 24,
          "len": 6,
          "pitch": "A1"
        }
      ]
    }
  ]
}
```

Notification: A short bright two-note chime.
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Notification",
  "tempo": 150,
  "steps": 8,
  "tracks": [
    {
      "id": "chime",
      "name": "Chime",
      "instrument": "pluck",
      "volume": 0.8,
      "fx": {
        "reverb": 0.25,
        "delay": 0.25,
        "delayTime": 0.15
      },
      "notes": [
        {
          "step": 0,
          "len": 2,
          "pitch": "E5"
        },
        {
          "step": 2,
          "len": 4,
          "pitch": "B5"
        }
      ]
    }
  ]
}
```

Whoosh: A fast air pass for transitions.
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Whoosh",
  "tempo": 120,
  "duration": 1.2,
  "seed": 5,
  "tracks": [
    {
      "id": "whoosh",
      "name": "Whoosh",
      "instrument": "sfx",
      "sfx": "whoosh",
      "volume": 0.85,
      "pan": 0,
      "fx": {
        "reverb": 0.15
      },
      "params": {
        "tone": 0.6,
        "sweep": 0.8,
        "peak": 0.55
      },
      "events": [
        {
          "t": 0,
          "dur": 1.1
        }
      ]
    }
  ]
}
```

Film cue (D minor): A slow, melancholic cue: string chords, a cello line and sparse piano in a hall (recorded instruments).
```json
{
  "format": "dionysus.audioclip/1",
  "name": "Film cue (D minor)",
  "tempo": 66,
  "steps": 64,
  "master": {
    "reverb": 0.35,
    "reverbType": "hall"
  },
  "tracks": [
    {
      "id": "strings",
      "name": "Strings",
      "instrument": "sampler",
      "sampler": "strings",
      "volume": 0.55,
      "pan": -0.15,
      "params": {
        "attack": 0.6,
        "release": 1.5
      },
      "notes": [
        {
          "step": 0,
          "len": 16,
          "pitch": "D3",
          "vel": 0.5
        },
        {
          "step": 0,
          "len": 16,
          "pitch": "A3",
          "vel": 0.5
        },
        {
          "step": 0,
          "len": 16,
          "pitch": "F4",
          "vel": 0.5
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "Bb2",
          "vel": 0.5
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "F3",
          "vel": 0.5
        },
        {
          "step": 16,
          "len": 16,
          "pitch": "D4",
          "vel": 0.5
        },
        {
          "step": 32,
          "len": 16,
          "pitch": "G2",
          "vel": 0.5
        },
        {
          "step": 32,
          "len": 16,
          "pitch": "D3",
          "vel": 0.5
        },
        {
          "step": 32,
          "len": 16,
          "pitch": "Bb3",
          "vel": 0.5
        },
        {
          "step": 48,
          "len": 16,
          "pitch": "A2",
          "vel": 0.5
        },
        {
          "step": 48,
          "len": 16,
          "pitch": "E3",
          "vel": 0.5
        },
        {
          "step": 48,
          "len": 16,
          "pitch": "C#4",
          "vel": 0.5
        }
      ]
    },
    {
      "id": "cello",
      "name": "Cello line",
      "instrument": "sampler",
      "sampler": "cello",
      "volume": 0.6,
      "pan": 0.2,
      "params": {
        "attack": 0.25
      },
      "notes": [
        {
          "step": 0,
          "len": 8,
          "pitch": "A3",
          "vel": 0.6
        },
        {
          "step": 8,
          "len": 4,
          "pitch": "G3",
          "vel": 0.55
        },
        {
          "step": 12,
          "len": 4,
          "pitch": "F3",
          "vel": 0.55
        },
        {
          "step": 16,
          "len": 8,
          "pitch": "F3",
          "vel": 0.6
        },
        {
          "step": 24,
          "len": 4,
          "pitch": "E3",
          "vel": 0.55
        },
        {
          "step": 28,
          "len": 4,
          "pitch": "D3",
          "vel": 0.5
        },
        {
          "step": 32,
          "len": 12,
          "pitch": "D3",
          "vel": 0.6
        },
        {
          "step": 44,
          "len": 4,
          "pitch": "Bb2",
          "vel": 0.5
        },
        {
          "step": 48,
          "len": 16,
          "pitch": "C#3",
          "vel": 0.55
        }
      ]
    },
    {
      "id": "piano",
      "name": "Piano",
      "instrument": "sampler",
      "sampler": "piano",
      "volume": 0.5,
      "params": {
        "release": 1.2
      },
      "notes": [
        {
          "step": 0,
          "len": 4,
          "pitch": "D4",
          "vel": 0.35
        },
        {
          "step": 4,
          "len": 4,
          "pitch": "F4",
          "vel": 0.35
        },
        {
          "step": 8,
          "len": 4,
          "pitch": "A4",
          "vel": 0.35
        },
        {
          "step": 12,
          "len": 4,
          "pitch": "D5",
          "vel": 0.42
        },
        {
          "step": 16,
          "len": 4,
          "pitch": "D4",
          "vel": 0.35
        },
        {
          "step": 20,
          "len": 4,
          "pitch": "F4",
          "vel": 0.35
        },
        {
          "step": 24,
          "len": 4,
          "pitch": "Bb4",
          "vel": 0.35
        },
        {
          "step": 28,
          "len": 4,
          "pitch": "D5",
          "vel": 0.42
        },
        {
          "step": 32,
          "len": 4,
          "pitch": "D4",
          "vel": 0.35
        },
        {
          "step": 36,
          "len": 4,
          "pitch": "G4",
          "vel": 0.35
        },
        {
          "step": 40,
          "len": 4,
          "pitch": "Bb4",
          "vel": 0.35
        },
        {
          "step": 44,
          "len": 4,
          "pitch": "D5",
          "vel": 0.42
        },
        {
          "step": 48,
          "len": 4,
          "pitch": "C#4",
          "vel": 0.35
        },
        {
          "step": 52,
          "len": 4,
          "pitch": "E4",
          "vel": 0.35
        },
        {
          "step": 56,
          "len": 4,
          "pitch": "A4",
          "vel": 0.35
        },
        {
          "step": 60,
          "len": 4,
          "pitch": "E5",
          "vel": 0.42
        }
      ]
    }
  ]
}
```
<!-- examples:end -->

## For AI assistants

Reply with one ```json code block that contains only the clip. Use only the instruments, sampler packs, sfx names,
drum names, reverb types, fields and params listed above. For cinematic or acoustic music prefer `sampler` tracks and a
shared `master` reverb. Unknown fields are ignored with a warning. An unknown instrument, sfx or drum name is
an error, and the paste box shows each problem with its path (for example `tracks[1].sfx`).

## P14: spatial position

The audio creator mixes its tracks with their own `pan` into a stereo WAV; it does not apply 3D position itself. Once the rendered clip is on the timeline it can be positioned (Audio tab pad, `set_clip_props` `position`) like any audio clip; its stereo image is kept (`width` 1 by default).
