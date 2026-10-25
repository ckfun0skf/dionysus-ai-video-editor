# `dionysus.storyboard/1` format (v1.1)

This is the source of truth for the storyboard JSON format. The importer is `src/v2/domain/storyJson.ts`; the worked example `src/v2/domain/__fixtures__/ep01_opening.storyboard.json` is imported by the tests. When this document and the code disagree, fix one of them in the same PR.

Implementation status is tracked in `public/doc/tasks.json` (tasks `V2-SB-11x`).

## 1. Overview and compatibility

- The format string stays `"dionysus.storyboard/1"`. v1.1 is additive: **every new field is optional**, and every existing v1 file stays valid with the same meaning.
- Readers ignore unknown fields (the current importer, `src/v2/domain/storyJson.ts`, already does).
- **Caveat for v1.0 importers.** They reject asset `type: "html"` and require a shot `prompt`. A v1.1 file that uses html assets or leaves out a prompt therefore needs a v1.1 importer. Planners should keep a shot `prompt` even where v1.1 makes it optional. The worked example does this and still imports cleanly in today's app.
- Design principles:
  - Look and motion are named by **preset id + params**, never by a closed enum.
  - On-screen text never goes in a generation prompt.
  - Unknown presets degrade gracefully: warn, fall back, and keep the id for re-export.

## 2. Field reference

Notation: `?` = optional. All coordinates are 0-1 fractions of the frame, measured from the top-left. All times are seconds.

### 2.1 Root

| Field | Type | Notes |
|---|---|---|
| `format` | `"dionysus.storyboard/1"` | Unchanged. |
| `meta` | object | §2.2 |
| `assets` | Asset[] | §2.3 |
| `shots` | Shot[] | §2.4. Listed in edit order. |
| `connections?` | Connection[] | §2.6. If omitted, adjacent shots are joined by a cut (or by continuity when a lastFrame link exists). |
| `audio?` | AudioCue[] | §2.8 (V2-SB-125). Voiceover, music beds and sound effects placed by shot. |

### 2.2 `meta`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required. |
| `logline?`, `synopsis?`, `style?`, `language?` | string | Unchanged. |
| `aspect` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:5"` or `"21:9"` | Unchanged. |
| `textStyles?` **(new)** | `{ "<id>": TextStyle }` | One-off text styles for this storyboard. They are imported as project text styles and can be promoted to the registry later. Layers reference them through `textStyle`. Ids must not clash with registry `textStyle` ids; if one does, the local style wins and the importer warns. |

`TextStyle` = `{ font?, size?, color?, align?, bold?, italic?, letterSpacing?, lineHeight?, strokeWidth?, strokeColor?, shadow?, background?, effect?, effectColor? }`, with the same keys as a text layer's `style` (§2.5, including the V2-SB-127 extras). Unknown keys warn and are kept for re-export, but have no effect.

### 2.3 `assets[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | string | Short and stable. |
| `type` | `character`, `location`, `prop`, `style`, `image`, `frame`, `video`, `audio`, **`html` (new)** | |
| `aspect?` | aspect string | Defaults to `meta.aspect`. |
| `prompt` | string | For `html`, this describes the component (see below) and is required when the source is `"generate"`. |
| `references?` | (string \| AssetReference)[] | The assets this one is made from, in attach order. A plain asset id, or **(new, V2-SB-123)** an object with a role (§2.3.1). No self-references and no loops. |
| `source` | `"generate"`, `"upload"` or `{"type": "lastFrame", "shot": "<shot id>"}` | Write `"generate"` and `"upload"` as **plain strings** (V2-SB-131); only a last frame is an object. Omitted = `"generate"`. For compatibility the importer also accepts the object forms of generate and upload (with `"type"` set to `"generate"` or `"upload"`), but the guide, the example and the app never write them. `html` and `audio` assets can't use `lastFrame`. **Future, not v1:** a template source (§6). |
| `qa` | string[] | 2-5 yes/no checks that can be verified by looking. |
| `params?` **(new, V2-HTML-PARAMS)** | `{ "<key>": Param }` | `html` assets only: the values the clip exposes, so one asset is reused with different values (§2.3.2, RULE 24). Ignored, with a warning, on other types. |
| `genDurationSec?` | number, 0.5 to 120 | **(new, V2-SB-133)** `video` assets only: the length to generate when the layers using the asset need less (video models have minimum or fixed lengths). Each video layer picks its part with `inSec` (§2.5); an upload longer than the longest layer using the asset is offered a trim (§4.4). On any other type it warns and is ignored. |

#### 2.3.1 `assets[].references[]` objects (V2-SB-123)

Image models also take reference images next to the prompt and number them ("Image 1", "Image 2"). An asset's `references` fixes that order and, written as objects, says how each image is to be used, so a room sheet used for its drawers is not copied as a whole room.

| Field | Type | Notes |
|---|---|---|
| `asset` | asset id | Must exist; not the asset itself; no loops. |
| `role?` | `"start-frame"`, `"identity"`, `"look"` or `"detail"` | Same meanings as for shots (§2.4.1), except that an image has no end frame: `start-frame` is the **base image** to start from and edit. If omitted, inferred from the referenced asset: `frame` type or a `lastFrame` source → `start-frame` (only the first; a second becomes `detail`), `character` → `identity`, `style` → `look`, everything else → `detail`. |
| `note?` | string | Extra instruction for this image. |

- **Order = numbering.** The first entry is Image 1. Strings and objects can be mixed: `["style", { "asset": "flat", "role": "detail", "note": "the drawers only" }]`.
- **Validation.** Unknown asset id, a self-reference or a loop: error. More than one `start-frame`: error. `"end-frame"`: warning, used as `detail`. Unknown role: warning, used as `detail`. The same asset twice: warning, the repeat is ignored.
- **In the app.** The asset's *Prompt* section shows an **Attach in this order** list (Image 1, Image 2 … with each role and a Save button per image), and *Copy prompt* prepends a numbered `References:` block unless the prompt already has one. *Edit asset → Made from* lets the user set each image's role (Auto = inferred).
- **Prompt.** An asset prompt with references starts with the same kind of block as a clip prompt (RULE 17), for example:

```
References:
Image 1 (Blue mug): reference only: the mug's glaze and colour only; do not copy its product-shot framing.

Portrait of the hero at a café table holding the blue mug, …
```

**`html` assets** are only for animated, 3D or three.js graphics, and for designed title or text-only cards reused with params (§2.3.2).
- The asset is never a file path and never inline HTML. Its `prompt` is a **design brief** for the AI that writes the clip (what it shows, how it moves over its length, colours, type and layout), not code (RULE 23).
- Media the clip uses (logos, photos, footage, music) are listed in its `references`; they become the clip's bound assets.
- Guided flow: the app copies the brief together with the **HTML clip package** instructions (format `dionysus.htmlclip/1`, see [HTML_CLIP_PACKAGE.md](HTML_CLIP_PACKAGE.md), published next to this file), filled in with the asset's size, length, bound assets and allowed libraries. The user pastes the AI's single `.html` reply back (or uploads an `.html` or `.dionysus-html.zip` file) and it becomes a new version. Uploads are versioned like images.
- The app stores the whole HTML document as an asset-version blob. An `html` asset can't use a `lastFrame` source.
- Per-clip config (length, size, background, libraries, bindings, params) lives inside the HTML, in `<script type="application/json" id="dionysus-clip">`; HTML without it still plays (legacy).

#### 2.3.2 `assets[].params`: exposed values (V2-HTML-PARAMS)

An `html` asset may declare the values its clip exposes, so the planner, the clip's AI and the editor agree on them. One asset then serves every use with its own values: a title card, a text-only shot or a lower third is ONE asset, not one per wording (RULE 24).

```json
{ "id": "text-card", "name": "Text card", "type": "html", "prompt": "Animated text card …", "source": "generate", "qa": ["…"],
  "params": {
    "text":       { "type": "text", "default": "Title", "label": "Text" },
    "color":      { "type": "color", "default": "#fff6e0", "label": "Text colour" },
    "size":       { "type": "number", "default": 0.12, "min": 0.04, "max": 0.3, "step": 0.01, "label": "Size" },
    "background": { "type": "select", "options": ["dark", "none"], "default": "dark" },
    "shadow":     { "type": "boolean", "default": true }
  } }
```

