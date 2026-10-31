# Audio clip format (`dionysus.audioclip/1`)

An audio clip is a small JSON document that describes music or a sound effect: tempo, length, and tracks of synth
notes, drum hits, noise or generated sound effects, each with volume, pan, simple effects and params. Dionysus
renders it in the browser with Web Audio (`OfflineAudioContext`) into a WAV, so the same JSON always produces the
same audio.

Where it is used:

- **Editor → Add audio → Create Audio** opens the Audio editor (templates, a step grid per track, an SFX designer,
  a mix panel, play/loop preview and undo). Saving adds an audio asset. Its version stores the rendered WAV, which
  the timeline and export use, and the JSON, which **Edit audio** reopens. Saving after an edit adds a new version.
- **Storyboard:** an audio asset with `"source": "json"` is written by an AI. Its **Copy prompt** includes this
  reference and examples; paste the AI's reply into the import box (or import a `.json` file) to add a version.
- **Import / export:** the editor imports and exports `.json` clips and exports a WAV.

## Reference

<!-- reference:start -->
```text
{
  "format": "dionysus.audioclip/1",          // required
  "name": string,                            // shown in the editor and the library
  "tempo": 40–240,                           // beats per minute (default 120)
  "stepsPerBeat"?: 1–8,                      // grid resolution (default 4 = sixteenth notes)
  "steps"?: 1–256,                           // grid length in steps (default 16)
  "duration"?: 0.05–120,                     // seconds; default = grid length, or the last event's end if longer
  "seed"?: integer,                          // every random choice (noise, rain, glitch) comes from it: same JSON = same audio
  "volume"?: 0–1,                            // master gain (default 0.8)
  "tracks": [ {
    "id": string, "name"?: string,
    "instrument": "piano" | "pad" | "bass" | "pluck" | "lead" | "drums" | "noise" | "sfx",
    "sfx"?: "whoosh" | "impact" | "riser" | "beep" | "glitch" | "wind" | "rain",   // instrument "sfx" only
    "notes"?: [ { "step": integer ≥ 0, "pitch": "C4" | MIDI 0–127, "len"?: steps (default 1), "vel"?: 0–1 } ],   // synths and drums
    "events"?: [ { "t": seconds, "dur": seconds, "vel"?: 0–1 } ],    // noise and sfx
    "volume"?: 0–1, "pan"?: -1–1, "mute"?: boolean,
    "fx"?: { "reverb"?: 0–1, "delay"?: 0–0.95, "delayTime"?: 0.02–2 s, "filter"?: { "type": "lowpass" | "highpass" | "bandpass", "cutoff": 20–20000 Hz, "q"?: 0.1–30 } },
    "params"?: { … }                         // per instrument, below
  } ]
}
```

- Synths (piano, pad, bass, pluck, lead): play "notes" on the step grid. A step lasts 60 / tempo / stepsPerBeat seconds. Params: attack -1 or 0–2 s (default -1): Seconds to full level (-1 = the instrument's own).; release -1 or 0–4 s (default -1): Seconds to fade after the note (-1 = the instrument's own).; tone 0–1 (default 0.6): Brightness: low-pass cutoff of the voice.; detune 0–50 ct (default 8): Cents between the voice's oscillators (pad, lead)..
- drums: "notes" whose "pitch" is a drum name: kick, snare, hat, openhat, clap, tom ("len" is ignored).
- noise: "events" of filtered noise. Params: color 0–2 (default 1): 0 white, 1 pink, 2 brown.; tone 0–1 (default 0.5): Low-pass cutoff (dark to bright).; attack 0–4 s (default 0.2): Fade-in seconds.; release 0–4 s (default 0.4): Fade-out seconds..
- sfx "whoosh": "events". Params: tone 0–1 (default 0.55): Centre brightness.; sweep 0–1 (default 0.7): How far the band moves.; peak 0.1–0.9 (default 0.6): Where the loudest point falls (fraction of the event)..
- sfx "impact": "events". Params: pitch 30–200 Hz (default 60): Body frequency.; punch 0–1 (default 0.7): Noise crack at the hit.; tail 0.1–4 s (default 1.2): Decay seconds..
- sfx "riser": "events". Params: pitch 40–800 Hz (default 120): Start frequency.; pitchEnd 200–4000 Hz (default 1600): End frequency.; noise 0–1 (default 0.4): Noise mixed in..
- sfx "beep": "events". Params: pitch 200–3000 Hz (default 880): Tone frequency.; count 1–6 (default 2): Beeps in the event.; gap 0.02–0.5 s (default 0.08): Silence between beeps.; wave 0–3 (default 0): 0 sine, 1 square, 2 triangle, 3 saw..
- sfx "glitch": "events". Params: density 1–40 (default 14): Bursts per second.; pitch 100–4000 Hz (default 900): Mean burst frequency.; chaos 0–1 (default 0.6): Spread of pitch and length..
- sfx "wind": "events". Params: tone 0–1 (default 0.35): Brightness of the gusts.; gust 0–1 (default 0.5): How much the level and band move.; rate 0.05–2 Hz (default 0.25): Gusts per second..
- sfx "rain": "events". Params: density 0–1 (default 0.6): Drop density.; tone 0–1 (default 0.6): Hiss brightness.; hiss 0–1 (default 0.5): Background hiss level..
- Unknown fields are ignored with a warning; out-of-range numbers are clamped with a warning; an unknown instrument, sfx or drum name is an error.
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
<!-- examples:end -->

## For AI assistants

Reply with one ```json code block that contains only the clip. Use only the instruments, sfx names, drum names,
fields and params listed above. Unknown fields are ignored with a warning. An unknown instrument, sfx or drum name is
an error, and the paste box shows each problem with its path (for example `tracks[1].sfx`).

## P14: spatial position

The audio creator mixes its tracks with their own `pan` into a stereo WAV; it does not apply 3D position itself. Once the rendered clip is on the timeline it can be positioned (Audio tab pad, `set_clip_props` `position`) like any audio clip; its stereo image is kept (`width` 1 by default).
