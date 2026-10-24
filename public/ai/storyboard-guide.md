# Dionysus storyboard guide (dionysus.storyboard/1, v1.1)

This guide is for AI assistants that plan a video storyboard for the Dionysus video editor (https://ckfun0skf.github.io/dionysus-ai-video-editor/?v2). It is generated from the app's preset registry, so the preset ids below are exactly the ones the importer accepts. Machine-readable presets: https://ckfun0skf.github.io/dionysus-ai-video-editor/ai/presets.json. Full format reference: https://ckfun0skf.github.io/dionysus-ai-video-editor/ai/STORYBOARD_FORMAT.md.

How to use it: the user has agreed a story with you. Turn it into a production storyboard and reply with ONLY one JSON code block in the format below — no commentary before or after. The user pastes your reply into Dionysus (Storyboard → Import JSON), which checks it, then generates or uploads every asset and clip from your prompts.

## FORMAT ("dionysus.storyboard/1", v1.1)
```
{
  "format": "dionysus.storyboard/1",
  "meta": {
    "title": string, "logline"?: string, "synopsis"?: string, "style"?: string, "language"?: string,
    "aspect": "16:9" | "9:16" | "1:1" | "4:5" | "21:9",
    "textStyles"?: { "<style id>": TextStyle }   // one-off text looks for this storyboard; ids must not clash with preset ids
  },
  "assets": [ {
      "id": string,              // short unique id: letters, digits, "_", "-", "."
      "name": string,
      "type": "character" | "location" | "prop" | "style" | "image" | "frame" | "video" | "audio" | "html",
      "aspect"?: string,         // defaults to meta.aspect; character sheets often "1:1"
      "prompt": string,          // full, self-contained image/video generation prompt (required when source is "generate");
                                 // for "html": describes the animated component the user's AI will build as one .html file
      "references"?: string[],   // ids of other assets to feed as references when generating this one
      "source": "generate" | "upload" | { "type": "lastFrame", "shot": "<shot id>" },   // "html" can't use lastFrame
      "qa": string[]             // 2-5 concrete yes/no checks to verify the asset by looking
  } ],
  "shots": [ {                   // in playback order
      "id": string,
      "title": string,
      "description"?: string,
      "durationSec": number,     // 0.5–120; how long the shot stays on screen in the final edit, set by the story's pacing (NOT by the video model's limits)
      "genDurationSec"?: number, // only when the video model must render longer (minimum or fixed lengths, e.g. 6/10/15 s): the length to generate; > durationSec; the upload is trimmed to durationSec
      "prompt": string,          // full clip generation prompt; required for render "ai", keep one for "html"/"still" too
      "assets": string[],        // ids of the assets this clip uses (include "clip" when set)
      "references"?: [ { "asset": "<asset id>", "role": "start-frame" | "end-frame" | "identity" | "look" | "detail", "note"?: string } ],
                                 // the images to attach to the clip generation IN THIS ORDER (Image 1, Image 2 …) and how to use each;
                                 // omitted = "assets" order with roles from the type (frame → start-frame, character → identity,
                                 // style → look, others → detail); at most one "start-frame" and one "end-frame"
      "camera"?: string,
      "dialogue"?: string,
      "qa": string[],            // 2-5 concrete yes/no checks for the clip
      "render"?: "ai" | "html" | "still",   // default "ai" (generated clip); "html" = uploaded HTML animation; "still" = an image held on screen
      "clip"?: "<asset id>",     // required for "html" (an html asset) and "still" (an image asset)
      "captions"?: boolean,      // true = show "dialogue" as subtitles over the shot
      "layers"?: Layer[],        // drawn in list order (later = on top)
      "effects"?: [ { "preset": "<video effect id>", "params"?: { ... }, "startSec"?: number, "endSec"?: number } ]   // default: whole shot
  } ],
  "connections"?: [ {
      "from": "<shot id>", "to": "<shot id>",     // adjacent shots only
      "kind": "cut" | "continuity" | "match",
      "note"?: string,
      "transition"?: { "preset": "<transition id>", "params"?: { "durationSec"?: number } }   // omitted = cut; default 0.5 s
  } ]
}

Layer (times in seconds from the shot start, 0 <= startSec < endSec <= durationSec; coordinates are 0-1 fractions of the frame from the top-left):
  Text:  { "id": string, "type": "text", "text": string, "startSec": number, "endSec": number,
           "position": { "x", "y" }            // text centre (preferred), OR
           "box": { "x", "y", "width", "height" },   // top-left + size; give exactly one of position / box
           "textStyle"?: "<text style id or meta.textStyles key>",
           "style"?: TextStyle,                // overrides the text style
           "anim"?: { "in"?: "<id>", "out"?: "<id>", "loop"?: "<id>", "durationSec"?: number } }
  Media: { "id": string, "type": "html" | "image" | "video", "asset": "<asset id>", "startSec": number, "endSec": number,
           "box": { "x", "y", "width", "height" } }
TextStyle: { "font"?: "<font id>", "size"?: number (fraction of frame height, 0-1), "color"?: "#rrggbb", "align"?: "left" | "center" | "right", "bold"?: boolean }
Text is one line per "\n" and is never wrapped: keep lines short. Without "size", text uses the style's size (else 0.1), or fits the box height.
```

## PRESETS
Only these ids may be used. Omitted params take their defaults.

Text styles — shots[].layers[].textStyle (default "plain"):
- plain: Bold white sans-serif with no decoration; the default. Look: font sans, colour #ffffff.
- caption: Smaller bold white text on a translucent black box; subtitles and lower thirds. Look: font sans, colour #ffffff, size 0.06.
- outline: Yellow Impact letters with a thick black outline; meme or punchy look. Look: font impact, colour #ffe14d.
- neon: White rounded letters with a pink neon glow and a gentle pulse. Look: font rounded, colour #ffffff.
- pop: Large white Impact title with a hard drop shadow that pops in and shrinks out. Look: font impact, colour #ffffff, size 0.14.
- typewriter: Light grey monospace that types itself on. Look: font mono, colour #e8e8e8.
- glow: Italic white serif with a cyan glow that floats softly. Look: font serif, colour #ffffff.
- echo: White Impact letters with pink echo copies that slide up in. Look: font impact, colour #ffffff.

Text animations in — shots[].layers[].anim.in:
- fade: Fades the text in from transparent.
- slide-up: Fades in while sliding up into place from slightly below. Params: distance 0–0.5, default 0.08; dirX -1–1, default 0; dirY -1–1, default 1.
- slide-left: Fades in while sliding left into place from the right. Params: distance 0–0.5, default 0.15; dirX -1–1, default 1; dirY -1–1, default 0.
- pop: Scales up from small with a springy overshoot; lively titles and labels. Params: overshoot 0–0.5, default 0.12.
- zoom-in: Grows from nothing to full size.
- typewriter: Reveals the text one character at a time.
- wipe: Reveals the text left to right behind a moving edge.
- blur-in: Fades in from a soft blur to sharp; gentle, cinematic. Params: blur 0–30, default 8.

Text animations out — shots[].layers[].anim.out:
- fade: Fades the text out to transparent.
- slide-down: Fades out while sliding down. Params: distance 0–0.5, default 0.08; dirX -1–1, default 0; dirY -1–1, default 1.
- shrink: Shrinks to nothing.
- blur-out: Blurs and fades away. Params: blur 0–30, default 8.
- wipe-out: Hides the text right to left behind a moving edge.

Text loops — shots[].layers[].anim.loop:
- pulse: Gently grows and shrinks in a loop. Params: period 0.2–4, default 1; amount 0–0.3, default 0.06.
- wiggle: Rocks side to side in a loop; playful. Params: period 0.2–4, default 1; degrees 0–30, default 4.
- float: Bobs softly up and down in a loop. Params: period 0.2–4, default 1; amount 0–0.1, default 0.015.
- blink: Blinks on and off in a loop. Params: period 0.2–4, default 1.

Video effects — shots[].effects[].preset:
- fade-in: Fades the picture in from black at the start of the range. Params: length 0.05–1, default 0.5 (fraction of the effect's time range, not seconds; 0.5 fades in over the first half of the range).
- fade-out: Fades the picture out to black at the end of the range. Params: length 0.05–1, default 0.5 (fraction of the effect's time range, not seconds; 0.5 fades out over the last half of the range).
- blur: Blurs the whole picture. Params: amount 0–1, default 0.5.
- ken-burns: Slow zoom and pan across the picture (push-in); brings stills to life. Params: zoom 0–1, default 0.25; pan -0.3–0.3, default 0.05.
- shake: Handheld camera shake. Params: amount 0–0.1, default 0.02; speed 2–40, default 16.
- vignette: Darkens the frame edges to focus the centre. Params: amount 0–1, default 0.6.
- bw: Black-and-white (desaturated) picture. Params: amount 0–1, default 1.

Transitions — connections[].transition.preset (params.durationSec, default 0.5):
- crossfade: The outgoing clip dissolves into the incoming clip.
- dip: Fades the outgoing clip to black, then up into the incoming clip.
- dip-white: Fades the outgoing clip to white, then out of white into the incoming clip; dreamy or memory scenes. Params: color (color), default "#ffffff".
- flash: A quick bright flash hides the cut; punchy, for beats and reveals. Params: color (color), default "#ffffff"; strength 0–1, default 0.9 (Opacity of the flash at its peak).
- push-left: The incoming clip pushes the outgoing clip out to the left. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-right: The incoming clip pushes the outgoing clip out to the right. Params: dirX -1–1, default 1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-up: The incoming clip pushes the outgoing clip up and out of frame. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default -1 (Vertical direction the picture moves: -1 up, 1 down, 0 none); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-down: The incoming clip pushes the outgoing clip down and out of frame. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 1 (Vertical direction the picture moves: -1 up, 1 down, 0 none); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- whip-left: A fast push to the left with motion blur, like a whip pan. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none); blur 0–0.1, default 0.04 (Blur at the middle of the move, as a fraction of the frame height).
- slide-over: The incoming clip slides in from the right over the outgoing clip, which darkens. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none).
- wipe-right: A hard edge sweeps left to right, revealing the incoming clip. Params: dirX -1–1, default 1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none).
- wipe-left: A hard edge sweeps right to left, revealing the incoming clip. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 0 (Vertical direction the picture moves: -1 up, 1 down, 0 none).
- wipe-down: A hard edge sweeps top to bottom, revealing the incoming clip. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default 1 (Vertical direction the picture moves: -1 up, 1 down, 0 none).
- wipe-up: A hard edge sweeps bottom to top, revealing the incoming clip. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 left, 1 right, 0 none); dirY -1–1, default -1 (Vertical direction the picture moves: -1 up, 1 down, 0 none).
- iris: The incoming clip opens from a growing circle in the centre.
- zoom-in: Rushes forward: the outgoing clip zooms in and the incoming clip continues the push; energetic. Params: outScale 0.2–3, default 1.8 (Scale the outgoing clip reaches); inScale 0.2–3, default 0.6 (Scale the incoming clip starts from); blur 0–0.1, default 0.02 (Peak blur as a fraction of the frame height).
- zoom-out: Pulls back: the outgoing clip shrinks away and the incoming clip settles in from larger. Params: outScale 0.2–3, default 0.5 (Scale the outgoing clip reaches); inScale 0.2–3, default 1.6 (Scale the incoming clip starts from); blur 0–0.1, default 0.02 (Peak blur as a fraction of the frame height).
- spin: The outgoing clip spins away and the incoming clip spins into place; playful. Params: degrees 30–720, default 180 (Degrees each clip turns).
- blur-dissolve: Both clips soften into a blur while they cross-dissolve; smooth and gentle. Params: blur 0–0.1, default 0.03 (Peak blur as a fraction of the frame height).
- defocus: The outgoing clip goes out of focus, then the incoming clip pulls into focus. Params: blur 0–0.1, default 0.05 (Peak blur as a fraction of the frame height); cut 0–1, default 1 (1 swaps the clips at full blur instead of dissolving).
- glitch: Digital glitch: picture bands jump sideways around a hard cut; tech, horror, hype. Params: amount 0–0.3, default 0.08 (Largest band shift as a fraction of the frame width).
- shake: A camera jolt around a hard cut; impacts and beat drops. Params: amount 0–0.15, default 0.04 (Largest jolt as a fraction of the frame).