- **Param:** `type` is `"text"`, `"number"`, `"color"`, `"boolean"` or `"select"`; `default` is required and must be valid for the type (a number within `min`–`max`, a `#rrggbb` colour, one of a select's non-empty `options`). `label` and `description` are optional strings shown in the editor. Keys start with a letter and use letters, digits, `_`, `-` or `.`. This is the same shape as the HTML clip manifest's `params` ([HTML_CLIP_PACKAGE.md](HTML_CLIP_PACKAGE.md)).
- **Uses:** a `render: "html"` shot (§2.4) and an `html` layer (§2.5) give their own values as `"params": { "<key>": value }`. Omitted keys use the default.
- The **Copy prompt** for the asset lists the declared params and the values the shots and layers use, and tells the clip's AI to declare exactly these params in its manifest and read `ctx.params` in `render()`. When a pasted clip lacks a declared param, or declares it with another type, the check warns (`param-missing`, `param-mismatch`).
- The **clip's manifest is the source of truth at render time:** values are resolved against the params the selected version actually declares (its defaults, overridden by the use's values). A value for a key the clip doesn't declare is kept but not passed to it.

### 2.4 `shots[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `title`, `description?` | string | Unchanged. |
| `durationSec` | number, 0.5-120 | How long the shot stays on screen in the final edit, decided from the story's pacing, not from the video model's limits (RULE 13). Never put the planned length only in `description`. |
| `genDurationSec?` **(new, V2-SB-121)** | number, 0.5-120, >= `durationSec` | Only when the video model must render longer than the shot (a minimum or fixed lengths, e.g. 6/10/15 s): the length to generate. Example: a 4 s beat with a model that renders 6 s minimum: `"durationSec": 4, "genDurationSec": 6`. The uploaded clip is then trimmed to `durationSec` (§4.4). Omitted, or equal to `durationSec`, means "generate `durationSec`". A value outside 0.5-120 or shorter than `durationSec` is ignored with a warning. |
| `prompt` | string | Required when `render` is `"ai"`. Optional for `"html"` and `"still"` (keep it anyway for v1.0 readers). Never asks for text. |
| `assets` | string[] | Asset ids used. Should include `clip`. |
| `camera?`, `dialogue?` | string | Unchanged. |
| `keyframe?` **(new, V2-SB-124)** | object | `ai` shots only: the opening still to make first; the clip animates from it. See §2.4.2. |
| `qa` | string[] | 2-5 visual checks. |
| `render?` **(new)** | `"ai"`, `"html"` or `"still"` | Default `"ai"`. The production to-do uses this to choose the step: generate a clip, upload or refresh the HTML, or use the still. |
| `clip?` **(new)** | asset id | Required when `render` is `"html"` (must point to an `html` asset) or `"still"` (must point to an `image` asset). Ignored for `"ai"`, with a warning. The clip renders from the asset's **selected** version (the one the user picked in the asset's version history), not simply the latest upload. |
| `params?` **(new, V2-HTML-PARAMS)** | `{ "<key>": value }` | `render: "html"` only: this shot's values for the `clip` asset's `params` (§2.3.2), e.g. `{"text": "THE END"}`. Values are strings, numbers or booleans. Ignored, with a warning, for other renders. |
| `layers?` **(new)** | Layer[] | §2.5 |
| `captions?` **(new)** | boolean | When `true`, the shot's `dialogue` is rendered into the shared subtitle text layer. Has no effect, and triggers a warning, if there is no `dialogue`. |
| `effects?` **(new)** | Effect[] | §2.7 |
| `references?` **(new, V2-SB-120)** | Reference[] | §2.4.1. The images to attach to the clip generation, in order, with their roles. |

**Montage (V2-SB-132).** There is no montage field. A montage (a quick run of glimpses) is consecutive short shots, e.g. three shots of `"durationSec": 2`, each with its own prompt, assets and QA, joined by plain cuts (no connection, or a very short transition: a transition eats half its length from each side, §2.6). Use `genDurationSec` when the video model can't render that short, keep the style and references the same across the run, and tie it together with one `audio` cue that runs `from` the first montage shot `to` the last (§2.8). RULE 13 says the same to planners.

#### 2.4.1 `shots[].references[]` (V2-SB-120)

Video models take a few images next to the prompt and refer to them by position ("Image 1", "Image 2"). `references` fixes that numbering and says how each image is to be used, so a location sheet is not mistaken for the opening frame.

| Field | Type | Notes |
|---|---|---|
| `asset` | asset id | Must exist. If it is not in the shot's `assets`, the importer adds it there (so it counts as an input of the shot). |
| `role` | `"start-frame"`, `"end-frame"`, `"identity"`, `"look"` or `"detail"` | `start-frame`: the clip opens on exactly this image. `end-frame`: the clip ends on it. `identity`: keep this character's identity. `look`: overall look only. `detail`: materials, colours and objects only; do not reproduce its framing. If omitted, inferred from the asset type (below). |
| `note?` | string | Extra instruction for this image, e.g. `"materials and colours only, do not show the wide view"`. |

- **Order = numbering.** The first entry is Image 1.
- **Fallback.** Without `references`, the images are the shot's `assets` in order (minus the `clip` asset and media-layer assets), with the role inferred from the asset: `frame` type or a `lastFrame` source → `start-frame` (only the first one; a second becomes `detail`), `character` → `identity`, `style` → `look`, everything else (`location`, `prop`, `image` …) → `detail`. Assets in `assets` that `references` does not list are appended after it the same way.
- **Validation.** Unknown asset id: error. More than one `start-frame` or more than one `end-frame`: error. Unknown role: warning, used as `detail`. The same asset twice: warning, the repeat is ignored.
- **Prompt.** Every clip prompt starts with a `References:` block (RULE 14) that matches this order, for example:

```
References:
Image 1 (Last frame of shot 1): START FRAME: the clip opens on exactly this image.
Image 2 (Mara's flat): reference only, not a frame: materials and colours only; do not show the wide view.
Image 3 (Series look): reference only, not a frame: overall look only.
Framing: opens on the start frame at the door, ends on a close-up of Mara at the window.
```

- **In the app.** The shot details and the production step show **Attach in this order** next to *Copy prompt*: Image 1, Image 2 … with a thumbnail of the version the shot uses (a pinned version when the shot pins one, §4.2), the role, and *Save* (the share sheet on phones, so *Save Image* / *Save to Files* work on iPhone; a download on desktop). *Copy prompt* prepends a `References:` block generated from the roles when the prompt has no line starting with `References:`, so the copied prompt is right even when the planner forgot the block. Editing a shot's assets keeps the roles of the ones that stay; removing or deleting an asset drops its reference.

#### 2.4.2 `shots[].keyframe` (V2-SB-124)

**Keyframe then animate.** An `ai` shot can ask for its opening still to be made first, with its own prompt, references and versions; the clip is then generated from that still.

```json
"keyframe": {
  "prompt": "References:\nImage 1 (Hero): reference only: keep this identity (face, body, clothes).\n\nThe hero at a café table, both hands around a blue mug …",
  "references": ["hero", { "asset": "cafe", "role": "look" }],
  "qa": ["The hero's face matches the reference"]
}
```

| Field | Type | Notes |
|---|---|---|
| `prompt` | string | Required. One still image (the first frame of the clip). Like an asset prompt, it starts with a `References:` block when `references` is set. |
| `references?` | (asset id \| object)[] | The images to attach when generating the keyframe, in order, exactly as `assets[].references` (§2.3.1). Omitted = none. |
| `qa?` | string[] | Checks for the still. |

