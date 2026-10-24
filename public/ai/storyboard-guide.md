# Dionysus storyboard guide (dionysus.storyboard/1, v1.1)

This guide is for AI assistants that plan a video storyboard for the Dionysus video editor (https://ckfun0skf.github.io/dionysus-ai-video-editor/?v2). It is generated from the app's preset registry, so the preset ids below are exactly the ones the importer accepts. Machine-readable presets: https://ckfun0skf.github.io/dionysus-ai-video-editor/ai/presets.json. Full format reference: https://ckfun0skf.github.io/dionysus-ai-video-editor/ai/STORYBOARD_FORMAT.md.

How to use it: the user has agreed a story with you. Turn it into a production storyboard and reply with ONLY one JSON code block in the format below — no commentary before or after. The user pastes your reply into Dionysus (Storyboard → Import JSON), which checks it, then generates or uploads every asset and clip from your prompts.

## HOW IT WORKS
A storyboard is one JSON object with three lists:
- "assets": everything that must exist before the clips can be made: characters, locations, props, a style frame, uploads, and "frame" assets taken from the last frame of a shot for continuity. Each asset has its own self-contained generation prompt, the other assets it is made from ("references") and QA checks.
- "shots": the clips of the final edit in playback order. Each has a clip generation prompt, the assets it uses (attached to the generator as numbered images), its on-screen length ("durationSec") and, optionally, text layers and video effects that the editor draws on top.
- "connections": what happens between two adjacent shots: a plain cut, continuity from the previous shot's last frame, or a transition preset.
The user imports the JSON into Dionysus, which checks it and lists every problem with its path. The app then walks the user through generating (with their own AI tools and your prompts) or uploading each asset and clip, in dependency order. Finally the editor assembles the timeline: shots in order, trimmed to "durationSec", with your text layers, effects and transitions applied.
So split the work: generation prompts describe only the picture and its motion; on-screen text, post camera moves, looks and transitions are done by the editor with presets and stay out of the prompts.

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
      "references"?: (string | { "asset": "<asset id>", "role"?: "start-frame" | "identity" | "look" | "detail", "note"?: string })[],
                                 // other assets to attach when generating this one, IN THIS ORDER (Image 1, Image 2 …); a plain id
                                 // = role from its type; for an image "start-frame" means the base image to edit (no end-frame)
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
      "keyframe"?: { "prompt": string, "references"?: [ "<asset id>" | { "asset", "role"?, "note"? } ], "qa"?: string[] },
                                 // render "ai" only: the opening still to generate FIRST; the clip animates from it (Image 1, start frame)
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
  } ],
  "audio"?: [ {                  // voiceover, music beds and sound effects, placed by shot (assets of type "audio")
      "id"?: string, "asset": "<audio asset id>", "kind": "voiceover" | "music" | "sfx",
      "from": "<shot id>",       // the shot it starts in
      "atSec"?: number,          // seconds into "from" (default 0)
      "to"?: "<shot id>",        // plays to the end of this shot (same as or after "from"); omitted = the audio's own length
      "durationSec"?: number,    // stop after this many seconds (with "to": whichever comes first); audio is never looped
      "volume"?: number,         // 0-1; default music 0.35, voiceover and sfx 1
      "fadeInSec"?: number, "fadeOutSec"?: number   // default music 1 s each, others 0
  } ]
}

Layer (times in seconds from the shot start, 0 <= startSec < endSec <= durationSec; coordinates are 0-1 fractions of the frame from the top-left):
  Text:  { "id": string, "type": "text", "text": string, "startSec": number, "endSec": number,
           "position": { "x", "y" }            // text centre (preferred), OR
           "box": { "x", "y", "width", "height" },   // top-left + size; give exactly one of position / box
           "textStyle"?: "<text style id or meta.textStyles key>",
           "style"?: TextStyle,                // overrides the text style
           "anim"?: { "in"?: "<id>", "out"?: "<id>", "loop"?: "<id>", "durationSec"?: number },
           "follow"?: "frame" | "shot" }      // default "frame" (fixed); "shot" = moves with the shot's zoom/pan effects
  Media: { "id": string, "type": "html" | "image" | "video", "asset": "<asset id>", "startSec": number, "endSec": number,
           "box": { "x", "y", "width", "height" }, "follow"?: "frame" | "shot" }