Fonts — TextStyle "font":
- sans: Clean system sans-serif; the default.
- serif: Classic book serif for titles and literary cards.
- mono: Monospace, typewriter or terminal feel.
- impact: Heavy condensed display face for punchy titles.
- rounded: Soft rounded sans, friendly and playful.
- hand: Casual handwritten marker look.
- script: Flowing brush script for elegant accents.
- condensed: Narrow sans that fits long lines.

## RULES
1. Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions.
2. Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt.
3. When a shot must continue seamlessly from the previous one, add an asset with "type": "frame" and "source": { "type": "lastFrame", "shot": "<previous shot id>" }, use it in the next shot's "assets", and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.
4. Use "source": "upload" for things the user already has (logos, real photos, products).
5. Every asset and shot gets 2–5 QA checks that a person can verify by looking: identity consistency, key props, framing, artefacts (extra fingers, warped text, watermarks).
6. Keep ids short and stable (e.g. "hero", "kitchen", "s1", "s1-end"). Shots are listed in order; "connections" may be omitted for simple hard cuts.
7. Output valid JSON only: double quotes, no comments, no trailing commas.
8. Every piece of on-screen text (titles, cards, labels, captions) goes into a text layer, never into a generation prompt. Prompts ask for clean, empty surfaces where the text will sit.
9. Use "html" assets and "render": "html" only for animated, 3D or three.js graphics. Plain text is a text layer.
10. Transitions go on connections. Post camera moves (push-in etc.) and looks go in the shot's "effects", and the generation prompt then says "static camera".
11. Only use preset ids listed in the PRESETS section.
12. Preset params use the units noted in brackets in the PRESETS section; "fade-in"/"fade-out" "length" is a fraction (0.05–1) of the effect's time range, not seconds.
13. "durationSec" is how long the shot stays on screen in the final edit (its planned edit length). Decide it from the story's pacing, NOT from what the video model can generate, and never put the planned length only in "description" or notes. If the video model can't render that length (it has a minimum or fixed lengths, e.g. 6, 10 or 15 s), keep "durationSec" at the planned length and set "genDurationSec" to the length to ask the model for; it must be greater than "durationSec" (omit it when they are equal). When the clip is uploaded the app trims it to "durationSec" and the user picks which part to keep. Example: a 4 s beat with a model that renders 6 s minimum: "durationSec": 4, "genDurationSec": 6.
14. Every clip prompt starts with a "References:" block that numbers the images attached to the clip in the order of the shot's "references" (else its "assets"): "Image 1 (<asset name>): …", one line each, saying explicitly whether the image is the START FRAME (or END FRAME) or only a reference, and what to take from it (identity, overall look, or materials and colours only, not its framing or wide view). Then state the framing from the first frame to the last. Set "references" with roles whenever the order or use is not obvious from the asset types.
15. A transition in "connections" overlaps the two shots, centred on the cut: it adds no time and eats half its length from the end of the "from" shot and half from the start of the "to" shot. It is clamped to half the shorter of the two shots. For example, a 0.8 s transition out of a 2.5 s shot blends the last 0.4 s of that shot with the first 0.4 s of the next, and the total length stays the same; keep transitions short on short shots so their key action isn't covered.
16. For an "identity" reference prefer a single clean portrait or character image (one view, plain background) over a multi-view character sheet: the sheet's layout (several poses, panels, labels) can leak into the generated frames.

