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

### 2.2 `meta`

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required. |
| `logline?`, `synopsis?`, `style?`, `language?` | string | Unchanged. |
| `aspect` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:5"` or `"21:9"` | Unchanged. |
| `textStyles?` **(new)** | `{ "<id>": TextStyle }` | One-off text styles for this storyboard. They are imported as project text styles and can be promoted to the registry later. Layers reference them through `textStyle`. Ids must not clash with registry `textStyle` ids; if one does, the local style wins and the importer warns. |

`TextStyle` = `{ font?, size?, color?, align?, bold?, ... }`, with the same keys as a text layer's `style` (§2.5). Extra keys are kept and passed through.

### 2.3 `assets[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | string | Short and stable. |
| `type` | `character`, `location`, `prop`, `style`, `image`, `frame`, `video`, `audio`, **`html` (new)** | |
| `aspect?` | aspect string | Defaults to `meta.aspect`. |
| `prompt` | string | For `html`, this describes the component (see below) and is required when the source is `"generate"`. |
| `references?` | string[] | Asset ids. No self-references and no loops. |
| `source` | `"generate"`, `"upload"` or `{type:"lastFrame", shot}` | **Future, not v1:** `{type:"template", template, params}` (§6). |
| `qa` | string[] | 2-5 yes/no checks that can be verified by looking. |

**`html` assets** are only for animated, 3D or three.js graphics.
- The asset is never a file path and never inline HTML. Its `prompt` describes the component.
- Guided flow: the user takes the prompt to their own AI, gets back an `.html` file and uploads it into the asset slot. Uploads are versioned like images.
- The app stores the whole HTML document as an asset-version blob. An `html` asset can't use a `lastFrame` source.
- Per-clip config lives inside the HTML, in `<script type="application/json" id="dionysus-clip">`.
- v1 has no params for HTML.

### 2.4 `shots[]`

| Field | Type | Notes |
|---|---|---|
| `id`, `title`, `description?` | string | Unchanged. |
| `durationSec` | number, 0.5-120 | Should match what the video model can generate (RULE 13). This is the length the shot takes in the edit. |
| `genDurationSec?` **(new, V2-SB-121)** | number, 0.5-120, >= `durationSec` | Only for video models that render fixed lengths: the length to generate (for example 8 for a 5 s shot). The uploaded clip is then trimmed to `durationSec` (§4.4). Omitted, or equal to `durationSec`, means "generate `durationSec`". A value outside 0.5-120 or shorter than `durationSec` is ignored with a warning. |
| `prompt` | string | Required when `render` is `"ai"`. Optional for `"html"` and `"still"` (keep it anyway for v1.0 readers). Never asks for text. |
| `assets` | string[] | Asset ids used. Should include `clip`. |
| `camera?`, `dialogue?` | string | Unchanged. |
| `qa` | string[] | 2-5 visual checks. |
| `render?` **(new)** | `"ai"`, `"html"` or `"still"` | Default `"ai"`. The production to-do uses this to choose the step: generate a clip, upload or refresh the HTML, or use the still. |
| `clip?` **(new)** | asset id | Required when `render` is `"html"` (must point to an `html` asset) or `"still"` (must point to an `image` asset). Ignored for `"ai"`, with a warning. The clip renders from the asset's **selected** version (the one the user picked in the asset's version history), not simply the latest upload. |
| `layers?` **(new)** | Layer[] | §2.5 |
| `captions?` **(new)** | boolean | When `true`, the shot's `dialogue` is rendered into the shared subtitle text layer. Has no effect, and triggers a warning, if there is no `dialogue`. |
| `effects?` **(new)** | Effect[] | §2.7 |
| `references?` **(new, V2-SB-120)** | Reference[] | §2.4.1. The images to attach to the clip generation, in order, with their roles. |

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
| `style?` | `{font?, size?, color?, align?, bold?}` | `font` is a curated font id (§3.2). `size` is a fraction of frame height. `color` is a CSS hex value. `align` is `left`, `center` or `right`. `bold` is a boolean; a numeric weight of 600 or more is accepted and mapped to bold. |
| `anim?` | `{in?, out?, loop?, durationSec?}` | Ids of the `textAnimIn`, `textAnimOut` and `textAnimLoop` kinds. `durationSec` applies to in and out. |