- **On import** the keyframe becomes an asset slot with id `<shot id>.keyframe` (type `frame`, the project aspect, `source: generate`, name `Keyframe · <shot title>`). It is added first to the shot's assets and is always **Image 1, the start frame** of the clip. A `start-frame` in the shot's `references` is turned into `detail` with a warning, and an inferred start frame (a `frame` asset) becomes `detail`.
- **Image numbering with a keyframe (V2-SB-131).** The clip's attach list (*Attach in this order*, and the `References:` block that *Copy prompt* generates) is built by `attachList` in `src/v2/domain/storyRefs.ts`:
  1. **Image 1** is always the keyframe (`Keyframe · <shot title>`), role `start-frame`.
  2. **Image 2, 3 …** are the shot's `references` in their order (a `start-frame` there is used as `detail`).
  3. Then the shot's other `assets`, in `assets` order (minus the `clip` asset and media-layer assets), with inferred roles; an inferred start frame (a `frame` asset or a `lastFrame` source) becomes `detail`. An explicit `end-frame` stays the end frame.

  So the numbering is the one the shot would have without a keyframe, shifted by one. The keyframe's own `references` are numbered separately (from Image 1) in the keyframe prompt and are attached to the clip only if they are also in the shot's `assets` or `references`. *Copy prompt* adds the generated block only when the clip prompt has no `References:` line, so a planner-written block must use this numbering. Example: a shot "Morning coffee" with `"assets": ["hero", "cafe"]` and a keyframe gets `Image 1 (Keyframe · Morning coffee): START FRAME …`, `Image 2 (Hero): … keep this identity …`, `Image 3 (Café): … materials, colours and objects only …`.
- **Production order:** the keyframe step comes after the assets it is made from and right before its shot. A new keyframe version makes the clip's versions stale (the shot's inputs include it).
- **Errors:** a missing `prompt`, an unknown reference, or an asset whose id is `<shot id>.keyframe`. A reference that is a last-frame asset of the same shot (or that would create a loop) is an error, as for `assets`. **Warnings:** a keyframe on an `html` or `still` shot (ignored).
- **On the board:** an AI shot's details show its keyframe (or *Add keyframe*, which creates one from the shot's current references). The keyframe's details say which shot it opens. Deleting the keyframe asset makes the shot a plain AI shot again; deleting the shot keeps the asset as an ordinary frame. Duplicating a shot keeps the keyframe as a plain reference of the copy.

### 2.5 `shots[].layers[]`

Layers are drawn in list order: later layers sit on top. There is no `zIndex`. `startSec` and `endSec` are relative to the shot start, with `0 <= startSec < endSec <= durationSec`.

**Text layer**

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the shot. |
| `type` | `"text"` | |
| `text` | string | |
| `startSec`, `endSec` | number | |
| `position` **or** `box` | `{x,y}` or `{x,y,width,height}` | `position` (preferred) gives the text centre. `box` gives the top-left corner plus size. Give exactly one. See "Text sizing" below. |
| `textStyle?` | preset id | A registry `textStyle` id or a `meta.textStyles` key. Default `plain`. |
| `style?` | `{font?, size?, color?, align?, bold?, …extras}` | `font` is a curated font id (§3.2). `size` is a fraction of frame height. `color` is a CSS hex value. `align` is `left`, `center` or `right`. `bold` is a boolean; a numeric weight of 600 or more is accepted and mapped to bold. Extras (V2-SB-127): see "Text style extras" below. |
| `anim?` | `{in?, out?, loop?, durationSec?}` | Ids of the `textAnimIn`, `textAnimOut` and `textAnimLoop` kinds. `durationSec` applies to in and out. |
| `follow?` | `"frame"` \| `"shot"` | V2-SB-126. Default `"frame"`: the layer stays fixed to the frame. `"shot"`: it moves with the shot's zoom and pan (see "Fixed or following layers" below). |
| `blend?`, `opacity?` | blend id, number 0 to 1 | V2-SB-128. How the layer mixes with what is under it (default `normal`), and its opacity (default 1). See "Blend modes and overlays" below. |

Style resolution: the `textStyle` preset is applied first, then the inline `style` overrides it.

**Text style extras (V2-SB-127).** The same fields as `textStyle` preset `data` and the text panel, so a storyboard can describe any look the editor can make. Lengths are fractions of the **font size**, so a look scales with the text.

| Field | Type | Notes |
|---|---|---|
| `italic?` | boolean | |
| `letterSpacing?` | number, −0.2 to 1 | Extra space between letters, in em (0.3 = airy title). Browsers without canvas letter spacing (older Safari) draw normal spacing. |
| `lineHeight?` | number, 0.8 to 3 | Line height multiplier for multi-line text (default 1.25; box-fitted text uses 1.2). |
| `strokeWidth?`, `strokeColor?` | number 0 to 0.3, hex | Outline around the letters. 0.04–0.08 with a dark colour keeps light text readable. |
| `shadow?` | `{color?, blur?, x?, y?}` or `null` | Drop shadow. `blur` 0–1, `x`/`y` −1 to 1. Missing fields default to `{ "color": "#000000", "blur": 0.15, "x": 0.03, "y": 0.03 }`. `null` removes the text style's shadow. |
| `background?` | `{color?, opacity?}` or `null` | Box behind the text. `opacity` 0–1. Missing fields default to `{ "color": "#000000", "opacity": 0.6 }`. `null` removes the text style's box. |
| `effect?`, `effectColor?` | text effect id or `"none"`, hex | A registry `effect` (`glow`, `neon`, `hollow`, `echo`), drawn in `effectColor`. `id@N` is accepted; the version is dropped. |

Example: `"style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000", "shadow": { "color": "#000000", "blur": 0.3, "x": 0, "y": 0.04 } }`.

**Text sizing.** Text is a single line per `\n`-separated line; it is **never wrapped**.
- With `position`, the text is centred on the point. Its size is `style.size`, else the `textStyle` size, else 0.1 of the frame height.
- With `box`, the text is centred in the box. Its size is `style.size` when given; otherwise it is fitted to the box height (`height / (lines × 1.2)`). The box width does not shrink the text.
- The importer estimates the rendered width from the font's average character width and warns on `<layer>.text` when the text is likely wider than the box (or the frame, for `position`). Use `position`, shorter text or a smaller `size` to fix it.

**HTML layer:** `{id, type:"html", asset:<html asset id>, startSec, endSec, box, follow?, blend?, opacity?, params?}`. `params` (V2-HTML-PARAMS) is this layer's values for the asset's `params` (§2.3.2), e.g. `{"text": "5:58 AM", "background": "none"}`; `params` on an image, video or text layer is ignored with a warning.

**Image / video layer:** `{id, type:"image"|"video", asset:<asset id>, startSec, endSec, box, follow?, blend?, opacity?, inSec?}`. These land in the overlay group above the shot.

**In point of a video layer (V2-SB-133).** `inSec` (video layers only, seconds, 0 or more) is where in the asset's clip the layer starts; the layer still lasts `endSec - startSec`. Omitted, the layer starts where the selected version's trim starts (picked on upload, §4.4), else at 0. This lets a short layer use the best part of a longer generated clip, and several layers use different parts of one clip.
- Example, a 2 s screen-blend overlay cut from a 6 s clip: asset `{ "id": "dust-leak", "type": "video", "genDurationSec": 6, … }` and layer `{ "id": "s3-dust", "type": "video", "asset": "dust-leak", "startSec": 0, "endSec": 2, "inSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen" }`.
- On Send to timeline the clip's source in point is `inSec`. When `inSec` plus the layer length runs past the uploaded clip's end, the clip starts earlier so it keeps its length (or the whole clip is used when it is shorter than the layer).
- The in point can be changed later on the timeline: select the clip, then **Speed → In point** in the desktop inspector or the **In point** tool on a phone (slider, a seconds field and ±0.1 s steps; the clip keeps its length and position).
- `inSec` on an html or image layer, or a negative or non-numeric value, warns and is ignored. `inSec` plus the layer length past the asset's `genDurationSec` warns.