## EXAMPLE
```json
{
  "format": "dionysus.storyboard/1",
  "meta": {
    "title": "The Lantern Keeper",
    "logline": "An old keeper lights the last lantern before the storm.",
    "aspect": "16:9",
    "style": "Painterly realism, warm lantern light against cold blue dusk, 35mm film grain",
    "language": "en",
    "textStyles": {
      "keeper-title": {
        "font": "serif",
        "size": 0.1,
        "color": "#fff4d6",
        "bold": false
      }
    }
  },
  "assets": [
    {
      "id": "keeper",
      "name": "The keeper",
      "type": "character",
      "aspect": "1:1",
      "prompt": "Character sheet of an elderly lighthouse keeper, weathered face, grey beard, yellow oilskin coat, front and 3/4 views, neutral background, painterly realism",
      "references": [],
      "source": {
        "type": "generate"
      },
      "qa": [
        "Same face and beard in every view",
        "Yellow oilskin coat, no logos",
        "No extra fingers or limbs"
      ]
    },
    {
      "id": "cliff",
      "name": "Cliff and lighthouse",
      "type": "location",
      "aspect": "16:9",
      "prompt": "Wide establishing shot of a lonely white lighthouse on a black basalt cliff at blue dusk, storm clouds rolling in, painterly realism",
      "references": [],
      "source": {
        "type": "generate"
      },
      "qa": [
        "Lighthouse is white with a red cap",
        "Storm clouds on the left, calm sky on the right"
      ]
    },
    {
      "id": "lantern",
      "name": "Brass lantern",
      "type": "prop",
      "aspect": "1:1",
      "prompt": "Antique brass storm lantern with glass chimney, product shot on dark background",
      "references": [],
      "source": {
        "type": "upload"
      },
      "qa": [
        "Glass chimney intact"
      ]
    },
    {
      "id": "s1-end",
      "name": "Last frame of shot 1",
      "type": "frame",
      "aspect": "16:9",
      "prompt": "",
      "references": [],
      "source": {
        "type": "lastFrame",
        "shot": "s1"
      },
      "qa": [
        "Keeper is at the door, lantern in his right hand"
      ]
    }
  ],
  "shots": [
    {
      "id": "s1",
      "title": "Climbing the cliff path",
      "description": "The keeper walks up the cliff path toward the lighthouse door.",
      "durationSec": 5,
      "prompt": "References:\nImage 1 (The keeper): reference only, not a frame: keep his face, beard and yellow oilskin coat.\nImage 2 (Cliff and lighthouse): reference only, not a frame: the lighthouse, cliff and dusk colours only; do not copy its wide framing.\nImage 3 (Brass lantern): reference only: the lantern's brass and glass only.\nNo image is the start frame. Framing: starts as a medium-wide tracking shot from behind on the path, ends close behind him at the lighthouse door.\n\nThe elderly keeper in a yellow oilskin coat walks up a cliff path toward a white lighthouse at dusk, carrying a brass lantern, wind in his coat, slow tracking shot from behind, ends with him reaching the door",
      "assets": [
        "keeper",
        "cliff",
        "lantern"
      ],
      "qa": [
        "Keeper matches the character sheet",
        "Lantern stays in his right hand",
        "Ends at the lighthouse door"
      ],
      "camera": "Slow tracking shot from behind"
    },
    {
      "id": "s2",
      "title": "Lighting the lamp",
      "description": "Inside the lamp room he lights the great lamp.",
      "durationSec": 6,
      "prompt": "References:\nImage 1 (Last frame of shot 1): START FRAME: the clip opens on exactly this image.\nImage 2 (The keeper): reference only, not a frame: keep his face, beard and coat.\nImage 3 (Brass lantern): reference only: the lantern's brass and glass only.\nFraming: opens on the start frame at the door, ends on a medium shot of the keeper beside the lit lamp.\n\nContinuing from the first frame: the keeper steps inside, climbs to the lamp room and lights the great lamp with his brass lantern, warm light floods the room, medium shot",
      "assets": [
        "s1-end",
        "keeper",
        "lantern"
      ],
      "references": [
        {
          "asset": "s1-end",
          "role": "start-frame"
        },
        {
          "asset": "keeper",
          "role": "identity"
        },
        {
          "asset": "lantern",
          "role": "detail",
          "note": "brass and glass only"
        }
      ],
      "qa": [
        "First frame matches the end of shot 1",
        "Lamp ignites with a warm glow",
        "No text or watermarks"
      ],
      "camera": "Medium shot, handheld",
      "dialogue": "One more night.",
      "captions": true
    },
    {
      "id": "s3",
      "title": "Beam across the storm",
      "description": "The beam sweeps across the storm from outside; the title appears.",
      "durationSec": 4,
      "genDurationSec": 6,
      "prompt": "References:\nImage 1 (Cliff and lighthouse): reference only, not a frame: the same lighthouse and cliff; match its look.\nNo image is the start frame. Framing: one static exterior wide shot from first frame to last.\n\nExterior wide shot, static camera: the lighthouse beam sweeps across dark storm clouds and crashing waves, rain starts, dramatic, calm dark sky in the upper half, no text or letters of any kind",
      "assets": [
        "cliff"
      ],
      "qa": [
        "Beam is clearly visible",
        "Same lighthouse as the establishing shot",
        "No text or letters in the picture"
      ],
      "camera": "Static wide shot",
      "layers": [
        {
          "id": "s3-title",
          "type": "text",
          "text": "THE LANTERN KEEPER",
          "startSec": 1,
          "endSec": 4,
          "position": {
            "x": 0.5,
            "y": 0.3
          },
          "textStyle": "keeper-title",
          "anim": {
            "in": "fade",
            "out": "fade",
            "durationSec": 0.8
          }
        }
      ],
      "effects": [
        {
          "preset": "ken-burns",
          "params": {
            "zoom": 0.15
          }
        }
      ]
    }
  ],
  "connections": [
    {
      "from": "s1",
      "to": "s2",
      "kind": "continuity",
      "note": "Shot 2 starts from the last frame of shot 1"
    },
    {
      "from": "s2",
      "to": "s3",
      "kind": "cut",
      "transition": {
        "preset": "crossfade",
        "params": {
          "durationSec": 0.8
        }
      }
    }
  ]
}
```