Style resolution: the `textStyle` preset is applied first, then the inline `style` overrides it.

**Text sizing.** Text is a single line per `\n`-separated line; it is **never wrapped**.
- With `position`, the text is centred on the point. Its size is `style.size`, else the `textStyle` size, else 0.1 of the frame height.
- With `box`, the text is centred in the box. Its size is `style.size` when given; otherwise it is fitted to the box height (`height / (lines × 1.2)`). The box width does not shrink the text.
- The importer estimates the rendered width from the font's average character width and warns on `<layer>.text` when the text is likely wider than the box (or the frame, for `position`). Use `position`, shorter text or a smaller `size` to fix it.

**HTML layer:** `{id, type:"html", asset:<html asset id>, startSec, endSec, box}`

**Image / video layer:** `{id, type:"image"|"video", asset:<asset id>, startSec, endSec, box}`. These land in the overlay group above the shot.

**Not in v1:** `blend` and `trackMotion`. If either is present, the importer warns and ignores it; it does not reject the file.

### 2.6 `connections[]`

| Field | Type | Notes |
|---|---|---|
| `from`, `to` | shot id | |
| `kind` | `"cut"`, `"continuity"` or `"match"` | Unchanged. `continuity` defaults to a cut. |
| `note?` | string | |
| `transition?` **(new)** | `{preset:<transition id>, params?:{durationSec?, ...}}` | If missing, the connection is a cut. It is stored on the `to` shot's clip as `transitionIn`. It only applies when `from` and `to` are adjacent (consecutive in `shots` order, which is the main-track order); otherwise the importer warns and treats the connection as a cut. `params.durationSec` defaults to **0.5 s** and is clamped to half the shorter of the two clips. |

### 2.7 `shots[].effects[]`

| Field | Type | Notes |
|---|---|---|
| `preset` | videoEffect id | |
| `params?` | object | Keys come from the preset's ParamSpec. Missing keys take their defaults. |
| `startSec?`, `endSec?` | number | Relative to the shot. Default is the whole shot. |

Post camera moves (push-in through `ken-burns`, `shake`) and looks (`bw`, `vignette`) go here, not in the generation prompt.

`fade-in` / `fade-out` `params.length` is a **fraction (0.05–1) of the effect's time range**, not seconds: on a 4 s shot with no `startSec`/`endSec`, `{"length": 0.25}` fades over the first (or last) 1 s. For a fade of N seconds, set `startSec`/`endSec` to an N-second range and keep `length: 1`, or use `length = N / range`.

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
| textStyle | `plain`, `caption`, `outline`, `neon`, `pop`, `typewriter`, `glow`, `echo` |
| effect (text styling) | `glow`, `neon`, `hollow`, `echo` |
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
| Unknown param key, wrong param type, number outside the ParamSpec range | Warn; unknown keys are ignored, wrong types use the default, out-of-range numbers are clamped. |
| Transition `durationSec` <= 0 | Warn and use the 0.5 s default. |
| `genDurationSec` outside 0.5-120 or shorter than `durationSec` | Warn and ignore it. |
| A malformed `transition` (not `{preset}`) | Warn and use a cut. |
| Text likely wider than its box or the frame | Warn (see "Text sizing" in §2.5). |
| `position` outside 0-1, or a `box` reaching outside the frame | Warn. |
| `anim` in + out longer than the layer | Warn. |
| `transition` between shots that are not adjacent on the main track | Warn and use a cut. Keep the transition on export. |
| `blend` or `trackMotion` on a layer | Warn and ignore. |
| `captions: true` without `dialogue` | Warn and do nothing. Non-boolean `captions` also warns. |
| `clip` on a `render: "ai"` shot | Warn and ignore. |
| Unknown font id | Warn and use `sans`. |
| Unknown `references[].role`, or the same asset twice in `references` | Warn; the role is used as `detail`, the repeat is ignored. |