**Fixed or following layers (V2-SB-126).** Video effects (`shots[].effects`, e.g. `ken-burns`) move, zoom and colour only the shot's own picture; every layer is drawn on top of the result, so by default text and overlays stay **fixed to the frame**, whatever the effect order. A layer with `follow: "shot"` instead moves with the picture: on Send to timeline the zoom (`scale`) and pan (`dx`, `dy`) of the shot's effects over the layer's time range are baked into the placement's x, y and scale keyframes (linear keys sampled every 0.25 s and at effect boundaries; a point at offset (x, y) from the frame centre goes to (dx + scale·x, dy + scale·y) and its size is multiplied by scale). Look-only effects (colour, blur, vignette) are not followed. The keyframes are ordinary keyframes: the user can edit or clear them in the inspector, and they do not update if the effect is changed later.
- `"frame"` is the default and is not stored. Any other value warns and is ignored.
- `follow: "shot"` on a layer during which no effect moves or zooms the shot warns ("stays put").

**Blend modes and overlays (V2-SB-128).** Any layer may set `blend`, a registry `blend` id (`id@N` is accepted; the version is dropped), and `opacity`, 0 (invisible) to 1 (solid, the default). The layer is drawn with the matching canvas composite operation over everything under it (the shot and earlier layers), the same way in preview and export. On Send to timeline, `blend` becomes the clip's blend mode and `opacity` its transform opacity; both can be changed in the inspector (Adjust / Transform → Blend, Opacity).

| Id | Operation | Use |
|---|---|---|
| `normal` | source-over | Covers what is under it (default; not stored). |
| `screen` | screen | Black disappears, light areas brighten: light leaks, flares, dust, glow shot on black. |
| `add` | lighter | Linear dodge, stronger than `screen`: fire, sparks, lens flares. |
| `lighten` | lighten | Keeps the lighter pixel: light graphics on a dark background. |
| `multiply` | multiply | White disappears, dark areas darken: paper, ink, scribbles, shadows on white. |
| `darken` | darken | Keeps the darker pixel: dark graphics on a white background. |
| `overlay` | overlay | Mid grey disappears, contrast goes up: film grain and textures on grey. |
| `soft-light` | soft-light | A gentler overlay: subtle grain, haze, tints. |

- An unknown `blend` id warns and draws normally; the id is kept for re-export. `opacity` outside 0–1 warns and is ignored.
- Example overlay: `{ "id": "leak", "type": "video", "asset": "light-leak", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen", "opacity": 0.7 }`.

**Not in v1:** `trackMotion`. If present, the importer warns and ignores it; it does not reject the file.

### 2.6 `connections[]`

