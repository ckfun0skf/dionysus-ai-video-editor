# Sampled instruments: credits and licence

The recordings in this folder come from **VS Chamber Orchestra 2: Community Edition (VSCO-2-CE)** by Versilian
Studios, recorded by Sam Gossner and Simon Dalzell (Ivy Audio; the upright piano), sample cutting by Elan
Hickler/Soundemote.

- Source: https://github.com/sgossner/VSCO-2-CE (branch `master`)
- Homepage: http://vis.versilstudios.net/vsco-community.html
- Licence: **CC0 1.0 Universal** (public domain dedication). The authors ask for credit to Versilian Studios / Sam
  Gossner and Ivy Audio / Simon Dalzell, a link to the VSCO: CE homepage, and that the samples are not sold on their own.
  Dionysus gives that credit here and in the Audio editor.

## What was used

| Pack | VSCO-2-CE folder | Recordings |
|---|---|---|
| `piano` | `Keys/Upright Piano` (dyn2 = soft layer, dyn3 = loud layer, every 4th semitone, A0–C8) | 46 |
| `strings` | `Strings/Cello Section/susvib` (C2–F3), `Strings/Viola Section/susvib` (G3–F4), `Strings/Violin Section/susVib` (A4–D6), two dynamics | 32 (12 shared with `cello`) |
| `pizzicato` | `Strings/Cello Section/pizzT` (C2–F3), `Strings/Violin Section/Pizz` (G3–D6), two dynamics, first round robin | 34 |
| `cello` | `Strings/Cello Section/susvib`, v1 and v3 | 26 |
| `violin` | `Strings/Solo Violin/Arco Vib`, p and f | 30 |
| `horn` | `Brass/F Horn/sus`, v1 and v3 (notes recorded only at v1 serve both layers) | 22 |
| `flute` | `Woodwinds/Flute/susvib`, v1 | 10 |
| `harp` | `Strings/Harp` | 23 |
| `glockenspiel` | `Percussion/Glock` | 6 |
| `timpani` | `Percussion/Timpani` hits, drums 1–5, v3 and v4, first round robin | 10 |

## How the files were made

1. Decoded to mono at 48 kHz (the stereo image of these close recordings adds little once a reverb space is applied).
2. Pitch: VSCO-2-CE file names use C3 = middle C for most folders and scientific pitch (C4 = middle C) for the solo
   violin and the harp; every root note in the manifests was checked by pitch analysis. Timpani are tuned to their
   measured principal pitch (the manifests' `tune` holds the cents to the nearest semitone).
3. Trimmed to 5 ms before the onset. Sustained instruments keep about 5.2 s and get a 2.6 s sustain loop
   (`loopStart`/`loopEnd`, seconds from the onset; the player crossfades it when it loads the file). Decaying
   instruments keep their natural ring until -60 dB (capped at 2.5–10 s) with a short fade-out.
4. Loudness-normalised per recording: the RMS of the first second goes to -16 dBFS (sustained) or -20 dBFS (decaying),
   soft layers 6 dB lower, peaks kept under -0.5 dBFS.
5. Encoded as MP3 (LAME VBR quality 4), which every browser's `decodeAudioData` accepts, Safari included.

File names are `<root MIDI note>-<layer>.mp3` (`p` soft, `f` loud, `all` single layer). The manifest format
(`dionysus.samplerpack/1`) is described in `docs/v2/AUDIO_CLIP_FORMAT.md`.