**Errors.** The import is rejected for:
- an unknown asset id in `clip`, a layer `asset`, `assets` or `references`;
- more than one `start-frame` or more than one `end-frame` in a shot's `references`;
- a `clip` of the wrong asset type for its `render`;
- `render: "html"` or `"still"` without `clip`;
- a layer with both `position` and `box`, or with neither (except for `html`, `image` and `video` layers, which require `box` and reject `position`);
- a `box` with a width or height <= 0;
- `endSec <= startSec`, `endSec > durationSec`, a negative `startSec`, or a layer without `startSec`/`endSec`;
- duplicate layer ids within a shot;
- an unknown `render` or layer `type`, a layer `asset` of the wrong type, a text layer without `text`, or an effect without `preset`;
- an `html` asset with a `lastFrame` source, or a generated `html` asset without a `prompt`.

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

## 5. Planner prompt (updated)

**Published guide (V2-SB-114).** The planner material is generated from the registry by `src/v2/domain/storyPrompt.ts` and `src/v2/domain/aiGuide.ts`, and published with the app:

| File | URL |
|---|---|
| `public/ai/storyboard-guide.md` | https://ckfun0skf.github.io/dionysus-ai-video-editor/ai/storyboard-guide.md |
| `public/ai/storyboard-guide.html` | the same guide as a web page (`…/ai/storyboard-guide.html`) |
| `public/ai/presets.json` | machine-readable preset ids, descriptions, params and defaults, and font ids |
| `public/llms.txt` | https://ckfun0skf.github.io/dionysus-ai-video-editor/llms.txt |

Run `npm run gen:ai` after changing presets, fonts, the rules or the example; `aiGuide.test.ts` fails while the committed files are stale.

The app offers two prompts (Storyboard → AI prompt):
- **Short prompt** (default): links to the guide and tells the AI to read it first. An AI that can't open links is told to ask the user for the full prompt instead of guessing the format.
- **Full prompt**: the guide inlined (FORMAT, PRESETS, RULES 1-14, EXAMPLE), for AIs without web access.

The presets section of the planner prompt is **generated from the registry** (only ids listed there may be used): for each kind, it lists every id with a one-line description and its params with defaults. The rules section becomes:

```
RULES
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
13. "durationSec" should match what the video model can generate. If the model only renders fixed lengths (e.g. 5 or 8 s) and the shot should be shorter, keep "durationSec" at the length the edit needs and set "genDurationSec" to the length to generate; the user trims the clip on upload.
14. Every clip prompt starts with a "References:" block that numbers the images attached to the clip in the order of the shot's "references" (else its "assets"): "Image 1 (<asset name>): …", one line each, saying explicitly whether the image is the START FRAME (or END FRAME) or only a reference, and what to take from it (identity, overall look, or materials and colours only, not its framing or wide view). Then state the framing from the first frame to the last. Set "references" with roles whenever the order or use is not obvious from the asset types.
```

## 6. Decisions, open questions and future work

- **Template HTML:** asset `source: {type:"template", template, params}` for registered built-in templates. This needs a template registry and a ParamSpec for templates. Not in v1.
- **`blend`** (layer blend modes) and **`trackMotion`** (layers that follow tracked motion): semantics are still to be defined. Not in v1.
- **Resolved:** `id@N` resolves to the current version with a warning; old render functions are not kept (§3.1).
- **Resolved:** there is no `meta.minImporter`. A v1.0 build reports the unknown asset type with its path, which is enough.
- **Promotion:** the UX and id rules for promoting a `meta.textStyles` entry into the registry.
- **Durations:** whether the planner prompt should list per-model duration limits for RULE 13.

## 7. Worked example

`src/v2/domain/__fixtures__/ep01_opening.storyboard.json` (12 shots) imports with no warnings and shows the following:
- **s03** is `render: "still"` with `clip: "card-still"`. It has a framed text layer (`box`, `textStyle: "plain"` plus inline serif style, fade-in) and a `ken-burns` effect.
- **s07** is `render: "still"` with `clip: "title-bg"`. It has a centred `ALLOTMENT` text layer that uses `meta.textStyles["ata-title"]`.
- **Connections:** s06→s07 uses `dip` (0.5 s) and s07→s08 uses `crossfade` (0.8 s).

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