| Field | Type | Notes |
|---|---|---|
| `from`, `to` | shot id | |
| `kind` | `"cut"`, `"continuity"` or `"match"` | Unchanged. `continuity` defaults to a cut. |
| `note?` | string | |
| `transition?` **(new)** | `{preset:<transition id>, params?:{durationSec?, ...}}` | If missing, the connection is a cut. It is stored on the `to` shot's clip as `transitionIn`. It only applies when `from` and `to` are adjacent (consecutive in `shots` order, which is the main-track order); otherwise the importer warns and treats the connection as a cut. `params.durationSec` defaults to **0.5 s** and is clamped to half the shorter of the two clips. Any other `params` are the preset's own (see its descriptor in `/ai/presets.json`, e.g. `light-leak`'s `color` and `strength`); they are kept on the clip and stay editable in the editor (V2-SB-130). |

### 2.7 `shots[].effects[]`

| Field | Type | Notes |
|---|---|---|
| `preset` | videoEffect id | |
| `params?` | object | Keys come from the preset's ParamSpec. Missing keys take their defaults. |
| `startSec?`, `endSec?` | number | Relative to the shot. Default is the whole shot. |

Post camera moves (push-in through `ken-burns`, `shake`) and looks (`bw`, `vignette`) go here, not in the generation prompt.

`fade-in` / `fade-out` `params.length` is a **fraction (0.05–1) of the effect's time range**, not seconds: on a 4 s shot with no `startSec`/`endSec`, `{"length": 0.25}` fades over the first (or last) 1 s. For a fade of N seconds, set `startSec`/`endSec` to an N-second range and keep `length: 1`, or use `length = N / range`.

### 2.8 `audio[]` (V2-SB-125)

Audio cues place an asset of type `audio` in story time: a voiceover across the shots it describes, a music bed under a whole sequence, or a sound effect at a moment in one shot. The audio file itself is an ordinary asset. Give it `source: "generate"` with a prompt for the user's voice, music or sound tool (for a voiceover, the exact script and the voice), or `source: "upload"`. Audio assets can't use `lastFrame`.

```json
"audio": [
  { "id": "bed", "asset": "score", "kind": "music", "from": "s01", "to": "s06", "volume": 0.3, "fadeOutSec": 2 },
  { "asset": "vo-intro", "kind": "voiceover", "from": "s01", "atSec": 0.5, "to": "s03" },
  { "asset": "door", "kind": "sfx", "from": "s06", "atSec": 3.2 }
]
```

| Field | Type | Notes |
|---|---|---|
| `id?` | string | Default `audio<N>` (its position, from 1). Must be unique. |
| `asset` | asset id | Required. Must be an asset with `type: "audio"`. |
| `kind` | `"voiceover"`, `"music"` or `"sfx"` | Required. Sets the defaults and the timeline layer (Voiceover, Music, Sound effects). |
| `from` | shot id | Required. The shot the cue starts in. |
| `atSec?` | number ≥ 0 | Seconds into `from`. Default 0. |
| `to?` | shot id | The last shot the cue plays under: it ends at the end of that shot. It must be `from` or a later shot. Omitted: the audio's own length. |
| `durationSec?` | number > 0 | Stop after this many seconds. With `to`, whichever comes first. |
| `volume?` | 0–1 | Default: music 0.35, voiceover and sfx 1. |
| `fadeInSec?`, `fadeOutSec?` | number ≥ 0 | Default: music 1 s each, others 0. Clamped to the cue's length. |

**Import.** These are errors:

- an unknown asset or shot;
- an asset that is not `audio`;
- a missing or unknown `kind`;
- `to` before `from`;
- a duplicate id.

These are warnings, and the value is ignored:

- a negative `atSec`;
- a `durationSec` of 0 or less;
- a negative fade;
- a `volume` outside 0–1.

Two more cases only warn: `atSec` at or past the end of `from`, and a cue with both `to` and `durationSec`. Audio cues count as uses of their asset, so the "isn't used by any shot" warning does not fire.

**Board.** A shot's details list the cues that play under it, under **Audio**. Each row gives the kind, the asset (tap it to open it), the shots, the volume and the fades. An audio asset's details list its cues. Audio assets have their own production step and an upload button that accepts audio files.

**Send to timeline.** A cue is placed when its `from` shot is sent:

- **Start and end.** It starts `atSec` into that shot's clip. It ends at the earliest of: the end of the `to` shot's clip (when that clip is sent in the same batch), `atSec + durationSec`, and the end of the audio. Audio is never looped.
- **Layers, volume and fades.** Each kind goes on its own audio layer: Voiceover, Music or Sound effects. A new layer is added when the existing one is busy. Volume and fades are set on the clip, and you can change them on the timeline.
- **Linking.** A cue that fits inside its first shot (typically a sound effect) is linked to that shot's clip, so it follows a version swap like other linked items. A cue across shots is placed and not linked.
- **Skipped cues.** A cue whose asset has no version yet is skipped and counted. Send again after uploading it.

**Board edits.**

- *Deleting a shot:* a cue that started in it moves to the next shot it covered, or is removed when it covered no other shot. A cue that ended in it now ends with the shot before.
- *Deleting the audio asset:* its cues are removed.

## 3. Preset system

### 3.1 Rules

- Every look or motion is referenced by **preset id + params**. The schema only checks that the id is a string; the app validates it against its preset registry at import.
- Registry descriptor: `{id, kind, version, description, category, name, type, params: ParamSpec[], preview, data?}`. `ParamSpec` is `number` (min/max/step/default), `color` or `string`, with an optional `description` that states the unit or what the value is a fraction of (shown as the editor tooltip and in the generated guide and presets.json; ambiguous params must have one). `version` starts at 1 and is bumped whenever a preset's look or behaviour changes. `description` is one line, used in the planner guide. `data` holds the text clip fields of a `textStyle` preset (with `font` as a font id).
- Preset ids match `^[A-Za-z0-9][A-Za-z0-9_.-]*$`; `@` is reserved for version pins.
- Kinds: `textAnimIn`, `textAnimOut`, `textAnimLoop`, `effect` (text styling: glow, neon, hollow, echo), `videoEffect`, `transition`, `sticker`, and the new `textStyle` (moving out of `TEXT_TEMPLATES`).
- **Version pinning:** `id@N` (for example `ken-burns@2`) is accepted and stored as written. It always resolves to the **current** preset; old render functions are not kept. If `N` differs from the current version, the importer warns.

### 3.2 Registry snapshot (2026-10-24)

This is a snapshot only. **The live list always comes from the registry**, and the planner prompt is generated from it.

| Kind | Ids |
|---|---|
| textAnimIn | `fade`, `slide-up`, `slide-left`, `pop`, `zoom-in`, `typewriter`, `wipe`, `blur-in` |
| textAnimOut | `fade`, `slide-down`, `shrink`, `blur-out`, `wipe-out` |
| textAnimLoop | `pulse`, `wiggle`, `float`, `blink` |
| videoEffect | `fade-in`, `fade-out`, `blur`, `ken-burns` (slow zoom / push-in), `shake`, `vignette`, `bw` |
| transition | `crossfade`, `dip` (dip to black) |
| textStyle | `plain`, `caption`, `outline`, `neon`, `pop`, `typewriter`, `glow`, `echo`, `soft-shadow`, `cinematic` |
| effect (text styling) | `glow`, `neon`, `hollow`, `echo`; used in `style.effect` (V2-SB-127) |
| blend | `normal`, `screen`, `add`, `lighten`, `multiply`, `darken`, `overlay`, `soft-light`; used in `layers[].blend` (V2-SB-128) |
| fonts (curated ids, not presets) | `sans`, `serif`, `mono`, `impact`, `rounded`, `hand`, `script`, `condensed`. No web fonts. |

Planned as future registry entries, with no schema change needed: `grain`, `colour-grade`, `dip-to-white`, and wipe transitions.

## 4. Importer behaviour

**Warnings and fallbacks.** These never reject the file.

| Situation | Behaviour |
|---|---|
| Unknown or removed preset id | Warn and fall back: transition → cut, textStyle → `plain`, textAnim or effect → none. **The original id is kept** for re-export. |
| `id@N` that differs from the current version | Warn and use the current version. Keep `id@N`. |
| A `meta.textStyles` id that is also a registry `textStyle` id | Warn; the storyboard's own style wins. |
| Invalid `style` values (`size` outside (0, 1], non-hex `color`, unknown `align`, non-boolean `bold`) | Warn and drop that value. |
| `params` (V2-HTML-PARAMS) on a non-html asset, a non-html layer or a shot whose `render` isn't `"html"`; a key the asset doesn't declare; a number outside the declared `min`–`max` | Warn. The misplaced `params` and the unknown key are dropped; the number is clamped. Without declared asset `params`, values are kept as written. |
| Invalid style extras (V2-SB-127): non-boolean `italic`; `letterSpacing`, `lineHeight` or `strokeWidth` out of range; non-hex `strokeColor` or `effectColor`; malformed `shadow` or `background`; unknown `effect` | Warn and drop that value. |
| Unknown `style` / `meta.textStyles` field | Warn; the field is kept for re-export but has no effect. |
| Unknown param key, wrong param type, number outside the ParamSpec range | Warn; unknown keys are ignored, wrong types use the default, out-of-range numbers are clamped. |
| Transition `durationSec` <= 0 | Warn and use the 0.5 s default. |
| `genDurationSec` outside 0.5-120 or shorter than `durationSec` | Warn and ignore it. |
| Asset `genDurationSec` on a non-video asset, or outside 0.5-120 (V2-SB-133) | Warn and ignore it. |
| Layer `inSec` on a non-video layer, or negative (V2-SB-133) | Warn and ignore it. `inSec` + the layer length past the asset's `genDurationSec` warns (the clip starts earlier on Send). |
| A malformed `transition` (not `{preset}`) | Warn and use a cut. |
| Text likely wider than its box or the frame | Warn (see "Text sizing" in §2.5). |
| `position` outside 0-1, or a `box` reaching outside the frame | Warn. |
| `anim` in + out longer than the layer | Warn. |
| `transition` between shots that are not adjacent on the main track | Warn and use a cut. Keep the transition on export. |
| `trackMotion` on a layer | Warn and ignore. |
| Unknown `blend` id, or `opacity` outside 0–1 (V2-SB-128) | Warn; draw normally / ignore the opacity. The blend id is kept for export. |
| `follow` other than `"frame"` or `"shot"`, or `"shot"` with nothing moving the shot during the layer | Warn and ignore (§2.5). |
| `captions: true` without `dialogue` | Warn and do nothing. Non-boolean `captions` also warns. |
| `clip` on a `render: "ai"` shot | Warn and ignore. |
| Unknown font id | Warn and use `sans`. |
| Unknown `references[].role`, or the same asset twice in `references` | Warn; the role is used as `detail`, the repeat is ignored. |
| `"end-frame"` in an asset's `references` (V2-SB-123) | Warn; used as `detail` (an image has no end frame). |

**Errors.** The import is rejected for:
- an unknown asset id in `clip`, a layer `asset`, `assets` or `references`;
- more than one `start-frame` or more than one `end-frame` in a shot's `references`, or more than one `start-frame` in an asset's `references`;
- a `clip` of the wrong asset type for its `render`;
- `render: "html"` or `"still"` without `clip`;
- a layer with both `position` and `box`, or with neither (except for `html`, `image` and `video` layers, which require `box` and reject `position`);
- a `box` with a width or height <= 0;
- `endSec <= startSec`, `endSec > durationSec`, a negative `startSec`, or a layer without `startSec`/`endSec`;
- duplicate layer ids within a shot;
- an unknown `render` or layer `type`, a layer `asset` of the wrong type, a text layer without `text`, or an effect without `preset`;
- an `html` asset with a `lastFrame` source, or a generated `html` asset without a `prompt`;
- (V2-HTML-PARAMS) an invalid asset `params` declaration (bad key, unknown `type`, a missing or invalid `default`, `min` > `max`, empty select `options`), a shot or layer `params` that isn't an object, a value that isn't a string, number or boolean, or a value of the wrong type for its declared param (a select value not in `options`, a colour that isn't `#rrggbb`).

Every error and warning carries a JSON path (for example `shots[2].layers[0].endSec`) that the import screen highlights in the pasted text.

**Mapping notes**

- **Placement:** `box` and `position` map to the layer clip's Transform. Positions are fractions times the frame size. A text `box` maps to the box centre (the text is centred there, sized as in §2.5); a `position` is the centre itself. Media layers fill their `box`.
- **Transitions:** a connection's transition becomes `transitionIn` on the incoming (`to`) clip, only when the two clips are adjacent on the main track. `params.durationSec` (default 0.5 s) is clamped to half the shorter clip. An unknown transition id is a plain cut.
- **Effects:** each shot effect becomes an effect-layer clip over the shot's time range (or its sub-range), linked to the shot's clip.
- **Linked layers:** text layers become text clips in the Text & Stickers group; html, image and video layers become clips in the overlay group, using the selected version of their asset (a layer whose asset has no upload yet is skipped). They are linked to the shot's clip and follow it when its version changes (the same mechanism as storyboard send-to-timeline linked clips). Copies of a linked clip are ordinary clips. An unknown text animation or effect id is dropped (none).
- **Version swaps:** when the shot's clip is swapped to another version with a different length, linked layers and effects are **clamped** to the clip's new length (ranges are trimmed; ones that would start after the end are shortened to the end), never dropped.
- **Captions:** `captions: true` writes `dialogue` into the shared subtitle text layer for the shot's range (a "Subtitles" layer is created when the project has none).
- **Text styles:** `meta.textStyles` entries are resolved before layers: a text layer's `textStyle` names a `meta.textStyles` key first, then a registry preset, else `plain`; its inline `style` is applied on top.
- **HTML and still clips:** a `render: "html"` or `"still"` shot's clip is rendered from the **selected** version of the `clip` asset (see §2.4) for the shot's `durationSec`. The shot shares that asset's versions: its production step waits until the asset has one, and uploading to the shot adds a version to the asset.
- **Param values (V2-HTML-PARAMS):** a `render: "html"` shot's `params` and an html layer's `params` become the timeline clip's own param values (`htmlParams`, overrides of the clip's defaults). They survive version swaps and can be changed per clip in the inspector (**Params**).

### 4.1 Editing on the board (V2-CUT-02)

After import, shots can be added, edited, duplicated, deleted and reordered on the board. Each change is one undo step.

- **Reorder:** drag a card (desktop: drag or the grip; phones: long-press, then drag), use Move up/down, or press Alt+↑/↓. A connection is kept when its two shots stop being adjacent, but its transition, kind and note are ignored until they are next to each other again (the same rule as the importer). The board says which links were affected. Clips already on the timeline keep their place.
- **Edit:** title, length, how the clip is made (AI video, HTML or still, with the asset to use), clip prompt, description, camera, dialogue, captions, checks, and removing layers or effects. Shortening a shot clamps layers and effects that run past the new end. Switching an AI shot to HTML or still keeps its AI versions; switching back restores them.
- **Duplicate:** inserted after the original with the same plan and no clip versions. HTML and still copies share the original's asset.
- **Delete:** the shot's versions stay in the media library and its clips stay on the timeline. Assets taken from its last frame become uploads (their versions are kept). Its connections are removed.
- **Connections:** tap the line between two adjacent shots to set the kind, transition (preset and length) and note.
- **Timeline links:** clips sent from a shot record the shot id, so duplicated HTML or still shots, which share an asset, are each tracked as placed.

### 4.2 Per-shot references (V2-CUT-05)

A shot's **references** are the assets in its `assets` list plus the assets of its image, video and HTML layers. The clip asset of an HTML or still shot is not a reference: it *is* the clip, so it always follows the version in use.

- **Pins (`refOverrides`):** a shot can pin a reference to one version (`Shot.refOverrides`: slot id → version id, app state only, not part of the import format). Other shots keep following the asset's version in use. A pin to a version that no longer exists, or on the clip asset, is ignored.
- **What a pin changes:** the shot's inputs record the pinned version when a clip version is added; staleness compares against the pin ("made with a different version of “X” than the one pinned for this shot"), and the transitive "may not match" from an asset only applies while the shot follows it. Linked layer clips on the timeline (`storyLink.anchor` is the shot's clip) use the pinned version and are skipped when another version of the asset is picked. Send places layers with the pinned version.
- **UI:** the shot details list each reference with the version it uses and a native picker ("Follow asset (vN)" or "Pin vK"). Pinned chips on the board show the pin. Each pin change is one undo step and the note says how many timeline layers changed.
- **Editing references:** Edit shot has a *Reference assets* list: remove, add an existing asset, or create a new one (name, type, prompt). Saving the shot and creating the new assets is one undo step. Removing a reference drops its pin.
- **Editing assets:** an asset's details have Edit (name, type, aspect, generate/upload, prompt, *Made from* without cycles, checks, notes) and the board has *Add asset*. Once an asset has versions its type can only change within the same media kind, and the clip asset of a shot keeps its type. Renaming also renames the media-library asset when it still has the old name. Deleting removes the asset from shots, pins and other assets' *Made from*, keeps its versions in the media library, and is blocked (with the reason) while it is a shot's clip or layer.