TextStyle: { "font"?: "<font id>", "size"?: number (fraction of frame height, 0-1), "color"?: "#rrggbb", "align"?: "left" | "center" | "right", "bold"?: boolean,
             "italic"?: boolean, "letterSpacing"?: number (em, -0.2-1), "lineHeight"?: number (0.8-3),
             "strokeWidth"?: number (outline, fraction of font size, 0-0.3), "strokeColor"?: "#rrggbb",
             "shadow"?: { "color", "blur", "x", "y" } | null (fractions of font size), "background"?: { "color", "opacity" } | null,
             "effect"?: "<text effect id>" | "none", "effectColor"?: "#rrggbb" }
Text is one line per "\n" and is never wrapped: keep lines short. Without "size", text uses the style's size (else 0.1), or fits the box height.
```

## CHOOSING PRESETS
Presets are the editor's built-in tools: video effects on a shot, transitions on connections, text styles and text animations on text layers. Each one in the PRESETS section has an id, a one-line description, its params (range, default and unit) and sometimes "Use for" / "Avoid" hints.
- Choose by purpose: match the description and hints to what the moment needs (mood, energy, what the viewer should notice), not the name alone.
- Less is more: most cuts need no transition (omit it). Use one or two transition styles for the whole video and save the energetic ones for beats that call for them. Use at most one or two effects per shot.
- Effects are post-production: use them for camera moves the clip doesn't have, colour or light looks, and fades. When an effect adds the camera move, the generation prompt says "static camera".
- Stay consistent: give recurring text one look (a text style preset or a "meta.textStyles" entry) and the same in/out animation throughout; keep loops for short emphasis.
- Params: omit them to use the defaults and set only what you need, within the listed range and unit. Unknown ids, unknown params and out-of-range values are reported on import.

## PRESETS
Only these ids may be used. Omitted params take their defaults. Within each kind, presets are grouped by [category].

Text styles — shots[].layers[].textStyle (default "plain"):
[Basic]
- plain: Bold white sans-serif with no decoration; the default. Look: font sans, colour #ffffff.
- caption: Smaller bold white text on a translucent black box; subtitles and lower thirds. Look: font sans, colour #ffffff, size 0.06.
- typewriter: Light grey monospace that types itself on. Look: font mono, colour #e8e8e8.
- soft-shadow: Bold white sans-serif with a soft drop shadow; stays readable on bright pictures without a box. Look: font sans, colour #ffffff.
[Bold]
- outline: Yellow Impact letters with a thick black outline; meme or punchy look. Look: font impact, colour #ffe14d.
- pop: Large white Impact title with a hard drop shadow that pops in and shrinks out. Look: font impact, colour #ffffff, size 0.14.
- echo: White Impact letters with pink echo copies that slide up in. Look: font impact, colour #ffffff.
[Light]
- neon: White rounded letters with a pink neon glow and a gentle pulse. Look: font rounded, colour #ffffff.
- glow: Italic white serif with a cyan glow that floats softly. Look: font serif, colour #ffffff.
[Film]
- cinematic: Warm off-white serif, widely letter-spaced, with a soft shadow; film titles and chapter cards. Look: font serif, colour #f5f1e8, size 0.07.

Text effects — shots[].layers[].style.effect and meta.textStyles[].effect, coloured by "effectColor" (default "none"):
[Light]
- glow: Soft coloured glow around the letters. Params: blur 0–1, default 0.35 (Glow radius as a fraction of the font size).
- neon: Bright neon tube look with a strong coloured glow. Params: blur 0–1, default 0.6 (Glow radius as a fraction of the font size).
[Style]
- hollow: Outline-only letters with a transparent fill.
- echo: Repeated offset copies behind the text. Params: offset 0–0.3, default 0.06 (Offset between the copies, as a fraction of the font size).

Text animations in — shots[].layers[].anim.in:
[Basic]
- fade: Fades the text in from transparent.
- slide-up: Fades in while sliding up into place from slightly below. Params: distance 0–0.5, default 0.08 (How far the text travels, as a fraction of the frame size (0.1 = 10%)); dirX -1–1, default 0 (Side the text is offset to while hidden (it slides from / to there): -1 left, 1 right, 0 none); dirY -1–1, default 1 (Side the text is offset to while hidden: -1 above, 1 below, 0 none).
- slide-left: Fades in while sliding left into place from the right. Params: distance 0–0.5, default 0.15 (How far the text travels, as a fraction of the frame size (0.1 = 10%)); dirX -1–1, default 1 (Side the text is offset to while hidden (it slides from / to there): -1 left, 1 right, 0 none); dirY -1–1, default 0 (Side the text is offset to while hidden: -1 above, 1 below, 0 none).
- zoom-in: Grows from nothing to full size.
[Bounce]
- pop: Scales up from small with a springy overshoot; lively titles and labels. Params: overshoot 0–0.5, default 0.12 (Extra size at the middle of the pop, as a fraction of full size (0.12 = 12% larger)).
[Type]
- typewriter: Reveals the text one character at a time.
[Reveal]
- wipe: Reveals the text left to right behind a moving edge.
- blur-in: Fades in from a soft blur to sharp; gentle, cinematic. Params: blur 0–30, default 8 (Blur radius in pixels at the hidden end).

Text animations out — shots[].layers[].anim.out:
[Basic]
- fade: Fades the text out to transparent.
- slide-down: Fades out while sliding down. Params: distance 0–0.5, default 0.08 (How far the text travels, as a fraction of the frame size (0.1 = 10%)); dirX -1–1, default 0 (Side the text is offset to while hidden (it slides from / to there): -1 left, 1 right, 0 none); dirY -1–1, default 1 (Side the text is offset to while hidden: -1 above, 1 below, 0 none).
- shrink: Shrinks to nothing.
[Reveal]
- blur-out: Blurs and fades away. Params: blur 0–30, default 8 (Blur radius in pixels at the hidden end).
- wipe-out: Hides the text right to left behind a moving edge.

Text loops — shots[].layers[].anim.loop:
[Basic]
- pulse: Gently grows and shrinks in a loop. Params: period 0.2–4, default 1 (Length of one cycle in seconds); amount 0–0.3, default 0.06 (Size change at the peak, as a fraction of full size (0.06 = 6%)).
- wiggle: Rocks side to side in a loop; playful. Params: period 0.2–4, default 1 (Length of one cycle in seconds); degrees 0–30, default 4 (Largest rotation each way, in degrees).
- float: Bobs softly up and down in a loop. Params: period 0.2–4, default 1 (Length of one cycle in seconds); amount 0–0.1, default 0.015 (Largest vertical offset, as a fraction of the frame height).
- blink: Blinks on and off in a loop. Params: period 0.2–4, default 1 (Length of one cycle in seconds).

Video effects — shots[].effects[].preset:
[Basic]
- fade-in: Fades the picture in from black at the start of the range. Params: length 0.05–1, default 0.5 (fraction of the effect's time range, not seconds; 0.5 fades in over the first half of the range).
- fade-out: Fades the picture out to black at the end of the range. Params: length 0.05–1, default 0.5 (fraction of the effect's time range, not seconds; 0.5 fades out over the last half of the range).
[Lens]
- blur: Blurs the whole picture. Params: amount 0–1, default 0.5 (Blur strength 0-1; 1 = a blur radius of 2% of the frame height).
- vignette: Darkens the frame edges to focus the centre. Params: amount 0–1, default 0.6 (Edge darkness, 0 (none) to 1 (black corners)).
[Motion]
- ken-burns: Slow zoom and pan across the picture (push-in); brings stills to life. Params: zoom 0–1, default 0.25 (Extra zoom reached at the end of the range, as a fraction of full size (0.25 = 25% larger)); pan -0.3–0.3, default 0.05 (Horizontal drift reached at the end of the range, as a fraction of the frame width (negative = left)).
- shake: Handheld camera shake. Params: amount 0–0.1, default 0.02 (Largest offset, as a fraction of the frame size); speed 2–40, default 16 (Shake oscillations over the whole effect range (a count, not per second)).
[Color]
- bw: Black-and-white (desaturated) picture. Params: amount 0–1, default 1 (Desaturation, 0 (full colour) to 1 (black and white)).
[Light]
- glow: Soft bloom: bright areas bleed a gentle halo of light; dreamy, warm or magical scenes. Params: strength 0–1, default 0.6 (Opacity of the added light, 0 (off) to 1 (full)); radius 0.01–0.2, default 0.05 (Halo size as a fraction of the frame height); threshold 0–1, default 0.5 (Which areas glow, 0 (the whole picture, soft haze) to 1 (only the brightest highlights)); color (color), default "#ffffff" (Colour of the light (#rrggbb); white keeps the picture's own colours). Use for: dream sequences, memories, candle or sunset light, magic moments. Avoid: dark scenes with no highlights (little visible effect). Example params: {"strength":0.5,"radius":0.08}.

Transitions — connections[].transition.preset (params.durationSec, default 0.5):
[Basic]
- crossfade: The outgoing clip dissolves into the incoming clip.
- dip: Fades the outgoing clip to black, then up into the incoming clip.
- dip-white: Fades the outgoing clip to white, then out of white into the incoming clip; dreamy or memory scenes. Params: color (color), default "#ffffff" (Colour the picture dips through (#rrggbb)).
- flash: A quick bright flash hides the cut; punchy, for beats and reveals. Params: color (color), default "#ffffff" (Flash colour (#rrggbb)); strength 0–1, default 0.9 (Opacity of the flash at its peak, 0 (none) to 1 (full)).
[Slide]
- push-left: The incoming clip pushes the outgoing clip out to the left. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-right: The incoming clip pushes the outgoing clip out to the right. Params: dirX -1–1, default 1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-up: The incoming clip pushes the outgoing clip up and out of frame. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default -1 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- push-down: The incoming clip pushes the outgoing clip down and out of frame. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 1 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)); blur 0–0.1, default 0 (Blur at the middle of the move, as a fraction of the frame height).
- whip-left: A fast push to the left with motion blur, like a whip pan. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)); blur 0–0.1, default 0.04 (Blur at the middle of the move, as a fraction of the frame height).
- slide-over: The incoming clip slides in from the right over the outgoing clip, which darkens. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)).
[Wipe]
- wipe-right: A hard edge sweeps left to right, revealing the incoming clip. Params: dirX -1–1, default 1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)).
- wipe-left: A hard edge sweeps right to left, revealing the incoming clip. Params: dirX -1–1, default -1 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 0 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)).
- wipe-down: A hard edge sweeps top to bottom, revealing the incoming clip. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default 1 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)).
- wipe-up: A hard edge sweeps bottom to top, revealing the incoming clip. Params: dirX -1–1, default 0 (Horizontal direction the picture moves: -1 (left), 1 (right) or 0 (none)); dirY -1–1, default -1 (Vertical direction the picture moves: -1 (up), 1 (down) or 0 (none)).
- iris: The incoming clip opens from a growing circle in the centre.
[Zoom]
- zoom-in: Rushes forward: the outgoing clip zooms in and the incoming clip continues the push; energetic. Params: outScale 0.2–3, default 1.8 (Scale the outgoing clip reaches, as a multiplier of full size (1 = unchanged)); inScale 0.2–3, default 0.6 (Scale the incoming clip starts from, as a multiplier of full size (1 = unchanged)); blur 0–0.1, default 0.02 (Peak blur as a fraction of the frame height).
- zoom-out: Pulls back: the outgoing clip shrinks away and the incoming clip settles in from larger. Params: outScale 0.2–3, default 0.5 (Scale the outgoing clip reaches, as a multiplier of full size (1 = unchanged)); inScale 0.2–3, default 1.6 (Scale the incoming clip starts from, as a multiplier of full size (1 = unchanged)); blur 0–0.1, default 0.02 (Peak blur as a fraction of the frame height).
- spin: The outgoing clip spins away and the incoming clip spins into place; playful. Params: degrees 30–720, default 180 (Degrees each clip turns).
[Blur]
- blur-dissolve: Both clips soften into a blur while they cross-dissolve; smooth and gentle. Params: blur 0–0.1, default 0.03 (Peak blur as a fraction of the frame height).
- defocus: The outgoing clip goes out of focus, then the incoming clip pulls into focus. Params: blur 0–0.1, default 0.05 (Peak blur as a fraction of the frame height); cut 0–1, default 1 (Switch mode: 1 (on) swaps the clips at full blur, 0 (off) dissolves them).
[Glitch]
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
17. An asset made from other assets lists them in its "references" in attach order, as objects with a "role" when the use is not obvious from the type. Its prompt then starts with the same numbered "References:" block as a clip prompt; for an image, "start-frame" means the base image to edit (there is no end frame). Example: a close-up of the hero holding a mug: "references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"], prompt "References:\nImage 1 (Blue mug): reference only: materials, colours and objects only; glaze and colour only.\nImage 2 (Hero): reference only: keep this identity (face, body, clothes).\n\nClose-up of …".
18. Keyframe then animate: when the opening composition matters (a character's pose, a precise layout, a hero product shot), give the "ai" shot a "keyframe": { "prompt", "references", "qa" }. The app turns it into an image asset "<shot id>.keyframe" that is made first, then attached to the clip as Image 1, the START FRAME (do not also give the shot a "start-frame" reference). The keyframe prompt describes one still image (with its own "References:" block, as for an asset); the clip prompt then describes only the motion from that frame. Example: "keyframe": { "prompt": "References:\nImage 1 (Hero): reference only: keep this identity (face, body, clothes).\n\nThe hero sits at a café table, both hands around a blue mug …", "references": ["hero", "cafe"], "qa": ["The hero's face matches the reference"] }, clip prompt "References:\nImage 1 (Keyframe · …): START FRAME …\n\nShe slowly lifts the mug …".
19. Audio: put each voiceover, music bed or sound effect in "audio" as a cue on an asset of type "audio" (source "generate" with a prompt for the user's voice/music/sound tool, e.g. the exact voiceover script and voice, or "upload"). "from" is the shot it starts in, "atSec" the offset into that shot, "to" the last shot it plays under. A music bed usually runs "from" the first shot "to" the last with "volume" 0.2-0.4 under speech; a voiceover spans the shots it describes; a sound effect sits at the moment in one shot ("atSec") with no "to". Example: { "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }, { "asset": "door-slam", "kind": "sfx", "from": "s4", "atSec": 1.2 }. Do not put spoken lines that the video model renders (shot "dialogue") into a voiceover too.
20. Layers stay fixed to the frame by default: a shot's video effects (e.g. "ken-burns" zoom and pan) move only the picture, so titles, labels and logos stay put and readable. Give a layer "follow": "shot" only when it belongs to the scene and must move with the picture, e.g. a name tag pinned to a sign or a label on an object while the shot slowly zooms: { "id": "tag", "type": "text", "text": "ROOM 12", "startSec": 0, "endSec": 4, "position": { "x": 0.62, "y": 0.4 }, "follow": "shot" }. It only has an effect when an effect moves or zooms the shot while the layer is on screen.
21. Keep text readable on any picture: give light text an outline ("strokeWidth" about 0.04-0.08 with a dark "strokeColor"), a soft "shadow", or a "background" box (captions, lower thirds). Use "letterSpacing" (in em) for airy titles, "lineHeight" for multi-line cards, "italic" for emphasis, and a text "effect" with "effectColor" only for stylised titles. Sizes and offsets are fractions of the font size; null removes a style's shadow or background. Example: "style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000", "shadow": { "color": "#000000", "blur": 0.3, "x": 0, "y": 0.04 } }. Put a look used on several layers into "meta.textStyles" once.

## EXAMPLE
```json
{
  "format": "dionysus.storyboard/1",
  "meta": {
    "title": "First Light",
    "logline": "A cyclist reaches the hilltop just as the sun rises.",
    "aspect": "16:9",
    "style": "Natural cinematic realism, soft golden-hour light, shallow depth of field",
    "language": "en",
    "textStyles": {
      "title-card": {
        "font": "serif",
        "size": 0.09,
        "color": "#fff6e0"
      }
    }
  },
  "assets": [
    {
      "id": "rider",
      "name": "The rider",
      "type": "character",
      "aspect": "1:1",
      "prompt": "Portrait of a young woman cyclist, short dark hair, red cycling jacket, grey helmet, plain light background, natural cinematic realism",
      "references": [],
      "source": {
        "type": "generate"
      },
      "qa": [
        "Red jacket and grey helmet",
        "Face clearly visible",
        "No logos or text"
      ]
    },
    {
      "id": "hill",
      "name": "Hill road",
      "type": "location",
      "aspect": "16:9",
      "prompt": "Empty winding road up a grassy hill before sunrise, mist in the valley, soft blue-gold sky, natural cinematic realism",
      "references": [],
      "source": {
        "type": "generate"
      },
      "qa": [
        "Road winds up to the hilltop",
        "No people or vehicles"
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
        "Rider is near the hilltop"
      ]
    }
  ],
  "shots": [
    {
      "id": "s1",
      "title": "The climb",
      "description": "She climbs the last stretch of the hill road.",
      "durationSec": 4,
      "prompt": "References:\nImage 1 (The rider): reference only, not a frame: keep her face, red jacket and grey helmet.\nImage 2 (Hill road): reference only, not a frame: the road, hill and sky colours; do not copy its framing.\nNo image is the start frame. Framing: side tracking shot, she rides into frame and ends near the hilltop.\n\nThe cyclist in a red jacket pedals hard up a winding hill road before sunrise, mist below, side tracking shot",
      "assets": [
        "rider",
        "hill"
      ],
      "qa": [
        "Rider matches the portrait",
        "Ends near the hilltop"
      ],
      "camera": "Side tracking shot"
    },
    {
      "id": "s2",
      "title": "The top",
      "description": "She reaches the top and stops.",
      "durationSec": 3,
      "genDurationSec": 5,
      "prompt": "References:\nImage 1 (Last frame of shot 1): START FRAME: the clip opens on exactly this image.\nImage 2 (The rider): reference only, not a frame: keep her face, jacket and helmet.\nFraming: opens on the start frame, ends on a medium shot of her stopping at the top.\n\nContinuing from the first frame: the cyclist reaches the hilltop, stops and looks toward the horizon, breathing hard",
      "assets": [
        "s1-end",
        "rider"
      ],
      "references": [
        {
          "asset": "s1-end",
          "role": "start-frame"
        },
        {
          "asset": "rider",
          "role": "identity"
        }
      ],
      "qa": [
        "First frame matches the end of shot 1",
        "Same jacket and helmet"
      ]
    },
    {
      "id": "s3",
      "title": "Sunrise",
      "description": "The sun rises over the valley; title card.",
      "durationSec": 4,
      "prompt": "References:\nImage 1 (Hill road): reference only, not a frame: the same hill and valley.\nNo image is the start frame. Framing: one static wide shot.\n\nStatic wide shot from behind the cyclist on the hilltop as the sun rises over the misty valley, clear empty sky in the upper third, no text",
      "assets": [
        "hill"
      ],
      "qa": [
        "Sun is rising",
        "Empty sky in the upper third for the title"
      ],
      "camera": "Static wide shot",
      "layers": [
        {
          "id": "s3-title",
          "type": "text",
          "text": "FIRST LIGHT",
          "startSec": 1,
          "endSec": 4,
          "position": {
            "x": 0.5,
            "y": 0.25
          },
          "textStyle": "title-card",
          "anim": {
            "in": "fade",
            "out": "fade",
            "durationSec": 0.6
          }
        }
      ],
      "effects": [
        {
          "preset": "ken-burns",
          "params": {
            "zoom": 0.1
          }
        },
        {
          "preset": "glow",
          "params": {
            "strength": 0.4
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
          "durationSec": 0.6
        }
      }
    }
  ]
}
```
