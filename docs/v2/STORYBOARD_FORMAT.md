# `dionysus.storyboard/1` format (v1.1)

This is the source of truth for the storyboard JSON format. The importer is `src/v2/domain/storyJson.ts`; the worked example `src/v2/domain/__fixtures__/ep01_opening.storyboard.json` is imported by the tests. When this document and the code disagree, fix one of them in the same PR.

Implementation status is tracked in `public/doc/tasks.json` (tasks `V2-SB-11x`).

## 1. Overview and compatibility

- The format string stays `"dionysus.storyboard/1"`. v1.1 is additive: **every new field is optional**, and every existing v1 file stays valid with the same meaning.
- Readers ignore unknown fields (the current importer, `src/v2/domain/storyJson.ts`, already does).
- **Caveat for v1.0 importers.** They reject asset `type: "html"` and require a shot `prompt`. A v1.1 file that uses html assets or leaves out a prompt therefore needs a v1.1 importer. Planners should keep a shot `prompt` even where v1.1 makes it optional. The worked example does this and still imports cleanly in today's app.
- **Schema 3.1 (clip-centric, P16).** A file with `"schemaVersion": "3.1"` keeps the generation prompt, references, `genDurationSec`, `keyframe`, `camera`, the clip's `qa` and its generated versions **only on video assets (clips)**. A shot has no `prompt`: it is a clip reference (`clip`) plus `inSec`/`durationSec` and its layers, text, effects and audio. Several shots may name the same clip to reuse one generation; the first shot that uses it generates it, later shots only trim it. Dionysus always exports 3.1.
- **3.0 migration.** A file without `schemaVersion` (or with `"3.0"`) is read as 3.0. On import each shot prompt becomes a single-use clip asset (id `<shot id>-clip`, name `Clip · <shot title>`, `"auto": true`) linked from the shot; clips already shared through video assets keep their reuse. Exporting and importing again gives the same board. The validator warns when a 3.1 shot still carries a `prompt` (it is read as that shot's own clip) or clip fields next to a `clip`.
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
| `source` | `"generate"`, `"upload"`, `"json"` (audio only) or `{"type": "lastFrame", "shot": "<shot id>"}` | Write `"generate"`, `"upload"` and `"json"` as **plain strings** (V2-SB-131); only a last frame is an object. `"json"` (P4A, `audio` assets only): the user's AI writes a `dionysus.audioclip/1` clip ([AUDIO_CLIP_FORMAT.md](AUDIO_CLIP_FORMAT.md), RULE 38) that Dionysus renders; the prompt is a sound brief, and `"json"` on another type is an error. Omitted = `"generate"`. For compatibility the importer also accepts the object forms of generate and upload (with `"type"` set to `"generate"` or `"upload"`), but the guide, the example and the app never write them. `html` and `audio` assets can't use `lastFrame`. **Future, not v1:** a template source (§6). |
| `qa` | string[] | 2-5 yes/no checks that can be verified by looking. |
| `params?` **(new, V2-HTML-PARAMS)** | `{ "<key>": Param }` | `html` assets only: the values the clip exposes, so one asset is reused with different values (§2.3.2, RULE 24). Ignored, with a warning, on other types. |
| `genDurationSec?` | number, 0.5 to 120 | **(new, V2-SB-133)** `video` assets only: the length to generate when the layers using the asset need less (video models have minimum or fixed lengths). Each video layer picks its part with `inSec` (§2.5); an upload longer than the longest layer using the asset is offered a trim (§4.4). On any other type it warns and is ignored. |
| `states?` **(new, V2-SB-136)** | AssetState[] | `character`, `location`, `prop`, `style`, `image` and `frame` assets only: the same thing in other states (lit, wet, at night, broken), each with its own prompt and versions, referenced as `"<asset id>@<state id>"` (§2.3.3, RULE 29). |

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

#### 2.3.3 `assets[].states[]`: asset states (V2-SB-136)

When a character, location or prop changes during the story (a lamp off and on, a coat dry and soaked, a street by day and at night), it stays **one asset** and lists its other looks as states. Each state is made from the base asset, so it keeps the same identity, but it has its own prompt, QA checks and versions.

```json
{ "id": "hill", "name": "Hill road", "type": "location", "prompt": "Empty winding road up a grassy hill before sunrise, …", "source": "generate", "qa": ["…"],
  "states": [
    { "id": "sunrise", "name": "Sunrise",
      "prompt": "References:\nImage 1 (Hill road): the base image to edit: keep the road, hill and valley exactly; change only the light.\n\nThe same winding hill road as the sun rises …",
      "references": [{ "asset": "hill", "role": "start-frame", "note": "the same road and hill; only the light changes" }],
      "qa": ["Same road, hill and valley as the base image"] } ] }
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Letters, digits, `_` and `-` (no `.` or `@`), unique within the asset. The state's full id is `"<asset id>@<state id>"`, e.g. `"hill@sunrise"`. |
| `name?` | string | Shown in the app as `"<asset name> · <state name>"` (default: the state id). |
| `prompt` | string | Required unless `source` is `"upload"`. Describe what changes; start with a `References:` block (RULE 17). |
| `references?` | (string \| AssetReference)[] | As for assets (§2.3.1). The base asset is always attached: if the list doesn't name it, the app puts it first as Image 1 (role `identity` for a character, otherwise from its type, with the note "the same <name>: keep exactly what it is and how it looks; change only its state"). Name the base yourself to choose its role, e.g. `start-frame` to edit the base image. A state can't use another state of the same asset. |
| `source?` | `"generate"` or `"upload"` | Default `"generate"`. Not `lastFrame`. |
| `qa?` | string[] | Checks for this state. |
| `notes?` | string | Free text. |

- **Type, aspect and params** are always the base asset's. A state can't have states.
- **Use:** `"<asset id>@<state id>"` works anywhere an asset id does: a shot's `assets` and `references`, a keyframe's `references`, another asset's (or state's) `references`, a still shot's `clip` and an image layer's `asset`. The base id keeps meaning the default look.
- **Validation:** `states` on a `video`, `audio` or `html` asset, a state without an `id`, an id with `.` or `@`, a duplicate id, a source other than `"generate"`/`"upload"`, a generated state without a prompt, `"x@y"` naming an unknown asset or a state the asset doesn't have, or a state made from a sibling state: error. An unknown state field or a state no shot uses: warning.
- **In the app:** a base asset's detail has a **States** section (chips for each state and **Add state**, which creates `"<asset id>@<slug of the name>"` made from the base and opens it). A state's detail says "State of <base>" with **Open base**; its editor keeps the base's type and aspect and always keeps the base in *Made from*. An asset with states can't be deleted until its states are; changing the base's type or aspect changes its states too. Each state has its own versions: *Copy prompt* attaches the base's selected version as its image, and **Send to timeline** and every reference to `"x@y"` use the **state's** selected version.
- **Export:** the app's board is not written back to JSON; the storyboard file keeps `states` in the authored form above.

### 2.4 `shots[]`

> **Schema 3.1 (P16, RULE 51).** In a 3.1 file the rows marked *(3.0)* below — `prompt`, `assets`, `references`, `genDurationSec`, `keyframe`, `camera` and the clip `qa` — live on the shot's **clip**, a `video` asset, and never on the shot. A 3.1 `ai` shot has:
>
> | Field | Type | Notes |
> |---|---|---|
> | `clip` | string | Required for `render: "ai"`: the id of a `video` asset. One clip per shot (`<shot id>-clip`), or the same clip in several shots to reuse one generation. |
> | `inSec?` | number, >= 0 | Where this shot starts playing a shared clip (default 0). A warning if it is past the clip's `genDurationSec`. |
> | `qa?` | string[] | Optional checks of the edit itself (text, layers, timing). |
>
> An `ai` shot with neither `clip` nor `prompt` is an error. A 3.1 shot that still has a `prompt` is accepted with a warning and read as its own clip.

| Field | Type | Notes |
|---|---|---|
| `id`, `title`, `description?` | string | Unchanged. |
| `durationSec` | number, 0.5-120 | How long the shot stays on screen in the final edit, decided from the story's pacing, not from the video model's limits (RULE 13). Never put the planned length only in `description`. |
| *(3.0)* `genDurationSec?` **(new, V2-SB-121)** | number, 0.5-120, >= `durationSec` | Only when the video model must render longer than the shot (a minimum or fixed lengths, e.g. 6/10/15 s): the length to generate. Example: a 4 s beat with a model that renders 6 s minimum: `"durationSec": 4, "genDurationSec": 6`. The uploaded clip is then trimmed to `durationSec` (§4.4). Omitted, or equal to `durationSec`, means "generate `durationSec`". A value outside 0.5-120 or shorter than `durationSec` is ignored with a warning. |
| *(3.0)* `prompt` | string | Required when `render` is `"ai"`. Optional for `"html"` and `"still"` (keep it anyway for v1.0 readers). Never asks for text. |
| *(3.0)* `assets` | string[] | Asset ids used. Should include `clip`. May include another shot's keyframe, `"<shot id>.keyframe"` (V2-SB-135, §2.4.3). |
| *(3.0)* `camera?` | string | Unchanged. |
| `dialogue?` **(extended, V2-SB-135)** | string or Line[] | Spoken lines. A string as before, or a list of lines (§2.4.4): each a string or `{ "speaker"?, "text", "offscreen"? }`. `offscreen: true` = heard, not seen (no lip-sync). |
| *(3.0)* `keyframe?` **(new, V2-SB-124)** | object | `ai` shots only: the opening still to make first; the clip animates from it. See §2.4.2. |
| `qa` | string[] | 2-5 visual checks. |
| `render?` **(new)** | `"ai"`, `"html"` or `"still"` | Default `"ai"`. The production to-do uses this to choose the step: generate a clip, upload or refresh the HTML, or use the still. |
| `background?` **(new, P2B)** | `"#rrggbb"` or `{ "type": "linear" \| "radial", "angle"?, "stops": [{ "color", "at"? }] }` | `still` shots only, instead of `clip`: a solid colour or a gradient that the app draws as the still's picture (2–8 stops; `at` 0–1, evenly spread when omitted; linear `angle` in degrees, 0 = bottom to top, 90 = left to right, default 180 = top to bottom; `angle` is ignored for radial, with a warning). Titles and graphics go on top as `layers`. The app keeps the drawn PNG as an implicit asset `<shot id>.background` (not exported) and redraws it when the background changes. Set on a non-still shot, or together with `clip`, it is ignored with a warning. See RULE 34. |
| `clip?` **(new)** | asset id | Required when `render` is `"html"` (must point to an `html` asset) or `"still"` (must point to an `image` asset, unless `background` is set). Ignored for `"ai"`, with a warning. The clip renders from the asset's **selected** version (the one the user picked in the asset's version history), not simply the latest upload. |
| `params?` **(new, V2-HTML-PARAMS)** | `{ "<key>": value }` | `render: "html"` only: this shot's values for the `clip` asset's `params` (§2.3.2), e.g. `{"text": "THE END"}`. Values are strings, numbers or booleans. Ignored, with a warning, for other renders. |
| `layers?` **(new)** | Layer[] | §2.5 |
| `captions?` **(new)** | boolean | When `true`, the shot's `dialogue` is rendered into the shared subtitle text layer (for a list, the lines' `text`, one per line, without speakers). Has no effect, and triggers a warning, if there is no `dialogue`. |
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

#### 2.4.3 Keyframe references: `"<shot id>.keyframe"` (V2-SB-135)

A shot's keyframe (§2.4.2) can be reused like an asset. Any reference list may name it as `"<shot id>.keyframe"`: a shot's `assets` and `references`, another shot's `keyframe.references`, and an asset's `references`. It may carry any role (`start-frame` to open on exactly that composition, `identity`, `look`, `detail`; `end-frame` in a shot).

```json
{ "id": "s3", "assets": ["hill", "s1.keyframe"],
  "references": [{ "asset": "hill", "role": "detail" }, { "asset": "s1.keyframe", "role": "look", "note": "same pre-dawn palette and mist" }] }
```

- **Type and role.** A keyframe reference counts as a `frame` asset, so a plain id is inferred as `start-frame` (or `detail` when the shot already has a start frame or its own keyframe, as in §2.4.1).
- **Attach list.** It is numbered like any other image, under the slot name `Keyframe · <shot title>`, in *Attach in this order* and in the generated `References:` block. The attached image is the referenced keyframe's **selected** version (a per-shot pin, §4.2, wins).
- **Production order.** The referenced keyframe's step comes before every step that uses it (the shot or asset that references it), so it is made first.
- **Errors.** `"X.keyframe"` where shot `X` does not exist, or exists without a keyframe (or with a non-`ai` render, whose keyframe is ignored); a keyframe whose `references` list its own id; a loop through keyframes, assets and shots (for example s1's keyframe made from s3's keyframe, which is made from s1's last frame): *Keyframe references form a loop*. A layer `asset` can't be a keyframe (it is a reference image, not media): unknown asset.
- **Warnings.** A shot listing its own keyframe in `assets` or `references`: the entry is dropped (the keyframe is always Image 1).

#### 2.4.4 Dialogue lines and off-screen dialogue (V2-SB-135)

`dialogue` may be a list of lines. Each line is a string (an on-screen line with no speaker) or an object:

| Field | Type | Notes |
|---|---|---|
| `speaker?` | string | Who says it (e.g. `"FRIEND"`). |
| `text` | string | Required. The words. Whitespace and line breaks are collapsed. |
| `offscreen?` | boolean | `true` = **off-screen**: the voice belongs to the scene but its speaker is not in frame (behind a door, on the phone, calling from out of shot). Nobody in frame moves their lips. This is not a voiceover (narration over the film is an `audio` cue of kind `voiceover`). |

```json
"dialogue": [{ "speaker": "KEEPER", "text": "One more night." }, { "speaker": "RADIO", "text": "Storm warning, all ships.", "offscreen": true }]
```

- **Clip prompt.** *Copy prompt* appends a numbered `Dialogue:` block (unless the prompt already has a `Dialogue:` line): `1. KEEPER (on screen, lip-synced): "One more night."`, `2. RADIO (OFF-SCREEN: heard, not seen; the speaker is not in frame and no one in frame moves their lips): "Storm warning, all ships."`. A line with a linked `dialogue` audio cue (§2.8) reads *recorded separately and added in the edit: do not voice it, and no one in frame moves their lips*. Plain-text dialogue adds no block.
- **Captions.** `captions: true` shows the lines' `text`, one per line.
- **Board.** The shot's *Direction* lists the lines and marks off-screen ones. The shot editor shows them as text, one line each: `SPEAKER: text` or `SPEAKER (O.S.): text`. Saving keeps them as lines; typing `NAME (O.S.): …` into a plain-text dialogue turns it into lines.
- **Errors.** A line that is not a string or object, or has no `text`. **Warnings.** A `dialogue` that is neither text nor a list (ignored); a non-boolean `offscreen` (the line is on screen); an unknown line field (ignored).

#### 2.4.5 Frame references: `frameOf` (P15)

A shot can start from, or match, a frame **inside** an earlier shot's clip (not only its last frame, §2.3 `lastFrame`). Example: shot 1 is a man at his computer noticing objects on the desk; the camera then pans to reveal a second person. Shot 2 should open on the middle of that move. Write it as one entry of the later shot's `references` (RULE 50):

```json
{ "frameOf": "s1", "atSec": 2.5, "role": "start",
  "frameDesc": "Medium close-up, eye level: the man sits centre-left at the computer looking down at the objects on the desk; midway through shot s1's push-in, before the pan to the second person; used as the start frame of this shot." }
```

| Field | Type | Notes |
|---|---|---|
| `frameOf` | string | Id of the **source** shot. It must exist, must not be the shot itself, and must come earlier in the order. |
| `atSec?` | number | Seconds into the source clip where the picker starts. The user picks the exact frame in the app. Negative or beyond the source shot's length: warning. |
| `role?` | `"start"` or `"reference"` | `start` (the default): the frame is the shot's **start frame** (role `start-frame`). `reference`: attached as a reference image only (role `detail`). Anything else: warning, used as `reference`. |
| `frameDesc` | string | **Required.** It must state (1) the camera framing and angle, (2) who or what is visible and where in the frame, (3) where in the source shot's camera move the frame sits, and (4) how the target shot uses it. |

- **On import.** Each frame reference becomes an implicit `frame` slot with id `<target shot id>.frameof.<source shot id>` (with `-2`, `-3` … for further frames of the same source), named `Frame of shot N · <source title>`, whose prompt is `frameDesc`. It counts as one of the shot's inputs, in the position it has in `references`. It is never written to `assets`, and export writes it back in the form above.
- **Validation.** Errors: a missing `frameDesc`, an unknown `frameOf`, the shot itself, or a later shot (which would create a forward cycle). Warning: a simple keyword check lists the subjects `frameDesc` names (nouns after "the", "a", "his" …, minus camera words) that the source shot's prompt and description never mention, which usually means the description doesn't match the source shot.
- **In the app.** The reference slot shows *Pick frame from Shot N* with a warning badge until a frame is picked. The frame picker plays the source clip with a scrubber, previous / next frame buttons and a thumbnail strip, shows `frameDesc` above the player, and starts at `atSec`. *Use this frame* stores a PNG version with `{ frameOf, atSec, sourceVersionId }`; *Download PNG* saves it. Without a source clip the slot says *Generate Shot N first*.
- **Production order.** The source shot comes first, then a required *Pick frame* step, then the target shot. The Storyboard page lists pending picks under *Prepare references*, in generation order.
- **Source changes.** When the source shot's selected clip version is no longer the one the frame was taken from, the slot, the Production step and the shot show *Source shot changed - frame may be affected* with **Re-pick** and **Dismiss**. Dismiss holds for that source version only, so a newer version warns again. The frame is never replaced automatically.
- **Prompt export.** The picked frame is attached like any other image: as the START FRAME for `start`, or as a reference image for `reference`.

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
| `anim?` | `{in?, out?, loop?, durationSec?, inParams?}` | Ids of the `textAnimIn`, `textAnimOut` and `textAnimLoop` kinds. `durationSec` applies to in and out. `inParams` **(new, P7)** are params of the `in` animation, checked against its descriptor (unknown keys, out-of-range numbers and unlisted `select` values warn). See "Typewriter cursor" below. |
| `link?` | `false` | P9-LINK. Absent (default) = on Send to timeline the layer is linked to its shot's main clip (moves/trims/splits/deletes with it, RULE 46). `false` = not linked. |
| `follow?` | `"frame"` \| `"shot"` | V2-SB-126. Default `"frame"`: the layer stays fixed to the frame. `"shot"`: it moves with the shot's zoom and pan (see "Fixed or following layers" below). |
| `chromaKey?` **(new, P3B)** | `{ "color": "#rrggbb", "range"?: 0–1, "spill"?: 0–1 }` | Image, video and html layers: removes `color` (green screen). `range` is the tolerance (default 0.4), `spill` removes the colour's tint from edges (default 0.5). Named colours `green` / `blue` are accepted. Keyed on the GPU (WebGL, CPU fallback) in both preview and export. On a text layer, or with a bad colour, it warns and is ignored. See RULE 36. |
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

**Typewriter cursor (P7-TYPE-CURSOR).** With `"anim": { "in": "typewriter" }`, `inParams` sets the cursor. The typing lasts `anim.durationSec`.

| Param | Type | Notes |
|---|---|---|
| `cursor` | string, default `""` | `""` = no cursor (the old look). One character (`"\|"`, `"_"`, `"▌"`) = a cursor drawn right after the typed text. Several (`"0123456789"`, `"01"`) = decode/scramble: each new character flickers through random ones of these before it resolves, and the cursor itself cycles through them while typing. |
| `blink` | number 0–6, default 2 | Cursor blinks per second once typing has finished. 0 = solid. While typing the cursor is solid. |
| `after` | `"blink"` \| `"hide"` \| `"fade"`, default `"blink"` | After typing: keep blinking, disappear at once, or fade out over 0.5 s. |
| `scramble` | number 0–1 s, default 0.15 | How long each character scrambles (only with several cursor characters). |

The scramble is deterministic: the random glyph of character *i* changes 30 times a second and depends only on *i* and the clip time, so the preview and every export (any fps) show the same frames. Spaces and line breaks are never scrambled.

Example (a sci-fi location/date caption at the bottom right): `{ "id": "loc", "type": "text", "text": "SEATTLE / YEAR 2027", "startSec": 0.5, "endSec": 4, "position": { "x": 0.62, "y": 0.9 }, "textStyle": "sci-fi-caption", "anim": { "in": "typewriter", "durationSec": 1.5, "inParams": { "cursor": "0123456789", "after": "fade", "scramble": 0.25 } } }`. The `sci-fi-caption` style already carries those `inParams`, so `"textStyle": "sci-fi-caption"` alone gives the same look.

**Text sizing.** Text is a single line per `\n`-separated line; it is **never wrapped**.
- With `position`, the text is centred on the point. Its size is `style.size`, else the `textStyle` size, else 0.1 of the frame height.
- With `box`, the text is centred in the box. Its size is `style.size` when given; otherwise it is fitted to the box height (`height / (lines × 1.2)`). The box width does not shrink the text.
- The importer estimates the rendered width from the font's average character width and warns on `<layer>.text` when the text is likely wider than the box (or the frame, for `position`). Use `position`, shorter text or a smaller `size` to fix it.

**HTML layer:** `{id, type:"html", asset:<html asset id>, startSec, endSec, box, follow?, blend?, opacity?, params?}`. `params` (V2-HTML-PARAMS) is this layer's values for the asset's `params` (§2.3.2), e.g. `{"text": "5:58 AM", "background": "none"}`; `params` on an image, video or text layer is ignored with a warning.

**Image / video layer:** `{id, type:"image"|"video", asset:<asset id>, startSec, endSec, box, follow?, blend?, opacity?, inSec?, chromaKey?}`. These land in the overlay group above the shot.

**In point of a video layer (V2-SB-133).** `inSec` (video layers only, seconds, 0 or more) is where in the asset's clip the layer starts; the layer still lasts `endSec - startSec`. Omitted, the layer starts where the selected version's trim starts (picked on upload, §4.4), else at 0. This lets a short layer use the best part of a longer generated clip, and several layers use different parts of one clip.
- Example, a 2 s screen-blend overlay cut from a 6 s clip: asset `{ "id": "dust-leak", "type": "video", "genDurationSec": 6, … }` and layer `{ "id": "s3-dust", "type": "video", "asset": "dust-leak", "startSec": 0, "endSec": 2, "inSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen" }`.
- On Send to timeline the clip's source in point is `inSec`. When `inSec` plus the layer length runs past the uploaded clip's end, the clip starts earlier so it keeps its length (or the whole clip is used when it is shorter than the layer).
- The in point can be changed later on the timeline: select the clip, then **Speed → In point** in the desktop inspector or the **In point** tool on a phone (slider, a seconds field and ±0.1 s steps; the clip keeps its length and position).
- `inSec` on an html or image layer, or a negative or non-numeric value, warns and is ignored. `inSec` plus the layer length past the asset's `genDurationSec` warns.

**Link to main (P9-LINK).** Send to timeline links every layer, caption and effect of a shot — and each audio cue that ends inside its `from` shot — to the shot's main-track clip (`Placement.link.parent` in the project). In the editor a linked clip shows a thin blue bar on its left edge; it keeps its offset when the shot is moved, rippled or reordered, is cut to the shot's new range when the shot is trimmed shorter (removed when nothing is left), goes to the half holding its start when the shot is split, and is deleted with the shot (one undo step). Opt out per layer or cue with `"link": false`; the field round-trips through export and re-import. Projects made before P9 have no links. In the editor, the 🔗 Link to main / Unlink toggle and the project setting "Auto-link new clips" (default on: new non-main clips link to the main clip under their start) control links by hand.

**Fixed or following layers (V2-SB-126).** Video effects (`shots[].effects`, e.g. `ken-burns`) move, zoom and colour only the shot's own picture (with the default `applyTo: "main"`, §2.7); every layer is drawn on top of the result, so by default text and overlays stay **fixed to the frame**, whatever the effect order. A layer with `follow: "shot"` instead moves with the picture: on Send to timeline the zoom (`scale`) and pan (`dx`, `dy`) of the shot's effects over the layer's time range are baked into the placement's x, y and scale keyframes (linear keys sampled every 0.25 s and at effect boundaries; a point at offset (x, y) from the frame centre goes to (dx + scale·x, dy + scale·y) and its size is multiplied by scale). Look-only effects (colour, blur, vignette) are not followed. The keyframes are ordinary keyframes: the user can edit or clear them in the inspector, and they do not update if the effect is changed later.
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
| `applyTo?` **(P6-FX-SCOPE)** | `"main"`, `"overlay"` or `"all"` | Which picture the effect changes. `"main"` (default, also what a missing field means, so older boards and projects render unchanged): the shot's own clip on the main track, before layers are drawn on top. `"overlay"`: each overlay layer (image, video, html) on its own, before it is composited; the main track is untouched. `"all"`: the whole composited frame — main track, overlays and text layers together (burned-in subtitles stay on top). An unknown value warns and uses `"main"`. Stored on the timeline effect clip as `effect.applyTo` (omitted for `"main"`), so it survives project export/import zips and storyboard JSON export. Guide rule 44. |

Post camera moves (push-in through `ken-burns`, `shake`) and looks (`bw`, `vignette`) go here, not in the generation prompt.

**Apply to (P6-FX-SCOPE).** Example: a TV-set overlay whose screen is a chroma-keyed green window showing the shot. `{"preset": "ken-burns", "params": {"zoom": 0.15}}` (`applyTo` `"main"`) zooms only the picture inside the TV; `{"preset": "ken-burns", "params": {"zoom": 0.15}, "applyTo": "all"}` zooms the TV and the picture together. Effects of the same scope stack in layer order (bottom layer first); the scopes are applied in render order: `main` after the main track, `overlay` per overlay layer, `all` on the finished frame. Preview and export use the same renderer (`Player.draw`). Layers with `follow: "shot"` follow only `main` effects (an `all` effect already moves them). In the editor the scope is the **Apply to** control (Main · Overlays · All) at the top of an effect clip's inspector; new effect clips start at Main.

`fade-in` / `fade-out` `params.length` is a **fraction (0.05–1) of the effect's time range**, not seconds: on a 4 s shot with no `startSec`/`endSec`, `{"length": 0.25}` fades over the first (or last) 1 s. For a fade of N seconds, set `startSec`/`endSec` to an N-second range and keep `length: 1`, or use `length = N / range`.

### 2.8 `audio[]` (V2-SB-125)

Audio cues place an asset of type `audio` in story time: a voiceover across the shots it describes, a music bed under a whole sequence, an ambience bed (V2-SB-135) under the shots it is heard in, or a sound effect, a sting or a recorded dialogue line at a moment in one shot. The audio file itself is an ordinary asset. Give it `source: "generate"` with a prompt for the user's voice, music or sound tool (for a voiceover, the exact script and the voice), or `source: "upload"`. Audio assets can't use `lastFrame`.

```json
"audio": [
  { "id": "bed", "asset": "score", "kind": "music", "from": "s01", "to": "s06", "volume": 0.3, "fadeOutSec": 2 },
  { "asset": "vo-intro", "kind": "voiceover", "from": "s01", "atSec": 0.5, "to": "s03" },
  { "asset": "door", "kind": "sfx", "from": "s06", "atSec": 3.2 },
  { "asset": "rain", "kind": "ambience", "from": "s02", "to": "s05" },
  { "asset": "hit", "kind": "sting", "from": "s07", "atSec": 0.5 },
  { "asset": "radio-line", "kind": "dialogue", "from": "s04", "atSec": 1, "line": 2 }
]
```

| Field | Type | Notes |
|---|---|---|
| `id?` | string | Default `audio<N>` (its position, from 1). Must be unique. |
| `asset` | asset id | Required. Must be an asset with `type: "audio"`. |
| `kind` | `"voiceover"`, `"music"`, `"sfx"`, `"ambience"`, `"sting"` or `"dialogue"` | Required. Sets the defaults and the timeline layer (Voiceover, Music, Sound effects, Ambience, Stings, Dialogue). V2-SB-135 added `ambience` (a background bed: wind, rain, room tone), `sting` (a short musical hit on a moment) and `dialogue` (a separately recorded line of the `from` shot's dialogue). |
| `from` | shot id | Required. The shot the cue starts in. |
| `atSec?` | number ≥ 0 | Seconds into `from`. Default 0. |
| `to?` | shot id | The last shot the cue plays under: it ends at the end of that shot. It must be `from` or a later shot. Omitted: the audio's own length (a looping cue: the end of `from`). Not for `sting` and `dialogue` (warned and ignored). On a `sfx` it warns: a sound effect is not looped, so a continuous sound should be `ambience`. |
| `durationSec?` | number > 0 | Stop after this many seconds. With `to`, whichever comes first. |
| `loop?` **(V2-SB-135)** | boolean | `music` and `ambience` only: repeat the audio to fill the span. Default `true` for ambience, `false` for music. Warned and ignored on other kinds. |
| `line?` **(V2-SB-135)** | integer ≥ 1 | `dialogue` only: the 1-based line of the `from` shot's `dialogue` list this recording is. It should be an off-screen line (an on-screen line is voiced by the video model; warned). Out of range or on another kind: warned and ignored. |
| `volume?` | 0–1 | Default: music 0.35, ambience 0.5, sting 0.8, voiceover, sfx and dialogue 1. |
| `fadeInSec?`, `fadeOutSec?` | number ≥ 0 | Default: music and ambience 1 s each, others 0. Clamped to the cue's length. |
| `volumeKeys?` **(new, P3B)** | `[{ "t": number ≥ 0, "v": 0–2 }]` | Volume curve: `t` is seconds from the cue start, `v` multiplies `volume` (1 = unchanged, 0 = silent). Linear between points; before the first and after the last point the end values hold. On Send it becomes the clip's volume keyframes (each copy of a looping cue keeps the cue's timing), editable as **Volume curve** on the timeline. Bad points warn and are dropped. See RULE 37. |
| `link?` | `false` | P9-LINK. A cue that ends inside its `from` shot is linked to that shot's main clip on Send (moves/trims/deletes with it, RULE 46); `false` keeps it free. Cues spanning several shots are never linked. |
| `fx?` **(new, P3B)** | `{ "preset": "<audio effect id>", "amount"?: 0–1 }`, or just the id | An audio effect (§3: `pa-announcement`, `hall`, `room`, `telephone`, `radio`, `underwater`, `robot`) at `amount` (default 1). Preview (Web Audio) and export use the same processing. Unknown ids warn and play dry; the id is kept. See RULE 37. |

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

**Send to timeline.** A cue is placed when its `from` shot is sent, or on a later send once its `from` shot's clip is already on the timeline (P1-AUDIO): audio uploaded after the shots were sent still lands, and Send to timeline is enabled while such cues wait. Each cue is placed once; its clips remember the cue id, so sending again never duplicates it.

- **Start and end.** It starts `atSec` into that shot's clip. It ends at the earliest of: the end of the `to` shot's clip (when that clip is on the timeline or sent in the same batch), `atSec + durationSec`, and the end of the audio.
- **Looping (V2-SB-135).** An `ambience` cue (unless `loop: false`) and a `music` cue with `loop: true` are not cut at the end of the audio: copies of the audio are placed back to back on one layer until the cue's end (the end of `from` when it has no `to` or `durationSec`); the last copy is trimmed. The fade-in is on the first copy and the fade-out on the last. All other kinds play once.
- **Layers, volume and fades.** Each kind goes on its own audio layer: Voiceover, Music, Sound effects, Ambience, Stings or Dialogue. A new layer is added when the existing one is busy. Volume and fades are set on the clip, and you can change them on the timeline.
- **Linking.** A cue that fits inside its first shot (typically a sound effect) is linked to that shot's clip, so it follows a version swap like other linked items. A cue across shots is placed and not linked.
- **Skipped cues.** A cue whose asset has no version yet is skipped and counted. Send again after uploading it; only the waiting cues are added.
- **Short clips (P1-SHORT-AUDIO).** A clip shorter than its fades gets its fade-in and fade-out scaled down to fit, so very short sounds still play in preview and export.

**Board edits.**

- *Deleting a shot:* a cue that started in it moves to the next shot it covered, or is removed when it covered no other shot. A cue that ended in it now ends with the shot before.
- *Deleting the audio asset:* its cues are removed.

#### Audio taken from a video (P18)

Instead of `"asset"`, a cue may give `"source": { "fromVideo": "<id>", "inSec"?: number, "outSec"?: number }` to use the sound of a video:

- `fromVideo`: a `video` asset id, or a shot id (that shot's clip). Required.
- `inSec` / `outSec`: seconds into the video file. With a shot id they default to the shot's clip span (`inSec` and `durationSec`); with a video asset, to the whole file. A negative `inSec` or an `outSec` not after `inSec` is reported as a warning and ignored.
- `"asset"` is left out (if both are given, `"asset"` is ignored with a warning). No audio asset is declared; the app takes the sound from the video. The timeline clip records its provenance `{ fromVideo, inSec, outSec }`.
- Every other cue field (`from`, `to`, `atSec`, `volume`, fades, `fx`, `position`, …) works as usual.

```json
{ "id": "climb-sound", "kind": "ambience", "source": { "fromVideo": "s1", "inSec": 0, "outSec": 3 }, "from": "s2", "volume": 0.5 }
```

In the editor the same thing is **Add audio → From Video**: pick a video in the project (videos without a detected audio track show **No audio** and cannot be picked), optionally trim In/Out and preview it, and **Add audio** places the audio clip at the playhead. The audio is decoded into its own WAV asset where the browser can decode it (Web Audio, including iOS Safari and Android Chrome); otherwise the new asset plays the video file's own sound. **Mute original video clip** (shown when the video is on the timeline) mutes those clips' sound in the same undo step.

### 2.9 Last-frame references, reference sheets and self-contained prompts (P2B)

- **`<shot id>.lastframe`.** Anywhere an asset id goes (a shot's `assets` and `references`, a keyframe's or an asset's `references`), `"<shot id>.lastframe"` names the last frame of that shot's clip without declaring an asset. The importer adds an implicit `frame` asset with that id, named `Last frame · <shot title>`, with `source: { "type": "lastFrame", "shot": "<shot id>" }`. It is not written back on export. When a video version of that shot is uploaded or picked, or its trim changes, the app extracts the frame at the trim end automatically and adds it as a version of the asset. The id is reserved: declaring an asset with it is an error, as is referring to an unknown shot, to the shot's own last frame, or creating a loop. See RULE 35; the declared `lastFrame` asset (RULE 3) still works.
- **Reference sheets.** Character prompts describe a multi-angle turnaround sheet, and every important prop gets its own `prop` asset with a reference sheet (RULE 32). An `identity` reference line says that the sheet's layout must not be copied (RULE 16).
- **Self-contained prompts.** Each asset and clip may be generated by a different agent that sees only that prompt and its images (RULE 31). When copying a clip prompt, the app adds a `Consistency:` block after the `References:` block (the meta style plus one line for each attached character, prop, location and style asset), unless the prompt already has one.
- **HTML assets as references.** An `html` asset may list `references`, and other assets may reference an html asset. The html asset's copy prompt names them under "Code references" and asks for the clip to be written in JavaScript through `dionysus.clip` (RULE 33).

### 2.10 Series assets (P5)

A **Series** is a library of assets shared by every episode of a show: characters, props, locations, styles (any reusable asset), each with its definition, states, reference sheets and all their versions. It lives in the browser's local storage. Each episode is an ordinary project that belongs to one Series (Project settings → Series, or the Series picker when creating a project).

Two optional asset fields connect a storyboard to its project's Series:

| Field | Type | Meaning |
|---|---|---|
| `seriesRef` | string | The id of a Series asset. Write only `{ "id": "<id>", "seriesRef": "<id>" }`: the importer fills in the name, type, prompt, references, states, QA and the chosen uploads from the Series. The board asset stays **linked**: edits in the Series (or to the linked asset in any episode) show in every episode. Extra fields next to `seriesRef` are ignored, with a warning: the Series definition wins. `id` may differ from `seriesRef` (default: the same id). |
| `series` | `true` | Add this asset to the project's Series when the board is applied ("promote"), then link it. If the Series already has an asset with this id, the board links to it instead (dedupe by id) and its uploads are added to the Series' versions. Ignored with a warning on last frames, keyframes and when `seriesRef` is also set. |

Import rules:

- A `seriesRef` that the Series doesn't have is an **error** that lists the Series asset ids. The rest of the board is still checked.
- When the project isn't in a Series, a bare `seriesRef` is an error ("this project isn't in a Series"); a full definition with `seriesRef` imports as the episode's own copy, with a warning.
- Series assets that a referenced asset is made from (its `references`, its states' references) are added to the board as linked assets too, with a warning.
- States of a linked asset are linked with it (`"<id>@<state>"` works as usual).
- Export writes linked assets back as their full definition plus `seriesRef`, so the file also opens outside the Series.

Example: episode 6 of a series whose library has `mira` (character, states `rain`) and `harbour` (location). Only the new prop is defined, and it joins the Series:

```json
"assets": [
  { "id": "mira", "seriesRef": "mira" },
  { "id": "harbour", "seriesRef": "harbour" },
  { "id": "compass", "name": "Grandfather's compass", "type": "prop", "prompt": "Antique brass pocket compass …", "qa": ["Brass case, cracked glass"], "series": true }
],
"shots": [
  { "id": "s1", "title": "Mira at the harbour", "durationSec": 5, "prompt": "…", "assets": ["mira@rain", "harbour", "compass"], "qa": ["…"] }
]
```

**Detach.** On the board, *Detach from series* keeps the episode's current definition and versions and stops following the Series. **Promote.** *Promote to series* adds a board asset (with all its versions and states) to the Series and links it.

**Prompts.** When the project is in a Series, the copy prompts (full and short) and the agent's `get_guide` end with a **SERIES ASSETS** section: the Series name and one line per asset (`"id" (type) Name — short description · states: …`), so a planner AI writing a new episode reuses the ids (RULES 41-43).

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
| textStyle | `plain`, `caption`, `outline`, `neon`, `pop`, `typewriter`, `glow`, `echo`, `soft-shadow`, `cinematic`, `sci-fi-caption` (P7: bottom-right location/date stamp, Share Tech Mono, digit scramble) |
| effect (text styling) | `glow`, `neon`, `hollow`, `echo`; used in `style.effect` (V2-SB-127) |
| audioFx | `pa-announcement`, `hall`, `room`, `telephone`, `radio`, `underwater`, `robot`; used in `audio[].fx` (P3B) |
| blend | `normal`, `screen`, `add`, `lighten`, `multiply`, `darken`, `overlay`, `soft-light`; used in `layers[].blend` (V2-SB-128) |
| fonts (curated ids, not presets) | `sans`, `serif`, `mono`, `impact`, `rounded`, `hand`, `script`, `condensed` (system fonts), plus the bundled sci-fi fonts **(new, P7)** `orbitron`, `share-tech-mono`, `audiowide`, `rajdhani`, `exo-2`, and **(new, P8)** `chakra-petch`, `oxanium`, `saira`: SIL OFL, self-hosted with the app (public/fonts/, licences next to them), never fetched from a third party, waited for before export and packed into project files (`fonts/`). |

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
| An unknown field on an asset state, or a state no shot, layer or asset uses (V2-SB-136) | Warn; the field is ignored. |
| `chromaKey` on a text layer, a colour that is not `#rgb` / `#rrggbb` or a known name, or `range` / `spill` outside 0–1 (P3B) | Warn; ignore the key (or the bad value, using the default). |
| Audio `volumeKeys` that is not a list, or a point with `t` < 0 or `v` outside 0–2; unknown `fx` preset or `amount` outside 0–1 (P3B) | Warn and drop the point / play without the effect (the id is kept) / clamp the amount. |
| Unknown `blend` id, or `opacity` outside 0–1 (V2-SB-128) | Warn; draw normally / ignore the opacity. The blend id is kept for export. |
| `follow` other than `"frame"` or `"shot"`, or `"shot"` with nothing moving the shot during the layer | Warn and ignore (§2.5). |
| `captions: true` without `dialogue` | Warn and do nothing. Non-boolean `captions` also warns. |
| `clip` on a `render: "ai"` shot | 3.0: warn and ignore. 3.1: the shot's clip (a `video` asset). |
| Unknown font id | Warn and use `sans`. |
| Unknown `references[].role`, or the same asset twice in `references` | Warn; the role is used as `detail`, the repeat is ignored. |
| `"end-frame"` in an asset's `references` (V2-SB-123) | Warn; used as `detail` (an image has no end frame). |

**Errors.** The import is rejected for:
- an unknown asset id in `clip`, a layer `asset`, `assets` or `references`;
- more than one `start-frame` or more than one `end-frame` in a shot's `references`, or more than one `start-frame` in an asset's `references`;
- a `clip` of the wrong asset type for its `render`;
- `render: "html"` without `clip`, or `"still"` with neither `clip` nor `background`; an invalid `background` (bad colour, fewer than 2 or more than 8 stops, `at` outside 0–1);
- an asset whose id is a `<shot id>.lastframe` or `<shot id>.background` id, or a `.lastframe` reference to an unknown shot;
- a layer with both `position` and `box`, or with neither (except for `html`, `image` and `video` layers, which require `box` and reject `position`);
- a `box` with a width or height <= 0;
- `endSec <= startSec`, `endSec > durationSec`, a negative `startSec`, or a layer without `startSec`/`endSec`;
- duplicate layer ids within a shot;
- an unknown `render` or layer `type`, a layer `asset` of the wrong type, a text layer without `text`, or an effect without `preset`;
- an `html` asset with a `lastFrame` source, or a generated `html` asset without a `prompt`;
- (V2-HTML-PARAMS) an invalid asset `params` declaration (bad key, unknown `type`, a missing or invalid `default`, `min` > `max`, empty select `options`), a shot or layer `params` that isn't an object, a value that isn't a string, number or boolean, or a value of the wrong type for its declared param (a select value not in `options`, a colour that isn't `#rrggbb`).

- (V2-SB-136) invalid asset `states` (on a `video`, `audio` or `html` asset; not a list; a state without an id, with `.` or `@` in its id, a duplicate id, a bad `source` or a generated state without a prompt), a `"<asset id>@<state id>"` reference to an unknown asset or state, or a state made from another state of the same asset;
Every error and warning carries a JSON path (for example `shots[2].layers[0].endSec`) that the import screen highlights in the pasted text.

**Mapping notes**

- **Placement:** `box` and `position` map to the layer clip's Transform. Positions are fractions times the frame size. A text `box` maps to the box centre (the text is centred there, sized as in §2.5); a `position` is the centre itself. Media layers fill their `box`.
- **Transitions:** a connection's transition becomes `transitionIn` on the incoming (`to`) clip, only when the two clips are adjacent on the main track. `params.durationSec` (default 0.5 s) is clamped to half the shorter clip. An unknown transition id is a plain cut.
- **Effects:** each shot effect becomes an effect-layer clip over the shot's time range (or its sub-range), linked to the shot's clip.
- **Linked layers:** text layers become text clips in the Text & Stickers group; html, image and video layers become clips in the overlay group, using the selected version of their asset (a layer whose asset has no upload yet is skipped). They are linked to the shot's clip and follow it when its version changes (the same mechanism as storyboard send-to-timeline linked clips). Copies of a linked clip are ordinary clips. An unknown text animation or effect id is dropped (none).
- **Version swaps:** when the shot's clip is swapped to another version with a different length, linked layers and effects are **clamped** to the clip's new length (ranges are trimmed; ones that would start after the end are shortened to the end), never dropped.
- **Captions:** `captions: true` writes `dialogue` (a list: its lines' `text`, V2-SB-135) into the shared subtitle text layer for the shot's range (a "Subtitles" layer is created when the project has none).
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

### 4.6 Export and re-import (P2A)

**Export.** *Export* (desktop header; the ⋯ menu on phones) writes the current board, with every board edit, as `dionysus.storyboard/1` JSON: **Download .json** saves `<title>.storyboard.json`, **Copy** puts the same text on the clipboard. Asset states, keyframes, a still or HTML shot's `clip`, references and dialogue are written back in their source form, so the export **round-trips**: importing it gives the same board (ids, order, prompts, checks, connections, audio). Uploads, version picks and trims are not part of the format; they stay in the project.

**Re-import (merge by id).** On a board that already exists, *Import revised JSON…* validates the new JSON as usual and then shows what it would do, matched by `id`:

- **New:** assets and shots whose id is not on the board are added.
- **Changed:** existing ids whose fields differ, listed with the changed fields (prompt, references, checks, length, layers …). Title, settings, shot order, connections and audio changes are listed under "Also updated".
- **Removed:** ids that are missing from the new JSON. Applying asks to confirm first; their uploaded versions stay in the media library.

**Apply changes** keeps, for every id that still exists, its uploads (versions), picked version, trims, production step order, timeline links and checks (a check whose text is unchanged keeps its id and result). **Replace instead…** (behind a confirm) discards everything and imports the JSON as a new board. Either is one undo step. Because matching is by id, the AI must keep ids stable (RULE 30).

### 4.7 Send modes (P2A)

The first *Send to timeline* places every ready shot and audio cue. Once clips from the board are on the timeline, *Send* asks how to send:

- **Update timeline** applies only what changed since the last send: ready shots that are not placed yet are appended, clips whose picked version changed are swapped in place (keeping position, trim and effects), shots whose text layers, effects or params changed since they were sent are refreshed, edited audio cues are re-placed and new cues are added. Clips you placed or edited by hand are not touched. The dialog summarises what will happen ("up to date" when nothing changed).
- **Replace timeline…** (danger, behind a confirm) clears the timeline and rebuilds it from the board in story order. Undo brings the previous timeline back.

Both buttons, and every button in the re-import and export panels, are at least 44 px tall.

### 4.8 Storyboard parts and WebMCP (P4C)

A long storyboard can be imported in **parts**. A part is a JSON object with a `"part"` object (`index`, `of`, optional `after` and `remove`), or with no `"meta"` but some of `shots`, `assets`, `audio`, `connections`. When a board already exists, Import merges the part by id: an entry with an existing id is replaced (connections match by `from`/`to`), new entries are added (new shots after `part.after`, `null` = first, else at the end), ids in `part.remove` are deleted (with their connections), and any `meta` fields are merged. The merged board is checked by the normal rules (errors are reported with paths prefixed "merged"), then shown as a diff and applied as one undo step. A part imported with no board is an error that asks for part 1 first. Rule `long-story-parts` tells the AI to outline first and then write the parts.

Agents in WebMCP-capable browsers can edit the board with tools instead; each tool call is validated by the same rules and is one undo step. See [WEB_MCP.md](WEB_MCP.md) and rule `web-mcp`.

### 4.9 Series export and import (P5)

- **Series zip** (Series library → Export): `manifest.json` with `"format": "dionysus.series"`, `series.json` (the Series: definitions, descriptions and version records) and every media file its versions use.
- **Episode zip** (Projects → Export): the usual project archive, plus `series.json` holding only the Series assets the episode uses (and the ones they are made from); their media are bundled.
- **Import** of either: when a Series with the same id exists here, it is **reconnected** (missing assets are added; for an asset in both the newer definition wins and versions are combined by id); otherwise the Series is **created**. An imported episode belongs to that Series and its linked assets follow it.

### 4.10 Sync to Storyboard (P10-SYNC)

The **Sync to Storyboard** button (timeline toolbar, mobile tool row "Sync board", and "Sync from timeline" on the storyboard) writes timeline edits back to the board after a review sheet listing every change (confirm step; one undo step):

- Shot main clips write back `durationSec`, order, and the version trim; their layers (text/opacity/start/end), effects and audio cues (`atSec`, `durationSec`, `volume`) are updated.
- P13: where layers are goes back too — a moved or resized media layer writes its `box` (the inverse of Send's contain-fit, only when the clip moved from where its box puts it), a moved text layer its `position` (or its `box`, moved, keeping its size). Editing a shot's caption clip writes the text back to `dialogue` (per line into `lines` when the line count still matches, else `dialogue` and `lines` dropped); deleting it sets `"captions": false` (the dialogue is kept).
- A main-track clip with no shot becomes a new shot `shot-tl-N` (empty prompt) with `"needsPrompt": true`. A clip on another track becomes a layer `tl-layer-N` or audio cue `cue-tl-N` of the shot its link parent belongs to, also `"needsPrompt": true`. The board and the sync sheet show "⚠ Needs description / prompt".
- A shot, layer or cue whose clip was deleted is **not** deleted: it gets `"removedFromTimeline": true` (cleared when the clip comes back).
- Export JSON carries both flags; re-import merges by id. `needsPrompt` is cleared once a shot has a `prompt` (or a layer/cue has a `description`). RULE 47 tells the AI to fill these items. WebMCP: `sync_to_storyboard`, `list_needs_prompt`.

| Field | On | Meaning |
|---|---|---|
| `needsPrompt?` | shot, layer, audio cue | `true` = made from the timeline by Sync; fill `prompt`/`description`. Dropped on import once filled. |
| `removedFromTimeline?` | shot, layer, audio cue | `true` = its clip was removed from the timeline; kept, skipped by Update timeline for layers/cues. |
| `description?` | layer, audio cue | Free text describing the item (fills `needsPrompt`). |

Example after a sync:

```json
{ "id": "shot-tl-1", "title": "Timeline clip 1", "durationSec": 4, "description": "", "prompt": "", "needsPrompt": true }
```

### 4.11 Insert shots with AI (P21)

**Insert shot after** (shot ⋯ menu, desktop context menu or phone action sheet) now offers **Blank shot** (the old behaviour: the new-shot editor) and **Plan with AI**. Plan with AI is a side panel on desktop and a bottom sheet on phones (touch targets ≥ 44 px) with four steps:

1. **Describe**: a required textarea *Briefly describe the last shot*, prefilled with the shot's description. The user confirms or edits it; **Continue** is disabled while it is empty.
2. **Prompt**: a copyable planning prompt (`storyInsert.buildInsertPrompt`) with the last-shot description, the neighbouring shots (two before and after: id, title, clip, duration, dialogue), the task "insert one or more shots after shot X", every asset and clip (id, type, generated or not, short description) with the instruction to reuse them and write prompts only for new clips, the asset types and where each may go (a shot without `render` is an AI shot, so its `clip` must be a `video` asset; `html` assets are `render: "html"` shots or html layers; `image` assets are `render: "still"` shots, image layers or references), the relevant guide rules (quoted by number, including RULE 55) and the strict answer format. **Copy prompt** copies it.
3. **Paste**: the AI's answer (raw JSON, a fenced block or chat text around it). **Check** validates it (`storyInsert.applyInsertJson`); errors stay on this step.
4. **Preview**: the shots to insert (number, title, clip, duration, layers, audio, dialogue) and every asset or clip they use, marked **Needs generation** (new) or **Reused** (with "generated" when a version exists), plus the warnings the insert brings in. **Insert N shots** applies it.

Answer format:

```json
{"schema":"3.1-insert","insertAfter":"s2","shots":[{"id":"s2b","title":"Close on the lantern","description":"…","durationSec":3,"clip":"s2b-clip","inSec":0},{"id":"s2c","title":"Reaction","description":"…","durationSec":2.5,"clip":"s2-clip","inSec":4}],"newAssets":[{"id":"s2b-clip","type":"video","name":"Lantern key close-up","aspect":"16:9","assets":["keeper","lantern"],"prompt":"References: …"}]}
```

Validation: `schema` must be `"3.1-insert"`; `insertAfter` must be an existing shot and the one the user chose; `shots` must be non-empty and use new ids; `newAssets` must not repeat existing assets (reuse them by id); optional `audio` adds cues. The new assets are appended and the shots spliced in after `insertAfter`; a connection from `insertAfter` to the next shot moves to the last inserted shot. The whole document then goes through `validateStoryboard`, so unknown ids, duplicate ids, a `prompt` on a shot (warning), a `frameOf` without `frameDesc` and every other importer rule apply; only warnings the insert adds are shown, with paths named by id.

**Error scope (P22).** Only issues in the inserted shots, the new assets, new audio cues and connections touching an inserted shot block **Insert**. Problems that were already on the board (for example a generated asset without a prompt, or a layer that ends past its shot) are listed separately under a collapsed **Existing storyboard issues (not blocking)** section; an error in an existing asset that an inserted shot uses is shown as a warning. Blank AI shots (no prompt and no clip yet) are a valid board state and are treated as `needsPrompt` to-dos, not errors. The board's own shots and assets are kept unchanged by the insert. Confirm merges the result (`mergeStoryboardDoc`) as **one undo step**; following shots are renumbered (numbers come from the order). The same flow is the WebMCP tool `plan_insert_shots` (without `insertJson`: the prompt; with it: validate and insert).


**Example: screen insert (P23).** html or code content as the main picture with a green-screen device overlay keyed on top. Use `render: "html"` whenever the shot's own picture is an html asset (here the app UI); the device is a video layer with `chromaKey`, drawn above the main track, so the keyed screen reveals the html. The device clip may be generated: its prompt must ask for a flat, uniform, evenly lit pure green screen, no green elsewhere and a static camera (RULE 56).

```json
"assets": [
  { "id": "study-ui", "name": "Study issue UI", "type": "html", "aspect": "16:9", "prompt": "An AI coding assistant panel: the submitted prompt 'Study Issue #941', a thinking indicator, then investigation notes appearing line by line; dark theme, content centred" },
  { "id": "laptop-greenscreen", "name": "Laptop (green screen)", "type": "video", "aspect": "16:9", "genDurationSec": 4,
    "prompt": "Locked-off medium close-up of an open silver laptop on a wooden desk in a dim office, the laptop screen is a flat, uniform, evenly lit pure green (#00ff00) with no reflections, glare, text or cursor, nothing else in the frame is green, no hands, static camera" }
],
"shots": [
  { "id": "s43", "title": "AI reviews the issue", "durationSec": 3, "render": "html", "clip": "study-ui",
    "layers": [ { "id": "s43-laptop", "type": "video", "asset": "laptop-greenscreen", "startSec": 0, "endSec": 3,
                  "box": { "x": 0, "y": 0, "width": 1, "height": 1 },
                  "chromaKey": { "color": "#00ff00", "range": 0.4, "spill": 0.5 } } ] }
]
```

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
- **EXAMPLE** is a short, neutral storyboard ("First Light", 5 shots) that imports with no warnings and shows reusable assets, multi-angle character and prop reference sheets, a self-contained clip prompt with a `Consistency` paragraph, reference roles, last-frame continuity through `"s1.lastframe"`, an html asset with references, a still credit shot with a gradient `background` and a text layer, `genDurationSec`, a text layer, a 2 s screen-blend video overlay cut from a 6 s clip (asset `genDurationSec` + layer `inSec`, V2-SB-133), effects and a transition, a chroma-keyed green-screen video layer, an ambience volume curve and a `hall` effect on the sting (P3B). The storyboard tests use their own fixture (`src/v2/domain/__fixtures__/lanternKeeper.ts`), so the example can change freely.

**Rule numbers are stable.** Rules are cited by number (here, in user prompts and by other AIs), so `RULE_LIST` in `storyPrompt.ts` is append-only: new rules go at the end, existing rules are never reordered or deleted (rewrite a rule's text to retire it). `aiGuide.test.ts` pins the key order, checks that every `RULE n` this document cites exists and that the list below matches the generated rules. The rules section is:

```
RULES
1. Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions. When one of them changes during the story (a lamp lit, a coat soaked, a street at night), give that asset "states" (RULE 29) instead of a separate asset.
2. Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt.
3. When a shot must continue seamlessly from the previous one, use "<previous shot id>.lastframe" (RULE 35) in the next shot's "assets" or as its "start-frame" reference (or declare a "frame" asset with "source": { "type": "lastFrame", "shot": "<previous shot id>" } when it needs its own name or checks), and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.
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
16. Character assets are multi-angle reference sheets (RULE 32). When a sheet is an "identity" reference, its line in the "References:" block says it is a reference sheet: keep the identity (face, body, clothes), never reproduce its layout (several views, panels, labels). For a shot that needs one exact pose, a keyframe (RULE 18) made from the sheet works better than the sheet alone.
17. An asset made from other assets lists them in its "references" in attach order, as objects with a "role" when the use is not obvious from the type. Its prompt then starts with the same numbered "References:" block as a clip prompt; for an image, "start-frame" means the base image to edit (there is no end frame). Example: a close-up of the hero holding a mug: "references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"], prompt "References:\nImage 1 (Blue mug): reference only: materials, colours and objects only; glaze and colour only.\nImage 2 (Hero): reference only: keep this identity (face, body, clothes).\n\nClose-up of …".
18. Keyframe then animate: when the opening composition matters (a character's pose, a precise layout, a hero product shot), give the "ai" shot a "keyframe": { "prompt", "references", "qa" }. The app turns it into an image asset "<shot id>.keyframe" named "Keyframe · <shot title>" that is made first. Numbering of the clip's images when a shot has a keyframe: Image 1 is always the keyframe, the START FRAME; Image 2, 3 … are the shot's "references" in their order, then the shot's other "assets" in "assets" order (the numbering without a keyframe, shifted by one). Do not also give the shot a "start-frame": one in "references", or an inferred one (a "frame" or last-frame asset), is attached as details only. The keyframe's own "references" are numbered separately, from Image 1, in the keyframe prompt; they are attached to the clip only if they are also in the shot's "assets" or "references". Other shots and assets may reference this keyframe as "<shot id>.keyframe" (RULE 26). The keyframe prompt describes one still image (with its own "References:" block, as for an asset); the clip prompt starts with a "References:" block in the clip numbering above and then describes only the motion from that frame. Example: "keyframe": { "prompt": "References:\nImage 1 (Hero): reference only: keep this identity (face, body, clothes).\nImage 2 (Café): reference only: materials, colours and objects only.\n\nThe hero sits at a café table, both hands around a blue mug …", "references": ["hero", "cafe"], "qa": ["The hero's face matches the reference"] } with the shot's "assets": ["hero", "cafe"], clip prompt "References:\nImage 1 (Keyframe · Morning coffee): START FRAME: the clip opens on exactly this image.\nImage 2 (Hero): reference only, not a frame: keep this identity.\nImage 3 (Café): reference only, not a frame: materials and colours only.\n\nShe slowly lifts the mug …".
19. Audio: put each voiceover, music bed or sound effect in "audio" as a cue on an asset of type "audio" (source "generate" with a prompt for the user's voice/music/sound tool, e.g. the exact voiceover script and voice, or "upload"). "from" is the shot it starts in, "atSec" the offset into that shot, "to" the last shot it plays under. A music bed usually runs "from" the first shot "to" the last with "volume" 0.2-0.4 under speech; a voiceover spans the shots it describes; a sound effect sits at the moment in one shot ("atSec") with no "to". Example: { "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }, { "asset": "door-slam", "kind": "sfx", "from": "s4", "atSec": 1.2 }. Background sound under several shots is kind "ambience" and a short musical hit at one moment is a "sting" (RULE 27). Do not put spoken lines that the video model renders (shot "dialogue") into a voiceover too; a voice heard in the scene but not seen is an off-screen dialogue line, not a voiceover (RULE 28).
20. Layers stay fixed to the frame by default: a shot's video effects (e.g. "ken-burns" zoom and pan) move only the picture, so titles, labels and logos stay put and readable. Give a layer "follow": "shot" only when it belongs to the scene and must move with the picture, e.g. a name tag pinned to a sign or a label on an object while the shot slowly zooms: { "id": "tag", "type": "text", "text": "ROOM 12", "startSec": 0, "endSec": 4, "position": { "x": 0.62, "y": 0.4 }, "follow": "shot" }. It only has an effect when an effect moves or zooms the shot while the layer is on screen.
21. Keep text readable on any picture: give light text an outline ("strokeWidth" about 0.04-0.08 with a dark "strokeColor"), a soft "shadow", or a "background" box (captions, lower thirds). Use "letterSpacing" (in em) for airy titles, "lineHeight" for multi-line cards, "italic" for emphasis, and a text "effect" with "effectColor" only for stylised titles. Sizes and offsets are fractions of the font size; null removes a style's shadow or background. Example: "style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000", "shadow": { "color": "#000000", "blur": 0.3, "x": 0, "y": 0.04 } }. Put a look used on several layers into "meta.textStyles" once.
22. For overlays (light leaks, flares, dust, film grain, paper or ink textures) use an image or video layer with a "blend" mode and, if needed, an "opacity" below 1: "screen" or "add" for elements on black (the black disappears), "multiply" for elements on white (the white disappears), "overlay" or "soft-light" for textures on mid grey. Example: { "id": "leak", "type": "video", "asset": "light-leak", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen", "opacity": 0.7 }. Ask for the overlay asset full-frame on a plain black, white or grey background. Leave "blend" out ("normal") for titles, logos and pictures that should simply cover the shot.
23. An "html" asset's "prompt" is a design brief for the AI that will write the clip, not code: what it shows, how it moves over its length, colours, type and layout. List the media it uses (logos, photos, footage, music) in its "references"; the app copies the brief together with the HTML clip package instructions (format "dionysus.htmlclip/1", spec HTML_CLIP_PACKAGE.md next to this guide), filled in with the asset's size, length, bound assets and allowed libraries, and the user pastes the AI's single .html file back as a version.
24. Reuse one "html" asset with "params" instead of duplicating it: when shots or layers show the same design with different words, numbers or colours (title cards, text-only cards, chapter and end cards, lower thirds, counters), make ONE html asset, declare what varies in its "params" ({ "<key>": { "type": "text" | "number" | "color" | "boolean" | "select", "default": …, "label"?, "description"? } }, numbers may add "min", "max", "step", a select lists its "options"), and give each use its own values: a text-only shot is { "render": "html", "clip": "<asset id>", "params": { "text": "THE END" } }, a layer over a shot is { "type": "html", "asset": "<asset id>", "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "params": { "text": "5:58 AM" } }. Omitted keys use the default; a value must match its type (numbers within min–max, a select one of its "options", colours "#rrggbb"). The brief describes the design for any value (long and short text) and names the params; the app tells the clip's AI to expose exactly these params and read them at render time. Keep plain captions over a shot as text layers.
25. A "video" asset shown as a layer (a light leak, dust, smoke, a screen insert) is often generated longer than the layer needs, because video models have minimum or fixed lengths. Give the asset "genDurationSec" (the length to generate, 0.5-120, video assets only) and give each video layer "inSec": the second of the clip the layer starts from (default: the part the user picks when uploading, else 0). The layer still lasts endSec - startSec; keep inSec + that length within genDurationSec. One generated clip can feed several layers with different "inSec" values. Example, a 2 s screen-blend overlay cut from a 6 s clip: asset { "id": "dust-leak", "type": "video", "genDurationSec": 6, ... } and layer { "id": "s3-dust", "type": "video", "asset": "dust-leak", "startSec": 0, "endSec": 2, "inSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen" }. For a shot's own clip use the shot's "genDurationSec" instead (RULE 13).
26. A shot's keyframe (RULE 18) can be reused: another shot, another keyframe or an asset may list "<shot id>.keyframe" in its "assets" or "references" like an asset id, with any role: "start-frame" to open on exactly that composition (returning to the same set-up), "identity" for a pose or character, "look" for the same light and palette, "detail" for materials and colours only. A plain id is treated like a "frame" asset (a start frame, or details only when the shot already has a start frame or its own keyframe). That shot must have a "keyframe", a shot can't list its own, and there must be no loops (a keyframe made from something that needs it first). The app makes the referenced keyframe first and attaches the version picked for it, named "Keyframe · <shot title>" in the References block. Example: shot s3 { "assets": ["hill", "s1.keyframe"], "references": [{ "asset": "hill", "role": "detail" }, { "asset": "s1.keyframe", "role": "look", "note": "same pre-dawn palette and mist" }] }, clip prompt "References:
Image 1 (Hill road): reference only, not a frame: materials, colours and objects only.
Image 2 (Keyframe · The climb): reference only, not a frame: overall look; same pre-dawn palette and mist.

…".
27. Background sound that lasts (wind, rain, traffic, room tone, a crowd) is kind "ambience": a bed "from" the first shot it is heard in "to" the last, looped to fill that span ("loop": false plays it once), default volume 0.5 with 1 s fades in and out. Ask for a loopable 20-60 s recording. A short musical hit or whoosh on a moment (a title appearing, a reveal, a cut to black) is kind "sting" at "atSec" in one shot, with no "to". A "sfx" is a one-off sound at one moment too: never give a sound effect a "to" to make it last, it is not looped and stops when the sound ends; use "ambience" instead. Music repeats only with "loop": true. Example: { "asset": "dawn-wind", "kind": "ambience", "from": "s1", "to": "s3" }, { "asset": "title-chime", "kind": "sting", "from": "s3", "atSec": 1 }.
28. Write a shot's "dialogue" as a list of lines when who speaks matters: { "speaker": "ANNA", "text": "Who's there?" } is said on screen (the video model lip-syncs it); add "offscreen": true for a voice that belongs to the scene but whose speaker is not in frame (behind a door, on the phone, calling from out of shot): nobody in frame moves their lips. It is not a voiceover (narration over the film, an "audio" cue of kind "voiceover"). The app appends a numbered "Dialogue:" block to the clip prompt marking each line on screen (lip-synced) or OFF-SCREEN (heard, not seen); write the clip prompt so the speaker is out of frame and say how the people in frame react. If an off-screen line is recorded separately instead of generated with the clip, also add an "audio" cue of kind "dialogue" "from" that shot with "line" (its 1-based number in the list) and "atSec"; the Dialogue block then tells the model not to voice it. "captions": true shows the lines' words. Example: "dialogue": [{ "speaker": "FRIEND", "text": "You made it!", "offscreen": true }].
29. When a character, location, prop, style, image or frame appears in more than one state (a lamp off and on, a coat dry and soaked, a street by day and at night, a vase whole and broken), keep ONE asset and add its other looks to its "states": [ { "id", "name"?, "prompt", "references"?, "source"?, "qa"? } ]. Refer to a state as "<asset id>@<state id>" anywhere an asset id goes: a shot's "assets" and "references", a keyframe's or another asset's "references", a still shot's "clip", an image layer's "asset". Each state gets its own prompt, checks and versions; its type and aspect are the asset's (not allowed on video, audio or html assets). The app makes the base asset first and attaches it to the state as Image 1 so it stays the same thing (role "identity" for a character, else from its type); list the base yourself in the state's "references" to choose its role, e.g. "start-frame" to edit the base image. State ids use letters, digits, "_" and "-" only; a state can't use another state of the same asset. Write the state prompt with its own "References:" block and describe only what changes. Use the base id for the default look and "<asset id>@<state id>" only where the state shows; don't list both in one shot unless both appear. Example: asset "hill" with "states": [{ "id": "sunrise", "name": "Sunrise", "prompt": "References:
Image 1 (Hill road): the base image to edit: keep the road, hill and valley exactly; change only the light.

The same winding hill road as the sun rises …", "references": [{ "asset": "hill", "role": "start-frame", "note": "the same road and hill; only the light changes" }], "qa": ["Same road, hill and valley as the base image"] }], used by shot s3 as "assets": ["hill@sunrise", "s1.keyframe"]. In "References:" blocks a state is named "<asset name> · <state name>", e.g. "Image 1 (Hill road · Sunrise)".
30. When the user sends back a storyboard to revise (exported from the app, format "dionysus.storyboard/1"), return the WHOLE revised storyboard JSON and keep every id stable: an asset, state or shot that stays keeps its exact "id" even when its name, prompt or place in the order changes, new things get new ids, and an id is never reused for something different. The user re-imports it and the app matches it to the board by id: everything with an unchanged id keeps its uploads, picked versions, trims and checks, and anything whose id is missing is removed after the user confirms. Renaming an id therefore throws its work away; only change an id when the thing is really replaced.
31. Every prompt is self-contained, because a different AI agent, chat or tool may make each asset and each clip and sees only that one prompt plus its attached images. In every clip and keyframe prompt repeat: who is in it and what they look like (face, hair, clothes), the key props, the location, and the style from "meta.style"; never write "as before", "the same as shot 2" or a name the generator can't see. Start with the "References:" block naming each attached image (RULE 13), then a "Consistency:" paragraph (the style bible in one line, then one line per character or prop sheet attached: what must stay the same), then the action. When you leave the Consistency paragraph out, the app adds one built from "meta.style" and the attached character, prop, location and style sheets when it copies the prompt.
32. Write every "character" asset prompt as a multi-angle reference sheet (turnaround): the same person full body from the front, three-quarter, side and back, plus a face close-up; neutral pose, even light, plain background, no text or labels. Every important prop (one that recurs, is handled, or must look the same in several shots) gets its own "prop" asset written the same way: a reference sheet from several angles plus close-ups of its details. Reference sheets usually use "aspect": "16:9". Attach them to every shot and keyframe that shows that character or prop.
33. An "html" asset can list other assets in "references" (images such as a logo, a style frame or a character sheet, or other html clips): the app attaches them to the asset's Copy prompt and names each one ("Code references" for html clips), so the AI writing the clip knows what to match or reuse. Html assets can in turn be references of shots and other assets. Keep html briefs focused on the motion and logic: the app asks the code AI to write the work in JavaScript through dionysus.clip (init / render per frame) with a minimal HTML shell (one <canvas>), and full HTML or CSS only when the design truly needs it.
34. A still shot that is only a colour or gradient with text or graphics on top (a title card, credits, a chapter card) needs no image: give it "render": "still" and "background" instead of "clip": a hex colour like "#000000", or { "type": "linear", "angle": 180, "stops": [ { "color": "#000000" }, { "color": "#1a2a4a" } ] } ("radial" goes from the centre out; 2-8 stops; "at" 0-1 places a stop). Put the words in text layers and graphics in image, video or html layers ("layers", drawn in order on top of the background). Use "clip" or "background", not both. Example: { "id": "s9", "title": "Title", "durationSec": 3, "prompt": "", "assets": [], "render": "still", "background": "#000000", "layers": [ { "id": "t", "type": "text", "text": "PART ONE", "startSec": 0, "endSec": 3, "position": { "x": 0.5, "y": 0.5 } } ], "qa": ["Reads PART ONE"] }.
35. "<shot id>.lastframe" is the last frame of that shot's clip and can be used anywhere an asset id goes (a shot's "assets" and "references", a keyframe's or an asset's "references") without declaring an asset: the app adds a "frame" asset named "Last frame · <shot title>", takes the frame from the clip version picked for that shot as soon as it is uploaded (and again when a different version is picked or it is trimmed), and attaches it in "references" order. Use it with role "start-frame" for seamless continuity (RULE 3) or "look" / "detail" to match a moment. The shot must be an "ai" shot listed before the one using it, a shot can't use its own last frame, and there must be no loops.
36. To put a person, animal or object over a shot without its background, ask for the asset (image or video) shot in front of a flat, evenly lit pure green (#00ff00) screen — blue (#0000ff) when the subject is green — with no shadows on the screen and no green on the subject, then give its layer "chromaKey": { "color": "#00ff00", "range": 0.4, "spill": 0.5 }. "range" (0-1) is how far from the colour is removed (raise it to about 0.5-0.6 if a green fringe is left; lower it if the subject gets holes), "spill" (0-1) takes the green tint off edges and hair. html layers may be keyed too. Example: { "id": "birds", "type": "video", "asset": "birds-green", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 0.6 }, "chromaKey": { "color": "#00ff00", "range": 0.4, "spill": 0.6 } }. Use "blend" instead for elements on black or white (RULE 22).
37. Shape audio cues instead of asking for new recordings: "volumeKeys" is a volume curve over the cue (points { "t": seconds from the cue start, "v": 0-2, 1 = the cue's "volume" }, linear in between, the first and last values hold) — use it to duck music or ambience under a voiceover or title and swell it after, e.g. "volumeKeys": [ { "t": 4, "v": 1 }, { "t": 4.5, "v": 0.3 }, { "t": 9, "v": 0.3 }, { "t": 10, "v": 1 } ]. "fx" adds a sound effect from the audio effects list with an "amount" 0-1: "telephone" for the far side of a phone call, "radio" for broadcasts and walkie-talkies, "pa-announcement" for station or stadium loudspeakers, "hall" or "room" to place a dry voice in a space, "underwater" for muffled sound (underwater, behind a wall), "robot" for machine voices. Example: { "asset": "caller", "kind": "dialogue", "from": "s2", "line": 1, "fx": { "preset": "telephone", "amount": 1 } }. Keep fades ("fadeInSec", "fadeOutSec") for simple starts and ends.
38. Simple music and sound effects (a chime, a notification, a whoosh, a riser into an impact, a short beat, an ambient pad, wind or rain) can be "source": "json" on an "audio" asset instead of "generate": the user's AI writes a "dionysus.audioclip/1" JSON (spec AUDIO_CLIP_FORMAT.md next to this guide: tempo, tracks of synth notes, drums, noise or generated sfx, with volume, pan, reverb, delay, filter and params) and Dionysus renders it, so it is exact, repeatable and editable in the Audio editor. Its "prompt" is a sound brief (what it sounds like, mood, key or tempo, length). Use "generate" for voices, real recordings and full songs; "json" is for audio assets only.
39. For a long video (more than about 15 shots, or whenever one reply would get very long), work in parts instead of one huge JSON. First agree an outline with the user in plain text: the numbered shot list (id, title, length, one-line beat) and the asset list with ids. Then reply with part 1: a complete storyboard ("format", "meta", every asset you already know, and the first batch of about 8-12 shots). Then reply with one part per message, each a JSON object with "format", a "part" object and only what it adds or changes, and no "meta": { "format": "dionysus.storyboard/1", "part": { "index": 2, "of": 4, "after": "s10" }, "shots": [ …s11 to s20… ], "assets": [ …new or changed assets… ], "audio": [ …cues… ], "connections": [ … ] }. The user imports the parts in order (Storyboard → Import) and Dionysus merges each into the board by id: an asset, shot, cue or connection with an existing id (connections by "from"/"to") is replaced, a new one is added (new shots go after "part.after", else at the end), "part": { "remove": ["s7"] } deletes ids, and "meta" fields, when given, are merged. Each part is checked together with the board, so it may only use assets from an earlier part or itself; keep every id stable and don't repeat unchanged shots.
40. If you can call Dionysus tools (WebMCP: get_guide, get_storyboard, create_storyboard, add_shot, update_shot, …) because the user's browser connects you to the open app, edit the board with them instead of writing JSON: call get_storyboard first; create_storyboard when there is none (meta, the assets you know, and the first shot); add each asset before the shots that use it; then add the shots one at a time in story order; make changes with the update_ and set_ tools; call validate at the end and send_to_timeline only when the user asks. Every call is checked by these same rules: a rejected call changes nothing and says why, so fix the arguments and call again. The user sees each change live and can undo it.
41. Series: when the prompt lists SERIES ASSETS, this video is an episode of a series and those characters, props, locations and styles already exist. Reuse them, never redefine them: in "assets" write only { "id": "<series id>", "seriesRef": "<series id>" } (keep the same id so shots read naturally), then use the id, or "<id>@<state>" for a listed state, in shots, references, layers and other assets' references as usual. Dionysus fills in the name, type, prompt, states, QA and the user's chosen uploads from the Series, and adds Series assets they are made from. Extra fields next to "seriesRef" are ignored (the Series definition wins). A "seriesRef" that isn't in the list is an error, so copy ids exactly.
42. Series: give a new asset "series": true when later episodes will need it too (a recurring character, the show's main locations, its style). Leave one-off things out (a prop used once, last frames, keyframes). Without a SERIES ASSETS list the project may not be in a series: then define every asset in full; "series": true is still allowed and is applied when the user adds the project to a series.
43. Series with Dionysus tools (WebMCP): call list_series_assets before adding characters, props, locations or styles; use_series_asset adds one linked to the board; promote_to_series marks a board asset for the Series. Editing a linked asset's definition changes it in every episode, so only do that when the user asks; otherwise ask them to detach it first (Asset → Detach from series).
44. An effect's "applyTo" picks the picture it changes: "main" (the default) changes only the shot's own clip, under every layer, so titles and overlays stay fixed; "overlay" changes only the shot's image, video and html layers (e.g. shake a sticker or blur a screen insert, leaving the shot still); "all" changes the whole composited frame — the shot, its overlays and its text together — like moving the camera over the finished picture. Use "all" when an overlay frames or keys the shot, e.g. a TV-set overlay with a green-screen hole showing the shot: a push-in with "main" zooms only the picture inside the TV, with "all" the TV and the picture zoom together. Example: "effects": [ { "preset": "ken-burns", "params": { "zoom": 0.15 }, "applyTo": "all" } ]. Layers with "follow": "shot" (RULE 20) follow only "main" effects.
45. Typewriter cursor: a text layer with "anim": { "in": "typewriter" } can take "inParams": { "cursor", "blink", "after", "scramble" }. "cursor" is the cursor characters: "" (default) = none; one character ("|" or "_") = a cursor right after the typed text; several ("0123456789", "01", "#$%&") = a decode/scramble effect where each new character flickers through random ones of them for "scramble" seconds (0–1, default 0.15) before it resolves. "blink" = cursor blinks per second after typing (0–6, default 2; 0 = solid). "after" = what the cursor does when typing ends: "blink" (default, keep blinking), "hide" or "fade" (fades out over 0.5 s). Typing lasts "anim.durationSec". The scramble is seeded by time, so preview and export match exactly. For a sci-fi location/date caption use the "sci-fi-caption" textStyle (bundled Share Tech Mono, right-aligned, digit scramble) at the bottom right, e.g. { "type": "text", "text": "SEATTLE / YEAR 2027", "position": { "x": 0.62, "y": 0.9 }, "textStyle": "sci-fi-caption", "anim": { "in": "typewriter", "durationSec": 1.5, "inParams": { "cursor": "0123456789", "after": "fade" } } }. Bundled sci-fi fonts (work offline, packed into project files): orbitron, share-tech-mono, audiowide, rajdhani, exo-2.
46. Link to main: on Send to Timeline every shot layer, caption, effect and audio cue that fits inside its shot is linked to that shot's main clip, so it moves when the shot is moved, reordered or rippled, is cut to fit when the shot is trimmed shorter, goes to the half holding its start when the shot is split, and is deleted with the shot. Write "link": false on a layer or an audio cue to keep it free (e.g. a music bed or a logo that must stay at a fixed time across shot edits); leave "link" out for the default (linked). Only false is meaningful. Example: "layers": [ { "id": "logo", "type": "image", "asset": "logo", "startSec": 0, "endSec": 5, "box": { "x": 0.8, "y": 0.05, "width": 0.15, "height": 0.15 }, "link": false } ]. Audio cues spanning several shots are never linked.
47. Fill needsPrompt: after the user edits the timeline and presses Sync to Storyboard, clips that came from no shot are added to the storyboard with "needsPrompt": true (shown as "⚠ Needs description / prompt"): a main-track clip becomes a new shot (id "shot-tl-N", empty "prompt"), a clip on another track becomes a layer ("tl-layer-N") or audio cue ("cue-tl-N") of the shot it is linked to. You MUST fill every needsPrompt item when you revise the JSON: give a shot a "description" and a full self-contained "prompt" (describe what the clip shows, keep its id, durationSec and order), give a layer or cue a "description". Filling it clears the flag on re-import; never delete those items and never set needsPrompt yourself. Shots, layers and cues with "removedFromTimeline": true had their clip deleted on the timeline: keep them unchanged unless the user asks to drop them. Example: { "id": "shot-tl-1", "title": "Timeline clip 1", "durationSec": 4, "needsPrompt": true, "description": "", "prompt": "" } becomes { "id": "shot-tl-1", "title": "Harbour at dusk", "durationSec": 4, "description": "Wide shot of Victoria Harbour as the lights come on", "prompt": "Wide static shot of a harbour at dusk, ferries crossing, skyline lights switching on, warm-to-blue sky, 24fps cinematic" }.
48. Review the cut: with WebMCP timeline tools, after editing the timeline (or after send_to_timeline) call get_timeline, then review_lint, and look at contact_sheet (and capture_frame at any time you doubt). Fix every error and warning it lists with move_clip, trim_clip, split_clip, delete_clip, set_clip_props and add_clip (gaps and black frames, very short clips, text off the frame, audio clipping, missing media, layers not linked to a main clip, needsPrompt items), then run review_lint again until only notes you chose to keep are left. Never guess clip ids or times: read them from get_timeline.
49. Spatial audio: an audio cue (or, with set_clip_props, a clip with sound) can take "position": { "azimuth", "distance", "width"? } — azimuth in degrees, 0 = in front, -90 = left, 90 = right, ±180 = behind; distance 0 (at the ear) to 1 (far, about 20 m), which lowers the level, darkens the tone and adds reverb; "pan" -1..1 is a shorthand (azimuth = pan × 90). "positionKeys" [{ "t", "azimuth", "distance" }] moves the sound (t = seconds from the cue start). Stereo files already carry their own left/right movement: "width" (0-1, default 1) keeps that image while the pair is placed, so do not set width 0 unless you want it mono; mono files are point sources. Leave music centred unless asked. meta "audioOutput": { "mode": "binaural" } is for headphones (front/behind cues, HRTF); "stereo" (default) is for speakers and phones; "environment" "room" (default) or "outdoor" sets the reverb. Omit all of these to keep the sound unchanged.
50. Frame of another shot: when a shot must start from, or match, a frame INSIDE an earlier shot's clip (not its last frame, RULE 35), e.g. shot 1 is a man at his computer noticing objects on the desk and the camera then pans to reveal a second person, and shot 2 should start from the middle of that move, add to the later shot's "references": { "frameOf": "<earlier shot id>", "atSec": <seconds into that clip>, "role": "start" | "reference", "frameDesc": "…" }. "start" makes the frame the START FRAME of the shot; "reference" attaches it as a reference image only. "frameDesc" is REQUIRED and must say: (1) the camera framing and angle; (2) who or what is visible and where in the frame; (3) where in the source shot's camera move the frame sits (e.g. "midway through the push-in, before the pan"); (4) how this shot uses it. Name the same subjects the source shot's prompt names. The source must be an earlier shot (never the shot itself, never a later one); the user generates the source shot first, then picks the exact frame in the app, so "atSec" is only where the picker starts. Example: "references": [{ "frameOf": "s1", "atSec": 2.5, "role": "start", "frameDesc": "Medium close-up, eye level: the man sits centre-left at the computer looking down at the objects on the desk; midway through shot s1's push-in, before the pan to the second person; used as the start frame of this shot." }].
51. Schema 3.1, clip-centric: write "schemaVersion": "3.1" and keep everything that makes a clip on a "video" asset, its clip: the generation "prompt" (with its "References:" block), "references" (including frameOf entries, RULE 50, and "end-frame"), "genDurationSec", "keyframe", "camera" and the clip's "qa". Wherever another rule speaks of a shot's prompt, references, assets, keyframe or genDurationSec, write it on that shot's clip. A shot never has a "prompt": it is { "id", "title", "description", "durationSec", "clip": "<video asset id>", "inSec"? } plus its layers, dialogue, captions, effects and edit checks. Give each AI shot its own clip (id "<shot id>-clip", name "Clip · <shot title>"); to reuse one generation (the same take seen twice, a wide shot cut into two parts) point several shots at the SAME clip and set each one's "inSec" (seconds into the clip) and "durationSec", and give the clip a "genDurationSec" long enough for every part. The first shot that uses a clip generates it; later shots only trim it. Example: "assets": [ { "id": "s1-clip", "name": "Clip · The climb", "type": "video", "prompt": "References:\nImage 1 (Rider): reference only, not a frame: keep this identity.\n\nThe rider climbs the last stretch …", "references": ["rider"], "genDurationSec": 8, "camera": "Side tracking shot", "qa": ["The rider matches the reference"] } ], "shots": [ { "id": "s1", "title": "The climb", "durationSec": 4, "clip": "s1-clip" }, { "id": "s3", "title": "The climb, later", "durationSec": 3, "clip": "s1-clip", "inSec": 5 } ]. A storyboard without "schemaVersion" is 3.0 (prompts on shots); the app migrates it, but never write that form.
52. To use the sound of a video (the take's own dialogue or ambience, a clip's music), give an audio cue "source": { "fromVideo": "<video asset id or shot id>", "inSec"?, "outSec"? } instead of "asset". inSec and outSec are seconds into the video file; with a shot id they default to that shot's clip span. Do not add an audio asset for it; the app takes the audio from the video. Example: { "id": "audio2", "kind": "ambience", "source": { "fromVideo": "s1", "inSec": 0, "outSec": 4 }, "from": "s3", "volume": 0.6 }.
53. Glitch: for a digital breakup (tech, gaming, hacking, horror jump, a beat drop, a hard scene change) add an effect with "preset": "glitch" over a short range (0.3 to 2 seconds reads best). Params: "intensity" 0 to 1, "frequency" (burst chances over the range, a count), "rgbShift" (red/cyan split in pixels at 1080p), "slices" (bands displaced per burst) and "seed" (same seed = same pattern; change it to vary repeats). It is deterministic, so export matches preview. Use "applyTo" ("main", "overlay" or "all") to glitch only the main picture or only overlays. Example, in a shot: "effects": [ { "preset": "glitch", "startSec": 0, "endSec": 0.8, "params": { "intensity": 0.7, "frequency": 10, "rgbShift": 16, "slices": 10, "seed": 3 }, "applyTo": "main" } ]. Keep it brief; do not run a heavy glitch over calm or emotional shots.
54. Promote an overlay: to make a picture-in-picture or cutaway clip (on an overlay track) the main picture, call the WebMCP tool promote_overlay { clipId, mode, position? } instead of deleting and re-adding clips. mode "replace" (default) keeps the timeline length: main clips under it are trimmed, split or removed, and a split clip continues at the right in point. mode "insert" makes the video longer by the clip's duration and ripples later main clips with their linked layers; when the clip starts inside a main clip, pass position "before" or "after". Blend mode and chroma key are dropped; the transform is kept unless keepTransform is false. After it, run Sync to storyboard: the promoted clip becomes a new shot marked needsPrompt unless its source shot is known, and split parts stay with their original shot.
55. Insert shots after a shot: when the user asks for new shots after shot X (the app's "Insert shot after" → "Plan with AI", or the WebMCP tool plan_insert_shots), answer with ONE JSON object {"schema": "3.1-insert", "insertAfter": "<shot id>", "shots": [...], "newAssets": [...]} (optional "audio": new cues). "shots" are the new shots in order (new ids, 3.1 shot form, no "prompt" on a shot); reuse existing assets and clips by id whenever possible (another part of an existing clip is "clip" + "inSec"), and put only genuinely new assets and clips, with full prompts, in "newAssets" (never repeat existing ones). A shot's "clip" must be a "video" asset unless the shot sets "render": "html" (then an "html" asset) or "render": "still" (then an "image" asset); otherwise show html and image assets as "layers" or use them as references of a clip. The app inserts the shots after X and renumbers the shots that follow.
56. Screen insert (html content inside a device on screen): when a shot shows an app, website, code or UI on a laptop, phone, monitor or TV, make the screen content the MAIN picture and key the device on top of it. The shot is { "render": "html", "clip": "<html asset id>", "durationSec", "layers": [ <device video layer> ] }: "render": "html" is required, because a shot without "render" is an AI shot whose "clip" must be a "video" asset. The device is a "video" layer (an "image" layer for a still device) with "type", "asset", "startSec", "endSec", a "box" (use { "x": 0, "y": 0, "width": 1, "height": 1 } for a full-frame device shot) and "chromaKey": { "color": "#00ff00", "range": 0.4, "spill": 0.5 }; the keyed screen becomes transparent and the html shows through it. Layers are drawn in list order (later on top) and there is no zIndex, so put the device after any layer it must cover and put text layers after it. The device asset's generation prompt must ask for the screen to be a flat, uniform, evenly lit pure green (#00ff00) with no reflections, glare, UI, text, cursor or hands on it, no green anywhere else in the frame (blue #0000ff screen and key colour if the scene is green), and a static or locked-off camera so the screen stays in place; it may be AI-generated (it needs a prompt, and "genDurationSec" if the model's minimum is longer than the layer) or uploaded. Design the html for the screen's area and aspect: the html fills the frame and only the part behind the keyed screen is seen. Example: { "id": "s43", "title": "AI reviews the issue", "durationSec": 3, "render": "html", "clip": "study-ui", "layers": [ { "id": "s43-laptop", "type": "video", "asset": "laptop-greenscreen", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "chromaKey": { "color": "#00ff00", "range": 0.4, "spill": 0.5 } } ] } with the asset { "id": "laptop-greenscreen", "name": "Laptop (green screen)", "type": "video", "aspect": "16:9", "prompt": "Locked-off medium close-up of an open silver laptop on a wooden desk in a dim office, the laptop screen is a flat, uniform, evenly lit pure green (#00ff00) with no reflections, glare, text or cursor, nothing else in the frame is green, no hands, static camera", "genDurationSec": 4 }.
```

### P14-SPATIAL: spatial audio position

Audio cues (`audio[]`) take optional fields; old boards and projects without them render unchanged (no extra processing).

| Field | Type | Meaning |
|---|---|---|
| `position?` | `{ azimuth, distance, width? }` | `azimuth` degrees −180..180: 0 front, −90 left, +90 right, ±180 behind. `distance` **normalised 0..1**: 0 = at the ear, 1 ≈ 20 m (gain 1/(1+3d), lowpass, more reverb, narrower width; behind is also darker). `width` 0..1, default 1. |
| `pan?` | number −1..1 | Shorthand for `{ azimuth: pan × 90, distance: 0 }`. If `position` is also given, `position` wins (warning). |
| `positionKeys?` | `[{ t, azimuth, distance }]` | Moving sound; `t` seconds from the cue start; linear, azimuth the shorter way round. |
| `meta.audioOutput?` | `{ mode: "stereo" \| "binaural", environment?: "room" \| "outdoor" }` | Whole-project output. `stereo` (default, speakers/phones): equal-power pan. `binaural` (headphones): HRTF PannerNode, in preview and export. `environment` picks a generated impulse-response reverb (default `room`). |

**Stereo sources keep their image.** The mixer works in mid/side: the mid `(L+R)/2` is placed by azimuth, the side `(L−R)/2` is kept scaled by `width` (× (1 − 0.5·distance)). So a stereo file at the default centre with width 1 is passed through untouched — never collapsed to mono — and at other positions the whole pair moves with its own L/R movement preserved. A mono file has no side, so it is a point source. `width: 0` folds a stereo file to mono.

Phones: many phone speakers (and some Samsung models' Dolby/"3D" modes) do not reproduce front/behind cues; azimuth then reads as left/right only. Use `binaural` with headphones to hear front/behind.

On Send to Timeline cues copy `position` / `positionKeys` to the audio clip (keys in ticks). Timeline clips and tracks can be positioned in the Audio tab pad or with WebMCP `set_clip_props` (`position`, `positionKeys`, `pan`, `trackPosition`, `audioOutput`). Guide rule 49.

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