### 4.3 Production step order (V2-CUT-07)

The production to-do lists every asset and shot once, in a **suggested order**: each asset comes before the shots that use it (including the assets of a shot's media layers and the clip asset of an HTML or still shot), an asset comes after the assets it is made from (`references`), and a last-frame asset comes right after its source shot.

- **Your order (`stepOrder`):** steps can be reordered. The chosen order is kept as `Storyboard.stepOrder` (step keys `slot:<id>` and `shot:<id>`, app state only, not part of the import format) and is always applied as a stable topological sort, so a step never comes before something it needs, even after shots or references change. Steps that are not in the saved order (a new shot or asset) take their place next to their suggested neighbour; keys of deleted shots or assets are ignored.
- **Moves:** a move that would put a step above something it needs, or below something made from it, stops right next to that step, and the note says which one. Each move is one undo step. *Reset order* goes back to the suggested order (also one undo step).
- **UI:** on a phone, long-press a step and drag it, or let go without moving for a sheet with *Move up*, *Move down*, *Do this as early as possible*, *Do this as late as possible* and *Reset to suggested order*. On a desktop, drag a step (or its grip), use Alt+↑/↓, or right-click (or Shift+F10) for the same menu.
- The order only affects the production list. It does not change the shot order, the timeline, or Send.

### 4.4 Trim on upload (V2-SB-121)

AI video models often render fixed lengths (5, 8 or 10 s), so an uploaded shot clip can be longer than the shot.

- **Choice on upload:** when a video uploaded to an `ai` shot is more than 0.5 s longer than `durationSec`, the app asks before adding it:
  - **Trim to N s** (N = `durationSec`): a filmstrip of the clip with a fixed N-second window, starting centred. Drag the window, tap the strip, or use the slider (arrow keys on a desktop); the preview plays just the window.
  - **Keep full M s:** the whole clip is used and the shot's `durationSec` becomes M.
  - Cancel discards the upload. Either choice is one undo step (the upload and the length change together).
- **Stored per version:** the trim is app state on the version (`Storyboard.versions[id].trim = { inTicks, outTicks }`, source ticks), not part of the import format. A trim covering the whole clip is not stored.
- **Where it applies:** *Send to timeline* places the clip with `sourceIn` and length from the trim. Version swaps follow each version's trim: a timeline clip that still shows the previous version's range (its whole clip or its trim) takes the new version's range, and later clips on the main track ripple (V2-SB-R01). Clips trimmed by hand on the timeline keep their trim. The length warning (clip vs `durationSec`, ±0.5 s) uses the trimmed length, and *Use last frame* takes the frame at the trim's end.
- **Adjust trim:** a shot video version that is longer than planned, or already trimmed, has *Trim* / *Adjust trim* on its version card. The same picker opens with the current window; *Use full clip* removes the trim. Changing the trim of the version in use updates its timeline clips the same way as a swap (one undo step).
- Clips that are too short are unchanged: they are added as they are and show the length warning.
- **Video assets (V2-SB-133):** the same picker trims an upload to a `video` asset when it is more than 0.5 s longer than the longest video layer that shows the asset (its "layers use N s", shown in the asset's details next to `genDurationSec`). *Trim to N s* stores the version's trim; its in point is where those layers start unless a layer has its own `inSec`. *Keep full M s* adds the whole clip (layers start at 0 s or their `inSec`). A video asset that no layer uses is never asked. *Trim* / *Adjust trim* on the asset's version cards works as for shots; changing the trim of the version in use moves linked timeline layers that start at the old in point to the new one (their length stays).

### 4.5 Checking a file from the command line (V2-SB-131)

`npm run validate:storyboard -- <file.json>` runs the importer (`parseStoryboard`, the same code as *Import JSON*) on a file and prints `ok` or the errors, then the warnings, each with its path, and a summary: shots, total seconds, assets (by type), layers, effects, transitions and audio cues. It exits with code 1 when the file has errors. The script (`scripts/validate-storyboard.mjs`) loads the importer through Vite's module runner, because the preset registry discovers its modules with `import.meta.glob`, which plain `node` or `tsx` can't run.

## 5. Planner prompt (updated)

**Published guide (V2-SB-114).** The planner material is generated from the registry by `src/v2/domain/storyPrompt.ts` and `src/v2/domain/aiGuide.ts`, and published with the app. Paths are relative to the deployment's site URL (`DIONYSUS_SITE_URL`, see `docs/v2/DEPLOYMENT.md` in the repository):

| File | Published at |
|---|---|
| `public/ai/storyboard-guide.md` | `ai/storyboard-guide.md` — the guide the short prompt links to |
| `public/ai/storyboard-guide.html` | `ai/storyboard-guide.html` — the same guide as a web page |
| `public/ai/presets.json` | `ai/presets.json` — machine-readable preset ids, categories, descriptions, params and defaults, usage hints, and font ids |
| `public/ai/STORYBOARD_FORMAT.md` | `ai/STORYBOARD_FORMAT.md` — this specification (copied from `docs/v2/`) |
| `public/ai/HTML_CLIP_PACKAGE.md` | `ai/HTML_CLIP_PACKAGE.md` — the HTML clip package spec for `html` assets (copied from `docs/v2/`) |
| `public/llms.txt` | `llms.txt` |

Run `npm run gen:ai` after changing presets, fonts, the rules or the example; `aiGuide.test.ts` fails while the committed files are stale.

The app offers two prompts (Storyboard → AI prompt):
- **Short prompt** (default): links to the guide and tells the AI to read it first. An AI that can't open links is told to ask the user for the full prompt instead of guessing the format.
- **Full prompt**: the guide inlined (HOW IT WORKS, FORMAT, CHOOSING PRESETS, PRESETS, RULES, EXAMPLE), for AIs without web access.

**Generic guide (V2-SB-GUIDE-GENERIC).** The guide is story-neutral, so it works for any video:
- **HOW IT WORKS** explains assets, shots and connections, and how the app turns them into a timeline (generation prompts describe only the picture; text, post camera moves, looks and transitions are done by the editor).
- **CHOOSING PRESETS** gives generic guidance (choose by purpose, use few transitions and effects, stay consistent, omit params to use the defaults). It names no preset ids.
- **PRESETS** is **generated from the registry** (only ids listed there may be used): for each kind, presets are grouped by `category` (`[Light]`, `[Motion]` …, in registry order), and each line gives the id, its one-line description, its params with ranges, defaults and units, and the module's optional `ai` hints ("Use for", "Avoid", "Example params"). A new preset module appears here, in `presets.json` and in the pickers without editing the guide.
- **EXAMPLE** is a short, neutral storyboard ("First Light", 3 shots) that imports with no warnings and shows reusable assets, reference roles, last-frame continuity, `genDurationSec`, a text layer, a 2 s screen-blend video overlay cut from a 6 s clip (asset `genDurationSec` + layer `inSec`, V2-SB-133), effects and a transition. The storyboard tests use their own fixture (`src/v2/domain/__fixtures__/lanternKeeper.ts`), so the example can change freely.

**Rule numbers are stable.** Rules are cited by number (here, in user prompts and by other AIs), so `RULE_LIST` in `storyPrompt.ts` is append-only: new rules go at the end, existing rules are never reordered or deleted (rewrite a rule's text to retire it). `aiGuide.test.ts` pins the key order, checks that every `RULE n` this document cites exists and that the list below matches the generated rules. The rules section is:

```
RULES
1. Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions.
2. Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt.
3. When a shot must continue seamlessly from the previous one, add an asset with "type": "frame" and "source": { "type": "lastFrame", "shot": "<previous shot id>" }, use it in the next shot's "assets", and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.
4. Use "source": "upload" for things the user already has (logos, real photos, products).
5. Every asset and shot gets 2–5 QA checks that a person can verify by looking: identity consistency, key props, framing, artefacts (extra fingers, warped text, watermarks).
6. Keep ids short and stable (e.g. "hero", "kitchen", "s1", "s1-end"). Shots are listed in order; "connections" may be omitted for simple hard cuts.
7. Output valid JSON only: double quotes, no comments, no trailing commas.
8. Every piece of on-screen text (titles, cards, labels, captions) goes into a text layer (or the params of a reusable html text card, RULE 24), never into a generation prompt. Prompts ask for clean, empty surfaces where the text will sit.
9. Use "html" assets and "render": "html" only for animated, 3D or three.js graphics. Plain text over a shot is a text layer; a designed title or text-only card is one reusable "html" asset with params (RULE 24).
10. Transitions go on connections. Post camera moves (push-in etc.) and looks go in the shot's "effects", and the generation prompt then says "static camera".
11. Only use preset ids listed in the PRESETS section.
12. Preset params use the units noted in brackets in the PRESETS section; "fade-in"/"fade-out" "length" is a fraction (0.05–1) of the effect's time range, not seconds.
13. "durationSec" is how long the shot stays on screen in the final edit (its planned edit length). Decide it from the story's pacing, NOT from what the video model can generate, and never put the planned length only in "description" or notes. If the video model can't render that length (it has a minimum or fixed lengths, e.g. 6, 10 or 15 s), keep "durationSec" at the planned length and set "genDurationSec" to the length to ask the model for; it must be greater than "durationSec" (omit it when they are equal). When the clip is uploaded the app trims it to "durationSec" and the user picks which part to keep. Example: a 4 s beat with a model that renders 6 s minimum: "durationSec": 4, "genDurationSec": 6. Montage (a quick run of glimpses, e.g. three 2 s moments of a journey) needs no special field: write it as consecutive short shots (about 1-3 s each, e.g. three shots with "durationSec": 2), each with its own prompt, assets and QA checks, joined by plain cuts (omit their connections, or keep any transition very short, RULE 15). Use "genDurationSec" when the model can't render that short, keep the style and references the same across the run, and tie it together with one audio cue (a music bed or voiceover "from" the first montage shot "to" the last) rather than a longer shot.
14. Every clip prompt starts with a "References:" block that numbers the images attached to the clip in the order of the shot's "references" (else its "assets"): "Image 1 (<asset name>): …", one line each, saying explicitly whether the image is the START FRAME (or END FRAME) or only a reference, and what to take from it (identity, overall look, or materials and colours only, not its framing or wide view). Then state the framing from the first frame to the last. Set "references" with roles whenever the order or use is not obvious from the asset types.
15. A transition in "connections" overlaps the two shots, centred on the cut: it adds no time and eats half its length from the end of the "from" shot and half from the start of the "to" shot. It is clamped to half the shorter of the two shots. For example, a 0.8 s transition out of a 2.5 s shot blends the last 0.4 s of that shot with the first 0.4 s of the next, and the total length stays the same; keep transitions short on short shots so their key action isn't covered.
16. For an "identity" reference prefer a single clean portrait or character image (one view, plain background) over a multi-view character sheet: the sheet's layout (several poses, panels, labels) can leak into the generated frames.
17. An asset made from other assets lists them in its "references" in attach order, as objects with a "role" when the use is not obvious from the type. Its prompt then starts with the same numbered "References:" block as a clip prompt; for an image, "start-frame" means the base image to edit (there is no end frame). Example: a close-up of the hero holding a mug: "references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"], prompt "References:\nImage 1 (Blue mug): reference only: materials, colours and objects only; glaze and colour only.\nImage 2 (Hero): reference only: keep this identity (face, body, clothes).\n\nClose-up of …".
18. Keyframe then animate: when the opening composition matters (a character's pose, a precise layout, a hero product shot), give the "ai" shot a "keyframe": { "prompt", "references", "qa" }. The app turns it into an image asset "<shot id>.keyframe" named "Keyframe · <shot title>" that is made first. Numbering of the clip's images when a shot has a keyframe: Image 1 is always the keyframe, the START FRAME; Image 2, 3 … are the shot's "references" in their order, then the shot's other "assets" in "assets" order (the numbering without a keyframe, shifted by one). Do not also give the shot a "start-frame": one in "references", or an inferred one (a "frame" or last-frame asset), is attached as details only. The keyframe's own "references" are numbered separately, from Image 1, in the keyframe prompt; they are attached to the clip only if they are also in the shot's "assets" or "references". The keyframe prompt describes one still image (with its own "References:" block, as for an asset); the clip prompt starts with a "References:" block in the clip numbering above and then describes only the motion from that frame. Example: "keyframe": { "prompt": "References:\nImage 1 (Hero): reference only: keep this identity (face, body, clothes).\nImage 2 (Café): reference only: materials, colours and objects only.\n\nThe hero sits at a café table, both hands around a blue mug …", "references": ["hero", "cafe"], "qa": ["The hero's face matches the reference"] } with the shot's "assets": ["hero", "cafe"], clip prompt "References:\nImage 1 (Keyframe · Morning coffee): START FRAME: the clip opens on exactly this image.\nImage 2 (Hero): reference only, not a frame: keep this identity.\nImage 3 (Café): reference only, not a frame: materials and colours only.\n\nShe slowly lifts the mug …".
19. Audio: put each voiceover, music bed or sound effect in "audio" as a cue on an asset of type "audio" (source "generate" with a prompt for the user's voice/music/sound tool, e.g. the exact voiceover script and voice, or "upload"). "from" is the shot it starts in, "atSec" the offset into that shot, "to" the last shot it plays under. A music bed usually runs "from" the first shot "to" the last with "volume" 0.2-0.4 under speech; a voiceover spans the shots it describes; a sound effect sits at the moment in one shot ("atSec") with no "to". Example: { "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }, { "asset": "door-slam", "kind": "sfx", "from": "s4", "atSec": 1.2 }. Do not put spoken lines that the video model renders (shot "dialogue") into a voiceover too.
20. Layers stay fixed to the frame by default: a shot's video effects (e.g. "ken-burns" zoom and pan) move only the picture, so titles, labels and logos stay put and readable. Give a layer "follow": "shot" only when it belongs to the scene and must move with the picture, e.g. a name tag pinned to a sign or a label on an object while the shot slowly zooms: { "id": "tag", "type": "text", "text": "ROOM 12", "startSec": 0, "endSec": 4, "position": { "x": 0.62, "y": 0.4 }, "follow": "shot" }. It only has an effect when an effect moves or zooms the shot while the layer is on screen.
21. Keep text readable on any picture: give light text an outline ("strokeWidth" about 0.04-0.08 with a dark "strokeColor"), a soft "shadow", or a "background" box (captions, lower thirds). Use "letterSpacing" (in em) for airy titles, "lineHeight" for multi-line cards, "italic" for emphasis, and a text "effect" with "effectColor" only for stylised titles. Sizes and offsets are fractions of the font size; null removes a style's shadow or background. Example: "style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000", "shadow": { "color": "#000000", "blur": 0.3, "x": 0, "y": 0.04 } }. Put a look used on several layers into "meta.textStyles" once.
22. For overlays (light leaks, flares, dust, film grain, paper or ink textures) use an image or video layer with a "blend" mode and, if needed, an "opacity" below 1: "screen" or "add" for elements on black (the black disappears), "multiply" for elements on white (the white disappears), "overlay" or "soft-light" for textures on mid grey. Example: { "id": "leak", "type": "video", "asset": "light-leak", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen", "opacity": 0.7 }. Ask for the overlay asset full-frame on a plain black, white or grey background. Leave "blend" out ("normal") for titles, logos and pictures that should simply cover the shot.
23. An "html" asset's "prompt" is a design brief for the AI that will write the clip, not code: what it shows, how it moves over its length, colours, type and layout. List the media it uses (logos, photos, footage, music) in its "references"; the app copies the brief together with the HTML clip package instructions (format "dionysus.htmlclip/1", spec HTML_CLIP_PACKAGE.md next to this guide), filled in with the asset's size, length, bound assets and allowed libraries, and the user pastes the AI's single .html file back as a version.
24. Reuse one "html" asset with "params" instead of duplicating it: when shots or layers show the same design with different words, numbers or colours (title cards, text-only cards, chapter and end cards, lower thirds, counters), make ONE html asset, declare what varies in its "params" ({ "<key>": { "type": "text" | "number" | "color" | "boolean" | "select", "default": …, "label"?, "description"? } }, numbers may add "min", "max", "step", a select lists its "options"), and give each use its own values: a text-only shot is { "render": "html", "clip": "<asset id>", "params": { "text": "THE END" } }, a layer over a shot is { "type": "html", "asset": "<asset id>", "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "params": { "text": "5:58 AM" } }. Omitted keys use the default; a value must match its type (numbers within min–max, a select one of its "options", colours "#rrggbb"). The brief describes the design for any value (long and short text) and names the params; the app tells the clip's AI to expose exactly these params and read them at render time. Keep plain captions over a shot as text layers.
25. A "video" asset shown as a layer (a light leak, dust, smoke, a screen insert) is often generated longer than the layer needs, because video models have minimum or fixed lengths. Give the asset "genDurationSec" (the length to generate, 0.5-120, video assets only) and give each video layer "inSec": the second of the clip the layer starts from (default: the part the user picks when uploading, else 0). The layer still lasts endSec - startSec; keep inSec + that length within genDurationSec. One generated clip can feed several layers with different "inSec" values. Example, a 2 s screen-blend overlay cut from a 6 s clip: asset { "id": "dust-leak", "type": "video", "genDurationSec": 6, ... } and layer { "id": "s3-dust", "type": "video", "asset": "dust-leak", "startSec": 0, "endSec": 2, "inSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen" }. For a shot's own clip use the shot's "genDurationSec" instead (RULE 13).
```

## 6. Decisions, open questions and future work

- **Template HTML:** asset `source: {type:"template", template, params}` for registered built-in templates. This needs a template registry. Not in v1. **Resolved in part (V2-HTML-PARAMS):** an `html` asset declares typed `params` and each shot or layer gives its own values (§2.3.2), so one generated or uploaded clip already works as a reusable template.
- **`trackMotion`** (layers that follow tracked motion inside the clip, e.g. a moving face): semantics are still to be defined. Not in v1. Following the shot's own zoom and pan effects is `follow: "shot"` (§2.5). Layer blend modes shipped in V2-SB-128 (`blend`, `opacity`; §2.5).
- **Resolved:** `id@N` resolves to the current version with a warning; old render functions are not kept (§3.1).
- **Resolved:** there is no `meta.minImporter`. A v1.0 build reports the unknown asset type with its path, which is enough.
- **Promotion:** the UX and id rules for promoting a `meta.textStyles` entry into the registry.
- **Durations:** whether the planner prompt should list per-model duration limits for RULE 13.

## 7. Worked example

`src/v2/domain/__fixtures__/ep01_opening.storyboard.json` (12 shots) imports with no warnings and shows the following:
- **s03** is `render: "still"` with `clip: "card-still"`. It has a framed text layer (`box`, `textStyle: "plain"` plus inline serif style, fade-in, `follow: "shot"`, and V2-SB-128 `blend: "multiply"` with `opacity: 0.9`, so the ink takes on the card's paper texture) and a `ken-burns` effect.
- **s07** is `render: "still"` with `clip: "title-bg"`. It has a centred `ALLOTMENT` text layer that uses `meta.textStyles["ata-title"]` (serif, with V2-SB-127 `letterSpacing` 0.25 and a soft `shadow`).
- **Connections:** s06→s07 uses `dip` (0.5 s) and s07→s08 uses `crossfade` (0.8 s).
- **Asset `card-still`** (V2-SB-123) is made from `[{ "asset": "flat", "role": "detail", "note": "…drawers only…" }, "style"]`, and its prompt starts with the matching two-image `References:` block.

Excerpt (prompt shortened):

```json
{
  "id": "s07", "title": "Title: ALLOTMENT", "durationSec": 6,
  "render": "still", "clip": "title-bg", "assets": ["title-bg", "style"],
  "prompt": "… plain deep slate-blue background … No text or letters of any kind.",
  "layers": [{ "id": "s07-title", "type": "text", "text": "ALLOTMENT",
    "startSec": 0.5, "endSec": 5.5, "position": { "x": 0.5, "y": 0.5 },
    "textStyle": "ata-title", "anim": { "in": "fade", "out": "fade", "durationSec": 0.8 } }],
  "qa": ["…"]
}
```
