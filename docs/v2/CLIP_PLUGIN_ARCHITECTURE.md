# Clip type plugins — architecture

**Status: Accepted** (proposed in P64, accepted 2026-11-15; Phase 1 started in P65 and is **done** since P73; Phase 2
started in P74 after decision 5 was accepted, step table in [§7 Phase 2](#phase-2--deterministic-threejs-scene-clip);
steps 2.1 (P74), 2.2 (P75), 2.3 (P76), 2.4 (P77) and 2.5 (P78) are done; the table was renumbered in P76, see the note under it).
Written against `main` at `36c37b14` (after P63). Decisions: see [§0](#0-decisions). Progress: see
[§7 Phase 1](#phase-1--registry-with-zero-behaviour-change).

## 0. Decisions

Accepted by the owner on 2026-11-15 (the answers to the §9 open questions):

| # | Question | Decision |
|---|---|---|
| 1 | Scene rendering | The scene clip renders **inside the existing sandboxed HTML clip host** (`render/htmlClip.ts`); no in-process WebGL path. |
| 2 | Where scene data lives | An **asset version** (a JSON blob, versionable, works with storyboard slots and Replace), plus per-use overrides on the placement. |
| 3 | New type ids | As this doc proposes: the type id is stored in **`Placement.clipType`** (built-ins keep their ids; the `MediaKind` union stays for built-ins and a branded `PluginClipType` string is added for others); a new type's own data lives in the optional **`Placement.plugin`** field. Older builds treat the clip as an unknown type (§6). |
| 4 | Custom scene functions | **Declarative only** in Phase 2 (GLB animation, material, visibility, state tables); user JavaScript only with Phase 3 sandboxed plugins. |
| 5 | Storyboard `render: "scene"` / asset type `scene` (accepted 2026-11-15, recorded in P74) | **Yes, as recommended:** a storyboard may mark a shot `render: "scene"` and use a `scene` asset type. Both are **optional values within `dionysus/3.1`** (and `dionysus.storyboard/1`); **no version bump**. Older builds reject such a storyboard on import, as with any new optional value; storyboards without them are unchanged. Implemented in step **2.6** (renumbered in P76; it was 2.5). |
| 6 | Per-object sub-tracks | **Late in Phase 2**, after the scene clip, events and WebMCP tools work. *Updated in P76 (owner-confirmed UX):* the per-object tracks live in the scene clip's **own timeline editor** (step 2.3, P76: tracks with selection and forms; step 2.4, P77: drag and resize, done), not under the clip on the main timeline; they come before the WebMCP tools, which then reuse the editor's pure edit operations. |
| 7 | Third-party plugins | **Deferred to Phase 3**; trust and sources are decided then. |
| 8 | Phase 1 size | The **eight small PRs** of §7, one at a time, each merged on green CI. |
| 9 | Placeholder (recorded in P70, 2026-11-15) | A placeholder is a **cross-type clip state**, not an `image` variant or plugin. Any clip type can be a placeholder: a slot with no asset yet that knows its intended type, so asset pickers can filter by it. The player, timeline and export check `placeholder` **first** and use one shared slate renderer before any plugin lookup; plugins never handle placeholders. `blank` stays a small plugin (`image` variant). No schema change. Implemented in **step 1.8** (P73), together with unknown-type handling (§6): `clipTypes/state.ts`, `render/placeholderSlate.ts`, `PLACEHOLDER_UI` in `ui/clipTypeUi.tsx`; `clipTypes/placeholder/` is gone. |

## 1. Why

Dionysus has six clip types (`MediaKind` in `src/v2/domain/model.ts`: `video`, `image`, `audio`, `html`, `text`,
`effect`) plus two flavours of `image` clip (`placeholder`, `blank`). The behaviour of each type is spread over
`if (clipType === …)` checks in about 50 files: the player, export, timeline, inspector, storyboard Send/Sync, the
WebMCP tools and the AI guide. Adding a type (the next one planned is a deterministic three.js **scene** clip) means
editing all of them, and a new developer cannot find them without reading the whole codebase.

The presets already solved this for effects and transitions: one file per preset under `src/v2/presets/<kind>/`,
auto-discovered, validated, and picked up by every surface (`docs/v2/ADDING_EFFECTS.md`). `MODULE_DESIGN.md` §6 also
planned a `clipTypes` registry that was never built. This proposal does the same for clip types.

### Goals

- One folder per clip type, `src/v2/clipTypes/<type>/`: code, tests and a short README. Adding a type is mostly
  adding a folder.
- Every surface (preview, export, timeline, inspector, storyboard, WebMCP, AI guide, validation) asks the registry
  instead of switching on `clipType`.
- Preview and export call the same render code, which depends only on the timeline time `t` (deterministic, as the
  HTML clip runtime already is).
- Every type is AI-definable: it contributes its WebMCP tools, AI guide rules and storyboard mapping.
- Projects stay `dionysus/3.1`: only optional fields; old projects load unchanged; a type this build does not know
  keeps its data and renders a placeholder.
- Phase 1 changes no behaviour: same pixels, same audio, same generated AI files.

### Non-goals

- No change to the track model (`TrackKind`: video/audio/text/effect), effects, transitions, blend modes or presets.
  They stay in the preset registry.
- No GPU compositor rewrite. The player stays a 2D-canvas compositor; plugins draw into it.
- No server, no plugin marketplace. Third-party loading (Phase 3) is from a URL or a zip file the user picks.
- No schema 4.0, no renamed fields, no migrations.

## 2. Where clip types are decided today

The concrete switch points at `36c37b14`. Line numbers drift; search for the quoted code.

| Surface | File | What is hard-coded |
|---|---|---|
| Model | `src/v2/domain/model.ts` | `MediaKind` union; `trackKindFor()` (type → track kind); `isStill`, `canChromaKey`, `hasSound`; `validateComposition()` uses `trackKindFor` |
| Model flags | `src/v2/domain/model.ts` (`Placement.placeholder`, `Placement.blank`) | P35 placeholder and P36 blank are `clipType: "image"` with `TEXT_SOURCE` and a flag |
| Edit ops | `src/v2/domain/ops.ts` | `insertPlacement` caption handling for `text`; linked audio only on `video`; `groupOf` by track kind |
| Range rules | `src/v2/domain/clipRange.ts`, `slip.ts`, `chain.ts` | which types have source time (`video`/`audio`), `canSetRange`, `matchable` |
| Preview + export render | `src/v2/render/player.ts` `draw()` loop (≈ line 392–560) | `effect` skipped (applied by `render/effects.ts`); `text` → `drawTextClip` (`render/text.ts`); `placeholder` → slate (preview) / black (export); `blank` → solid fill; `html` → `HtmlClipHost` (`render/htmlClip.ts`) with params, inputs, manifests; `video`/`image`/`audio` → pooled media elements; `exportVideo` (WebCodecs) only for `video` |
| Media elements | `src/v2/render/player.ts` `element()` (≈ line 205) | `image` → `Image`, `video`/`audio` → media element |
| Preload | `src/v2/render/frame.ts` `upcomingMedia()` | only `audio`/`video` preload |
| Export audio | `src/v2/render/export/plan.ts` `audioPlan()` | skips `image`, `html`, muted linked audio, reverse, freeze |
| Export frames | `src/v2/render/export/encode.ts` | uses `Player` with `offline = true` + `renderAt(t)` (shared with preview) |
| Export warnings | `src/v2/render/export/plan.ts` `classifyPlaceholders`, `countsTowardExport` | placeholder handling |
| Timeline clip | `src/v2/ui/TimelineClip.tsx` | `needsThumb` (video/image/html), filmstrip only for `video`, waveform for audio/video |
| Timeline rows | `src/v2/ui/Timeline.tsx` (≈ line 463–488) | label per type (`effect` name, `text` content, asset name), icons |
| Thumbnails | `src/v2/ui/useThumbs.ts`, `src/v2/ui/useMedia.ts` | grab frame for video/image, render html page, skip audio; filmstrips/peaks |
| Inspector | `src/v2/ui/V2App.tsx` `inspectorTabs()` (≈ line 1143–1205) | `KIND_ICON`; tabs per `kind`: text → `TextPanel`, effect → `EffectPicker`, audio tab, html → Params + Edit code, blank → colour, image → transform/chroma, video → all |
| Mobile toolbar, menus | `src/v2/ui/V2App.tsx` (≈ line 880–1030, 1134, 1270–1290, 1450) | linked-audio actions and Freeze for `video`, Edit code for `html`, `clipName()` per type |
| Other UI | `MaskSheet.tsx`, `AdjustRange.tsx`, `MediaPicker.tsx`, `CleanupDialog.tsx` (`KIND_ICON`), `Transform.tsx`, `TextPanel.tsx` | per-type availability |
| Import | `src/v2/persistence/media.ts` `mediaKindOf()`, `mimeOf()`, `probeMedia()` | file type → kind; probe per kind; html role |
| Storyboard model | `src/v2/domain/storyboard.ts` `kindForSlot()`; `src/v2/domain/storyJson.ts` `STORY_ASSET_TYPES`, `SHOT_RENDERS` (`ai`/`html`/`still`) | storyboard asset type → kind |
| Storyboard Send | `src/v2/domain/storySend.ts` `shotClip()`, `shotClipSpan()`, `addLinked()`, `addAudio()` | length rules (html/still = planned `durationSec`, video = trim/media length, image = default), `htmlParams` for html |
| Storyboard Sync | `src/v2/domain/storySync.ts` | timeline clip type → storyboard layer type and asset type |
| WebMCP schemas | `src/v2/domain/timelineReview.ts` `TIMELINE_TOOLS`, `clipJson()`; `src/v2/domain/storyAgent.ts` `STORY_TOOLS` | 46 timeline tools + 30 storyboard tools; per-type fields in `clipJson` |
| WebMCP runtime | `src/v2/ui/agent/timelineTools.ts` `runTimelineTool()`, `src/v2/ui/agent/mediaTools.ts` | "is not a text clip", "only applies to effect clips", `html` checks |
| WebMCP registration | `src/v2/ui/agent/webMcp.ts` `ALL_AGENT_TOOLS`, `registerAgentTools()` | fixed list: `STORY_TOOLS` + `TIMELINE_TOOLS` |
| AI guide | `src/v2/domain/storyPrompt.ts` `RULE_LIST` (78 rules, append-only), generated by `npm run gen:ai` into `public/ai/*`, `public/llms.txt`, `docs/v2/WEB_MCP.md` tool blocks | rules mention types by name |
| HTML clip runtime | `src/v2/render/htmlClip.ts` (`HtmlClipHost`, `HTML_RUNTIME_JS`), `src/v2/render/htmlLibs.ts` (vendored three.js + GLTFLoader) | sandboxed iframe, virtual time, seeded `Math.random`, frame request/response |

## 3. The plugin interface (sketch)

A plugin is split by **layer**, because `src/v2/architecture.test.ts` forbids `domain` from importing `render` or `ui`
and forbids DOM globals in `domain`/`engine`. One type is therefore three small objects with the same `id`:

- **core** (pure, no DOM): data, rules, storyboard mapping, WebMCP tools, AI rules, validation. Used by domain,
  engine, export planning and the agent tools.
- **renderer** (render layer, may use the DOM/canvas): load, draw, thumbnail, dispose. Used by the player (preview and
  export) and thumbnails.
- **ui** (React, optional): inspector tabs, timeline label/icon/strip, toolbar actions.

```ts
// src/v2/clipTypes/types.ts (core part: imports only domain/registry types)
type JsonSchema = Record<string, unknown>;                   // a JSON Schema (draft 7) object; no new dependency
import type { Placement, Project, Track, TrackKind, MediaRef } from "../domain";
import type { StoryAssetType } from "../domain/storyJson";
// AgentToolDef (new, extracted from STORY_TOOLS / TIMELINE_TOOLS): { name, title, description, inputSchema, readOnly }

export interface ClipTypeCore<Data = unknown> {
  /** Stored in Placement.clipType. Never rename a shipped id. */
  id: string;
  /** Behaviour version (like presets). Bump when the look of existing data changes. */
  version: number;
  /** Which track kind holds it ("video" for visual clips). */
  trackKind: TrackKind;
  /** Capabilities replace the scattered predicates (isStill, hasSound, canChromaKey, needsThumb …). */
  caps: {
    sourceTime: boolean;      // has media time: trim/slip/speed/reverse (video, audio) — canSetRange
    still: boolean;           // holds one source frame; source in stays 0 (image, text, effect) — isStill
    sound: boolean;           // volume, audio fx, spatial, export audio mix — hasSound
    visual: boolean;          // drawn on the canvas (transform, blend, mask, chroma if `keyable`)
    keyable: boolean;         // chroma key applies — canChromaKey
    thumb: boolean;           // timeline thumbnail — needsThumb
    asset: "media" | "none";  // reads a project asset version (video/image/audio/html) or carries its own data (text/effect/scene)
  };
  /** JSON Schema of the type's own placement data (validated on load, import and agent edits). */
  dataSchema?: JsonSchema;
  /** Where that data lives on Placement (existing field for built-ins: "text", "effect", "htmlParams"; new types use `plugin`). */
  dataField?: keyof Placement | "plugin";
  /** File import: which files become this type (replaces mediaKindOf/mimeOf branches). */
  accepts?: { mime?: string[]; ext?: string[] };
  /** Length rules. */
  duration: {
    /** Length of a new clip from its asset (undefined = DEFAULT_IMAGE_TICKS). */
    natural?(media: MediaRef | undefined, data: Data | undefined): number | undefined;
    /** Max length (source end) or undefined = free (stills, html, text, scene). */
    max?(p: Placement, media: MediaRef | undefined): number | undefined;
    /** Storyboard Send length: "planned" (shot.durationSec) or "media" (take/trim length). */
    send: "planned" | "media";
  };
  /** Storyboard mapping. */
  story?: {
    /** Storyboard asset types that become this clip type (kindForSlot inverse), e.g. ["video"], ["html"], ["image", "frame", …]. */
    assetTypes?: StoryAssetType[];
    /** Shot `render` values that use it (today "html" | "still"; a scene clip would add "scene"). */
    shotRender?: string;
    /** Build placement fields for a shot or layer on Send (e.g. htmlParams from shot.params). */
    toPlacement?(input: { params?: Record<string, unknown>; data?: unknown }): Partial<Placement>;
    /** Sync back: the storyboard layer type for this clip (storySync). */
    layerType?: "video" | "image" | "html" | "text" | string;
  };
  /** Agent surface: extra tools (registered with WebMCP and listed by gen:ai) and AI guide rules (appended, numbered). */
  agent?: {
    tools?: AgentToolDef[];
    run?(name: string, input: Record<string, unknown>, api: AgentApi): Promise<AgentResult>;
    /** Fields this type adds to get_timeline's clipJson. */
    describe?(p: Placement, project: Project): Record<string, unknown>;
    rules?: { key: string; text: string }[];
  };
  /** Extra checks for storyboard import, agent edits and project load. */
  validate?(p: Placement, project: Project): { level: "error" | "warning"; message: string }[];
}

// Built in P67 (step 1.3a) for the stateless types: src/v2/render/clipRenderers.ts
//   interface ClipRenderer { id: string; draw?(host: ClipDrawHost): void; frame?(host: ClipFrameHost): void }
//   ClipDrawHost = { g, width, height, time, offline, track, placement, sourceTicks, mix, tfx, setBox, paint, blit }
// Built in P68 (step 1.3b) for html, video, image, audio and unknown: `frame(host)`, called every frame for a clip
// with an asset version on a visible track, with or without a canvas. ClipFrameHost adds { canvas, version,
// frame: { live, loads, stalled, missing, holding, run }, media: the Player's pools (url, element, gainFor,
// htmlHost, manifest, exportVideo, posters, …) }. The pools stay in the Player for now; the instance API below
// (load → { prepare, draw, dispose }) is still the target for third-party types and is introduced with Phase 2.
// src/v2/clipTypes/render.ts (render layer)
export interface ClipRenderer<Data = unknown> {
  id: string;
  /** Per-placement instance: load resources (media element, iframe, GLB, fonts). */
  load(p: Placement, env: RenderEnv): ClipInstance<Data>;
  /** Small still for the timeline/asset tile (optional; default = none). */
  thumbnail?(asset: AssetVersionRef, env: RenderEnv): Promise<string | undefined>;
}
export interface ClipInstance<Data = unknown> {
  /**
   * Get ready to draw source time `t` (seconds, clip-local, after speed/reverse/freeze mapping done by the host).
   * Preview calls it without waiting (draws the last ready frame); export awaits it for every frame.
   * Must depend only on (data, params, t): no wall clock, no unseeded random.
   */
  prepare(t: number, ctx: FrameContext): Promise<void> | void;
  /**
   * Draw the clip's picture centred at the origin in a `w`×`h` box (the host has already applied transform, opacity,
   * keyframes, transition look, blend, mask, chroma key and overlay-effect scope; see player `paint`/`blit`).
   */
  draw(g: CanvasRenderingContext2D, w: number, h: number, t: number): void;
  /** Source size for placeRect (undefined = frame size). */
  size?(): { width: number; height: number } | undefined;
  /** Media element for audio clocking/mixing (video/audio only); others are silent. */
  audio?(): HTMLMediaElement | undefined;
  /** Loading state for the P29 load badge. */
  load?(): { loading: boolean; progress?: number };
  /** Export problems (timeouts, invalid frames), as HtmlClipHost reports today. */
  issues?(): { t: number; issue: string; detail?: string }[];
  dispose(): void;
}

// src/v2/clipTypes/ui.tsx (ui layer, optional). Built as ui/clipTypeUi.tsx, declarative (Q4). Timeline fields (P69):
// name, icon, emptyName, titlePrefix, kindClass, body, background, thumbBackground, filmstrip, waveform, assetThumb,
// assetPreviews. Inspector/toolbar fields (P70): inspectorIcon, inspectorTitle, inspectorTabs, inspectorActions,
// toolbar, toolbarMain, extraTools, editor, speed, volume, timeTools, inOutFrames, linkedAudio, transformInAudioTab;
// they name host-owned tabs/tools/actions instead of the inspectorTabs()/toolbarActions() functions sketched below.
export interface ClipTypeUi {
  id: string;
  icon: string;                            // key into ui/Icon.tsx ICONS (monochrome lucide line icons)
  label(p: Placement, project: Project): string;          // timeline / inspector title (replaces clipName, KIND_ICON)
  inspectorTabs?(props: InspectorProps): InspectorTab[];  // extra tabs; common tabs (Basic, Transform, Chroma, Audio) come from caps
  toolbarActions?(props: InspectorProps): ToolbarAction[]; // mobile toolbar / context menu
  strip?: "filmstrip" | "waveform" | "thumb" | "none";    // timeline clip decoration
}
```

Notes on the sketch:

- **Shared host vs plugin.** The player keeps everything that is the same for all visual clips: track order,
  `activeAt`, transitions, `placeRect`, transform/keyframes, fades, blend, mask (`render/clipMask.ts`), chroma key,
  effect scopes, scene capture layers, the P27 buffer gate and the export frame checks. A plugin only answers
  "what is the picture of this clip at `t`". This is what keeps Phase 1 behaviour-identical.
- **Async frames.** `HtmlClipHost` answers a frame request later (`request(t)` → `onFrame`), and export waits with
  `settle()`. Video in export uses WebCodecs (`exportVideo`) or a frame callback. `prepare`/`draw` covers all three.
- **Determinism.** Export calls `prepare(t)` for each output frame in order but must also work for any order
  (seek, scrub, renders from `timelineTools` `contact_sheet`). The HTML runtime already guarantees this (virtual
  `performance.now`/`Date`/`requestAnimationFrame`, seeded `Math.random`).
- **Data.** Built-ins keep their existing fields (`text`, `effect`, `htmlParams`, `htmlInputs`, `placeholder`,
  `blank`) so nothing is migrated. New types store their data in one new optional field
  `Placement.plugin?: { data?: unknown; v?: number }` and/or in an asset version (a JSON blob, like the audio clip
  `specKey`), so it can have versions and a storyboard slot.

## 4. The registry

```ts
// src/v2/clipTypes/registry.ts
export const clipTypes = {
  core(id: string): ClipTypeCore | undefined,
  list(): ClipTypeCore[],
  register(core: ClipTypeCore): void,              // validates id, version, schema; rejects duplicates
};
// render/clipRenderers.ts and ui/clipTypeUi.ts hold the other two tables, keyed by the same id.
```

Built-ins are discovered like presets: `import.meta.glob("./*/core.ts", { eager: true })` in `clipTypes/index.ts`,
`./*/render.ts` in the render table, `./*/ui.tsx` in the UI table. Invalid modules are reported (like
`PRESET_PROBLEMS`) and fail tests and the build.

How each surface uses it:

| Surface | Today | With the registry |
|---|---|---|
| `trackKindFor`, `isStill`, `hasSound`, `canChromaKey`, `needsThumb`, `canSetRange` | type switches | read `core.trackKind` / `core.caps` (unknown id → placeholder caps) |
| Player `draw()` | `if text … if placeholder … if blank … if html … else media` | `renderer(id).load(p)` once per placement (pooled like media elements today), then `prepare` + `draw` inside the existing `paint` path |
| Export | `Player` offline + `audioPlan` switch | same `Player`; `audioPlan` uses `caps.sound`; frame issues from `instance.issues()` |
| Timeline | label/icon/strip switches | `ui(id).label`, `icon`, `strip` |
| Inspector | `inspectorTabs()` per `kind` | common tabs from `caps` + `ui(id).inspectorTabs()` |
| Import | `mediaKindOf` | first core whose `accepts` matches |
| Storyboard | `kindForSlot`, `shotClip` length rules, Sync layer type | `core.story` and `core.duration.send` |
| WebMCP | fixed `STORY_TOOLS` + `TIMELINE_TOOLS` | the same plus every `core.agent.tools`; `clipJson` adds `core.agent.describe`; `npm run gen:ai` lists them |
| AI guide | `RULE_LIST` | stays append-only and numbered; plugin rules are appended in registry order with stable keys (built-in rules keep their numbers 1–78) |

The architecture test gets a `clipTypes` layer: `core.ts` may import `domain`/`registry` (no DOM), `render.ts` may also
import `render`, `ui.tsx` may also import `ui`. Since P65 the layer exists with core files only: no DOM, and `domain`
only through `import type`, so `domain` can read the registry in step 1.2 without a runtime import cycle. `ui` keeps importing other layers through their `index.ts` barrels.

## 5. Built-ins as plugins

```
src/v2/clipTypes/
  index.ts            # discovery + registry (core)
  types.ts            # interfaces above
  README.md           # "adding a clip type" (like docs/v2/ADDING_EFFECTS.md)
  video/   core.ts render.ts ui.tsx video.test.ts README.md
  image/   …          # photo; also the frame/character/location/… storyboard stills
  audio/   …
  text/    …          # drawTextClip, captions, layer styles, word timings stay where they are and are called from here
  html/    …          # HtmlClipHost, params, inputs, libs, manifest lint
  effect/  …          # effect clips (no draw: they feed render/effects.ts; caps.visual = false)
  state.ts            # P73: the placeholder clip STATE (any type; decision 9): isPlaceholder, placeholderCore, placeholderAccepts
  blank/   …          # P36 solid colour; stays clipType "image" + `blank` flag
  unknown/ …          # fallback for ids this build doesn't know
```

`blank` is a **variant** of `image`, not a new `clipType` value, so saved projects do not change. The registry resolves
the effective plugin with `variantOf(p)`: `p.blank → "blank"` (on an image clip), else `p.clipType`.

**Placeholder (decision 9, done in step 1.8 / P73):** a placeholder is a clip **state** that any type can be in, not a
variant or plugin. `clipTypeOf(p)` returns the host's placeholder state core first (`clipTypes/state.ts`: no media, no
sound, a still; drawn and keyable when the intended type is; the intended type's `trackKind`). `clipRendererFor(p)`
returns the shared slate renderer (`render/placeholderSlate.ts`: the P35 slate in preview, black in export; nothing for
audio and effect placeholders) and `clipUi(p)` the host's `PLACEHOLDER_UI` (the hatched card, the Fill section) before
any plugin lookup; export classification and the P48 warning were already flag-based. The placeholder keeps its
intended `clipType`, so Fill filters assets by it (`placeholderAccepts`): the image placeholder Send to timeline makes
takes any picture (video, image, html) as since P35; a `video`, `audio` or `html` placeholder only its own kind; Fill is
not offered for types without assets (text, effect, unknown). Saved projects keep the same fields (`placeholder`,
`clipType`, `TEXT_SOURCE`); no schema change, and Send still writes image placeholders.

## 6. Unknown types

A project can contain a clip type this build does not know (a newer build, a third-party plugin that is not loaded).

- **Load:** `persistence/schema.ts` keeps the placement as is. Unknown fields (including `plugin`) are never dropped
  on save.
- **Track check:** `validateComposition` accepts an unknown type on any track kind instead of using the
  `trackKindFor` fallback (which today maps any unknown string to `video`).
- **Render:** the `unknown` renderer draws the placeholder slate with "Unknown clip type “<id>”" in preview and a dark
  frame in export, and export warns first (like P48 placeholders).
- **Edit:** move, trim, delete, copy and undo work; type-specific panels are hidden; the inspector says which plugin is
  missing.
- **Agent:** `get_timeline` reports `type: "<id>", unknown: true`; type-specific tools refuse with a clear message.
- **Audio:** the unknown core has `caps.sound: false`, so export does not mix it (before P73 an unknown clip with media
  was mixed).

Done in P73: `isKnownClipType` (`clipTypes/index.ts`); `validateComposition` skips the track check for unknown ids;
`clipTypes/unknown/render.ts` draws the shared slate ("Unknown clip type “<id>”", "NEEDS A NEWER VERSION") in preview,
black in export, nothing on an audio track; `exportUnknownTypeWarning` in the export dialog; `UNKNOWN_CLIP_UI` (an
amber card naming the type, one read-only inspector tab `unknown`, no speed / volume / type tools; move, trim, split,
delete, link and undo still work); `clipJson` adds `unknown: true`. Load and save already kept every field (the stores
write the placement object as is); `ui/clipTypeState.test.tsx` round-trips it through IndexedDB.
- **Schema:** stays `dionysus/3.1`. New optional fields only (`Placement.plugin`, and storyboard fields from §7 Phase 2).
  Older builds ignore them; that is the same rule as every P-feature so far.

## 7. Phased plan

### Phase 1 — registry with zero behaviour change

Each step is one PR with its own `tasks.json` entry, CI `build` green, and no change in output.

| Step | PR content | Proof of "no change" |
|---|---|---|
| 1.1 ✅ P65 | `src/v2/clipTypes/` skeleton: `types.ts`, `registry`, discovery, architecture-test layer rules, `README.md`; **core** modules for video, image, audio, text, html, effect, placeholder, blank, unknown with `trackKind` and `caps` only. Nothing calls them yet. | Parity test: for every built-in id, `caps`/`trackKind` equal today's `trackKindFor`, `isStill`, `hasSound`, `canChromaKey`, `needsThumb`, `canSetRange`. Done in P65: `clipTypes/parity.test.ts`; caps gained `still` and `thumb` so every predicate has a cap. |
| 1.2 ✅ P66 | Domain predicates delegate to the registry (`model.ts`, `clipRange.ts`, `ops.ts`, `slip.ts`, `chain.ts`); `audioPlan` uses `caps.sound`. | Full test suite; `audioPlan` tests; parity test stays. Done in P66: `trackKindFor`, `isStill`, `canChromaKey`, `hasSound`, `sourceSpan`/`canSetRange`, `slipKind`, `setVolumeKeys`, `pasteItemGroup` and `audioPlan` read the registry; `parity.test.ts` also compares them with the frozen pre-P66 code over 54 clip shapes. Left for later steps (behaviour of one type, not a capability): linked audio and Freeze (video), `matchable`/`sourceInMax` (video), caption insert (text), `replaceAsset` checks (1.7). Unknown ids keep today's audio path until 1.8. |
| 1.3a ✅ P67 | Renderer table `render/clipRenderers.ts` (glob of `clipTypes/*/render.ts`, `ClipDrawHost`, `clipRendererFor`); **text, placeholder and blank** draw through `clipTypes/<id>/render.ts`. The player keeps the host logic (layers, effects and scopes, transitions, scene capture, blend, boxes) and passes it in as `paint` / `blit`. | `render/renderParity.test.ts`: every 2D-canvas call for a fixture project (`src/v2/__fixtures__/renderParity.ts`), preview and export, 21 times each, hashed against a golden recorded on the pre-P67 code. In the PR: Chrome pixel comparison of the same fixture with real image, video and html files (42 frames), plus the real exporter's 450 encoder-input frames, main vs branch: all identical. |
| 1.3b ✅ P68 | The stateful renderers: **html** (`HtmlClipHost`, manifests, params, inputs), **video** (export WebCodecs frames, else the element path) and **image**, plus **audio** element sync, in `clipTypes/<id>/render.ts` as `frame(host)`; the shared element path (URL, pool, volume/fx/spatial, scrub/play/drift, export seeks, posters) is `render/mediaClip.ts`. An unregistered `clipType` gets `clipTypes/unknown/render.ts`, which keeps today's element path until 1.8. The pools stay in the Player behind `ClipMediaHost`; the `load → instance { prepare, draw, dispose }` part of §3 is left for Phase 2, where third-party types need it. | The fixture gained an audio clip, a reversed video overlay and a three.js clip with an embedded `.glb`; jsdom media elements are stubbed as loaded so the golden (re-recorded on the pre-P68 code) covers the image/video draw and element sync calls: identical after the move. In the PR: Chrome pixel comparison (46 frames incl. the GLB clip) and the real exporter's 488 encoder-input frames, pre-P68 vs branch: all identical. |
| 1.4 ✅ P69 | Timeline and thumbnails: `TimelineClip.tsx`, `Timeline.tsx`, `useThumbs.ts`, `useMedia.ts` use the UI table `ui/clipTypeUi.tsx` (glob of `clipTypes/*/ui.tsx`, `clipUi(p)` by variant, `assetUi(kind)`, `DEFAULT_CLIP_UI` for anything a type leaves out and for unknown ids). The `ClipTypeUi` fields are declarative (Q4): `name`, `icon`, `emptyName`, `titlePrefix`, `kindClass`, `body`, `background`, `thumbBackground`, `filmstrip`, `waveform`, `assetThumb`, `assetPreviews`; `needsThumb` reads `caps.thumb`. Architecture: `clipTypes/<id>/ui.tsx` is ui-layer code; `ui` may import the `clipTypes` barrel. The trim limit for image assets in `Timeline.tsx` is edit behaviour, not display, and stays for a later step. | `ui/timelineParity.test.tsx`: the timeline markup of a fixture with every type (thumbnails, filmstrips, waveforms, load bars) on desktop and phone (collapsed and each group expanded), hashed against a golden recorded before the move; `ui/clipTypeUi.test.tsx` compares every helper with frozen pre-P69 copies over 42 clip shapes and every asset kind. In the PR: 20 Chrome screenshots of the real app at 390 and 1440 wide (plus tall, scrolled and expanded/selected states), main vs branch: byte-identical. |
| 1.5 ✅ P70 | Inspector, toolbar and menus: `V2App.tsx` `inspectorTabs()`, `KIND_ICON`, `clipName`, mobile toolbar, context menu and sheets read `clipUi(p)`. Plugins list host-owned ids (tabs `basic`/`speed`/`audio`/`chroma`/`transition`/`text`/`effect`/`params`/`colour`, header actions, toolbar tools, with `ToolRef` arrays for "first that applies") plus flags (`editor`, `speed`, `volume`, `timeTools`, `inOutFrames`, `linkedAudio`, `transformInAudioTab`); the panels stay in `V2App.tsx`. Parity: `ui/inspectorParity.test.tsx` DOM golden for every clip type selected (desktop inspector tabs and context menu, phone toolbar and sheets), frozen-switch test in `ui/clipTypeUi.test.tsx`, 390/1440 screenshots. | `V2App.test.tsx`, inspector tests; screenshots. |
| 1.6 ✅ P71 | Storyboard: `kindForSlot`, `shotClip`/`shotClipSpan` length rules, `storySync` layer types, `persistence/media.ts` `mediaKindOf` → `core.story`, `core.duration`, `core.accepts`. Shipped as `core.story` (`assetTypes`, `slotFallback`, `slotType`, `layerType`, `layer`, `sendLength` "planned" / "still" / "media" (this is the sketch's `duration.send`), `takes`, `params`; `DEFAULT_CLIP_STORY` for types without it) and `core.accepts` (`mimePrefix`, `mime`, `ext`, `mimeByExt`), read through `clipTypes/story.ts` (`storyOf`, `kindForSlotType`, `kindForFile`, `mimeForFile`). Also moved: `mediaLayer` (which kinds can be layers), Update's placeholder fill and html params, Sync's video-take checks, `mimeOf`. Not moved: the storyboard JSON validator's asset-type rules, `cueVideo` and the audio-cue checks. Parity: `domain/storyMappingParity.test.ts` (frozen switches + Send/Update/Sync golden recorded before the move). | Storyboard tests (`storySend*`, `storySync`, `storyRelayout`, `storySendOrder`, …). |
| 1.7 ✅ P72 | WebMCP: `ALL_AGENT_TOOLS` and `clipJson` include plugin contributions; per-type checks in `timelineTools.ts` move to the plugins' `agent.run`. Built-ins add no new tools in this phase. Shipped as `core.agent` (`clipTypes/agent.ts`): `tools` + `run(name, input, api)` (appended to `TIMELINE_TOOLS`; `api.project()`, `api.edit(label, apply)` = one undo step), `rules` (appended after the built-in `RULE_LIST`), `describe` (extra `clipJson` fields), and the declarative per-type checks `clipTools` / `props` (Q4) instead of moving the built-in tool code into `run`; the sound-position check reads `caps.sound`. Built-ins contribute no tools, rules or fields. Parity: `ui/agent/agentParity.test.ts` (hash golden recorded before the move) and `gen:ai` byte-identical. | `npm run gen:ai` produces **no diff** in `public/ai/*`, `public/llms.txt`, `docs/v2/WEB_MCP.md`; agent tests. |
| 1.8 ✅ P73 | Unknown-type handling (§6) + `docs/v2/ADDING_CLIP_TYPES.md`. **Placeholder as a cross-type state** (decision 9): player, timeline and export check `placeholder` first and use one shared slate renderer (the unknown-type slate shares it) before plugin lookup; remove the `placeholder` variant from `variantOf` and retire `clipTypes/placeholder/` (its slate, timeline card, Fill tool and export classification move to shared host code); any `clipType` may carry `placeholder`, and Fill / Replace pickers filter assets by that type. `blank` stays an `image` variant plugin. No schema change. | New tests: load/save round trip keeps unknown data; render draws the slate; export warns; a placeholder of every type (video, image, audio, html, text, unknown) draws the shared slate in preview and black in export, shows the timeline card and filters the picker; existing image placeholders unchanged (render, timeline and inspector goldens). Done in P73: `ui/placeholderParity.test.tsx` (hash golden recorded on the pre-P73 code: predicates and caps, UI entry and card markup, canvas calls in preview and export, export length / classification / warning / audio plan, `get_timeline` JSON, `review_lint`, Fill with every asset kind, for 8 placeholder and blank shapes) unchanged; `render/renderParity.test.ts` unchanged; the timeline, inspector and agent goldens changed only for the fixture's unknown-type clip (intended, §6); `ui/clipTypeState.test.tsx` covers every type and the unknown round trip. **Phase 1 is complete.** |

Test strategy for the whole phase: the full suite must pass at every step; the parity test and the "gen:ai has no
diff" check are added in 1.1 and kept; snapshot/pixel tests for the player; screenshots of the timeline and
inspector at 390×844 and 1440×900 before and after 1.3–1.5.

Risks:
- **Hot path.** `draw()` runs every frame; the registry lookup is a `Map.get`, and instances are pooled per placement
  like media elements today. Measure on a phone (P27/P30 stability tests).
- **Stateful HTML host.** The player keeps manifests, param overrides, input signatures and capture layers per html
  clip. Moving them into an instance must keep the same lifetimes (dispose when the clip leaves the project, keep while
  it is live).
- **`MediaKind` union.** Widening it to `string` loses exhaustive checks. Keep the union for built-ins and add a
  branded `PluginClipType` for others.
- **`V2App.tsx` size.** Step 1.5 touches a large file; split it into two PRs if it gets over ~400 changed lines.
- **Generated docs drift.** The no-diff check catches it.

### Phase 2 — deterministic three.js scene clip

A new built-in type `scene`: a 3D world described by JSON, rendered from `t` only, so preview, export and any seek give
the same frame. It is the first type built on the registry.

**Data** (an asset version holding `dionysus.scene/1` JSON, so it has versions and a storyboard slot; per-use overrides
in `Placement.plugin.data`):

```json
{
  "format": "dionysus.scene/1",
  "world": { "background": "#101018", "camera": { "fov": 40, "position": [0, 1.6, 6], "lookAt": [0, 1, 0] },
             "lights": [{ "type": "hemisphere", "intensity": 1.2 }, { "type": "directional", "position": [3, 5, 2] }] },
  "objects": [
    { "id": "robot", "model": "robot.glb", "size": 1.6, "position": [0, 0, 0], "animation": "Idle",
      "functions": { "setState": { "params": { "state": { "type": "select", "options": ["idle", "wave", "walk"], "default": "idle" } },
                                   "states": { "param": "state", "table": { "idle": { "animation": "Idle" }, "wave": { "animation": "Wave" },
                                                                            "walk": { "animation": { "clip": "Walk", "speed": 1.2 } } } } } } },
    { "id": "sign", "box": [2, 1, 0.1], "color": "#ffcc00", "position": [2, 1, -1] }
  ],
  "events": [
    { "at": 0.0, "obj": "robot", "call": "setState", "args": { "state": "idle" } },
    { "at": 1.0, "obj": "robot", "call": "moveTo", "args": { "position": [1, 0, 0] }, "dur": 1.5, "ease": "inOutCubic" },
    { "at": 1.0, "obj": "robot", "call": "setState", "args": { "state": "walk" } },
    { "at": 2.5, "obj": "robot", "call": "lookAt", "args": { "target": "sign" }, "dur": 0.5 },
    { "at": 3.0, "obj": "sign", "call": "opacity", "args": { "value": 0 }, "dur": 0.8, "ease": "out" }
  ]
}
```

- **Base functions** on every object: `position`/`moveTo`, `rotation`, `scale`, `visible`, `opacity`, `lookAt`.
  With `dur` they tween with a named easing (`linear`, `in`, `out`, `inOut`, `inOutCubic`, …; built next to `ease`/`easeIO` in `src/v2/presets/_lib/math.ts`); without `dur`, they set the value.
- **Custom functions** are declared per object with typed params (the same `ParamSpec` types as presets and HTML clip
  params: number/color/string/select/boolean). Phase 2 supports declarative effects only: play a GLB animation
  clip, swap a material/colour, show/hide a child node. No user JavaScript (that is Phase 3).
- **Pure state from `t`.** `stateAt(scene, t)` sorts events by `at` (stable, array order breaks ties), and for each
  object property folds the events with `at <= t`. A tween starts from the value the property has at its own `at`
  (computed the same way) and ends at its target at `at + dur`. No state is carried from the previous frame, so any
  `t` in any order gives the same frame.
- **GLB animation** (done in P75). Each object with a model has one `AnimationMixer`. The active clip and its local time are derived
  from the latest `play` / `stop` / function-row event (`localT = (t - event.at) × speed + from`, looped, ping-ponged or
  clamped per clip) and applied with `mixer.setTime`, never with `mixer.update(delta)`: every action is reset, its time
  scale is set to its local time and the mixer is set to 1 s, so each clip lands on its own time. Cross-fades (`fade`,
  else the event's `dur`) are computed from `t` too: the clip before keeps playing with weight 1 − k. Model files live
  in the document's `files` map (data: URLs) and reach the page through its clip manifest, as attached files of code
  clips do (P55).
- **Conflict rule.** For the same object and property, the event that started last (largest `at`, then array order)
  wins from its start; an earlier tween still running is cut at that moment. Different properties never conflict.
  `moveTo` and `position` are the same property; `lookAt` and `rotation` are the same property.
- **Validation.** Unknown object ids, functions, params, overlapping tweens of one property (warning), negative times,
  missing models: errors and warnings with JSON paths, like the storyboard importer.
- **Rendering** (decision 1: the sandboxed HTML clip host). The options were: run the scene in the existing sandboxed HTML clip host
  with a built-in runtime page (three.js and GLTFLoader are already vendored in `render/htmlLibs.ts`, GLB files already
  resolve from the manifest after P55, determinism and export already work). The other option is an in-process
  WebGL canvas in the player.
- **Agent tools (P78)**, contributed through `core.agent` (the first clip type that adds tools and a rule):
  `create_scene_clip`, `get_scene`, `list_scene_objects` (objects with their base, model and custom calls and the
  arguments each takes, events by index), `add_scene_object` (shape, `.glb` file or an embedded model),
  `set_scene_object`, `remove_scene_object`, `add_scene_event`, `update_scene_event`, `retime_scene_event`,
  `remove_scene_event` and `set_scene_world` (name, length, background, camera start, lights). Pure operations in
  `domain/sceneAgent.ts`; an edit that would add a validation error is refused and changes nothing; errors list the
  valid objects, calls and arguments. Each edit is one undo step, saved as a scene version under the version-save
  rules (WebMCP `mode`: `new` or `replace`). Plus AI guide RULE 79 (`scene-clips`) on the model, the event timeline,
  base and custom functions, GLB play / stop and best practices.
- **Storyboard.** A storyboard asset type `scene` and shot `render: "scene"` (optional values within schema 3.1, no
  version bump; decision 5, accepted). Send uses the planned `durationSec`. Older builds reject the new values.
- **Editing (P76, P77).** A scene clip has its own timeline editor: one track per object plus a scene/camera track,
  events as blocks labelled with their call; selecting one edits it in a side panel. Every edit is one undo step and
  is saved into the scene asset version under the version-save rules. Since P77 blocks are dragged to retime them
  and resized from their edges (one undo step per drag; see the split note below the table).

Phase 2 is split into small PRs like Phase 1: one step per PR, its own `tasks.json` entry, CI `build` green, merged
before the next starts. Existing clip types must not change in any step (their parity goldens stay byte-identical).

| Step | PR content | Proof |
|---|---|---|
| 2.1 ✅ P74 | The **`scene` clip type** (`clipTypes/scene/` core, render, ui, following `ADDING_CLIP_TYPES.md`; `"scene"` added to `MediaKind`). **Document schema + validation** `domain/scene.ts` (`dionysus.scene/1`: world background / camera / lights; objects with primitive shapes and the base properties position, rotation, scale, visible, opacity, colour; declarative custom functions with typed params, `set` and `states`; events `{ at, obj, call, args, dur, ease }`; errors and warnings with JSON paths). **Pure evaluator** `stateAt(doc, t)` (stable sort, tween from the value at the event's start, last-started wins, lookAt, camera). **Rendering** in the sandboxed HTML clip host: the built-in page `render/scenePage.ts` (pinned three.js) gets `stateAt` for each frame as `ctx.inputs.scene` (`ClipMediaHost.sceneHost` / `sceneDoc`; export waits for the document). Code → **3D scene** adds a sample scene (`addSceneClip`, one undo step); read-only **Scene** inspector tab (objects, events, problems). Reference: [`SCENE_FORMAT.md`](SCENE_FORMAT.md). No WebMCP tools, AI rules or storyboard mapping yet (gen:ai unchanged). | `domain/scene.test.ts` (validation paths, set/tween/ease, conflict and tie rules, custom functions, lookAt, camera, invalid input skipped, seek in any order gives identical states, a `stateAt` golden of 151 frames); `ui/sceneClip.test.tsx` (caps, track check, save/load, renderer requests, loading and broken documents, page CSP and escaping, UI entry, scene placeholder, Scene tab, one undo step). Existing goldens (render, timeline, inspector, agent, placeholder, story mapping) unchanged. In the PR: Chrome check of the real Player: 50 frames rendered in export mode forward, in export mode shuffled, and in preview mode backwards are pixel-identical, and a real 720p MP4 export has no frame warnings. |
| 2.2 ✅ P75 | **GLB models and animation:** model files embedded in the scene asset (a `files` map like HTML clip packages; `model` names one, a number `size` fits it), the vendored GLTFLoader, one `AnimationMixer` per model driven by `mixer.setTime` from the latest `play` / `stop` / state event (repeat, once or pingpong, speed, start offset, cross-fades from `t`); object `animation` from 0 s; custom function rows gain `animation` (clip by param value) and `nodes` (child-node show/hide; also the `nodes` call and object `nodes`); missing or broken models warn and draw the shape. `domain/glb.ts` reads clip names, lengths and node names for validation and the Scene tab, which gains **Add GLB model** (a new scene version, one undo step). Also the P74 gaps: Scene on the phone clip toolbar (a sheet), scenes in the picker's Code tab, no `volume` on scene clips. | `domain/sceneModel.test.ts` (glbInfo, validation paths, clip time / speed / loop / fade rules, rows, nodes, seek order, addSceneModel, page manifest, a rounded `stateAt` golden of 241 frames) and `ui/sceneModelUi.test.tsx`. Existing goldens unchanged (the P74 scene golden too). In the PR: Chrome check with an animated test robot and the Khronos Fox sample (skinned, textured): 50 frames in export mode forward and shuffled and in preview mode backwards are pixel-identical and identical again in a second browser launch; a real 720p MP4 export has no frame warnings; shape-only scenes render pixel-identical to `main` (closes the P55/P57 unverified area for scene clips). |
| 2.3 ✅ P76 | **Scene editor, part 1** (the owner-confirmed UX, split as below): a scene clip has its **own timeline editor**, opened from the clip (Edit scene in the Scene tab or the clip menu on desktop, where it takes the timeline panel's place; the Scene tool on the phone, a full-screen sheet with a mirrored preview). One track per object plus the scene/camera track on top; events are blocks labelled with their call, stacked in rows where they overlap; **read-only on the tracks** (select, no drag). Selecting a block edits its call, time, duration, ease and arguments (base, model and custom-function args) in a side panel; a track header edits the object's base properties (id with references, name, shape, size, colour, position, rotation, scale, visible, opacity, model animation and parts) or the scene (name, planned length, background, camera start, lights). Add / duplicate / delete events, add (shapes, GLB) / delete objects, add / delete lights. Pure edit operations in `domain/sceneEdit.ts`. Each committed field or button is **one undo step**, stored as a scene version under the version-save rules (New version: one new version per editing session, later edits of the session update it; Replace current: overwrite the shown version). The preview shows an edit at once: the stored scene is handed to the player, which keeps the clip's page when only events or properties changed (`scenePageKey`) and draws the frame again. | `domain/sceneEdit.test.ts` (each operation pure on frozen input and valid; rename / delete cascades; default args from `stateAt`; lights keep the defaults; tracks and row stacking; page key); `ui/sceneEditor.test.tsx` (tracks and blocks, forms, one version per session with one undo step per edit, Replace current, add / delete / rename, phone sheet, Escape, Edit scene button, the renderer redraws a kept page). Existing goldens unchanged. In the PR: Chrome check after event and property edits on a kept page: 50 shuffled preview frames identical to a fresh export-mode player and to a fresh preview player; 390 and 1440 screenshots, 44 px targets. |
| 2.4 ✅ P77 | **Scene editor, part 2:** drag a block to retime it (`at`), drag the selected block's start or end handle to change its start (the end stays) or `dur` (mouse, pen and touch; on touch a block is selected first so a swipe still scrolls; handles are 44 px). Edges snap to the playhead, other events' starts and ends, the clip's in / out and whole frames (magnet toggle, Alt flips it for a drag); times are clamped to the clip's range on the scene clock (widened to where the event already is). Dropping a block on another object's track gives the event to that object when it offers the same call and the args still validate (refused with a reason otherwise). The drag works on the scene it started from: each move applies one pure op (`domain/sceneRetime.ts`), the tracks draw it and the preview shows it live (`Player.previewSceneDoc`, the page is kept); the release is **one** `edit()` = one undo step under the version-save rules; Esc / pointer cancel restores. The ruler scrubs the playhead (the main player follows). Arrow keys nudge the focused block or handle by a frame (Shift: ten). Cheap P76 limits fixed: Esc in a field with typed changes reverts it, in a clean field it closes the editor; the desktop editor is at least 440 px tall. Multi-select is not in this step. This replaces the former step 2.6 (per-object sub-tracks under the clip on the main timeline, decision 6). | `domain/sceneRetime.test.ts` (move / start / end maths, frame rounding, snapping and the closer edge, clamping, no-op returns the same scene, moments, validity, moving to another object and refusals); `ui/sceneEditorRetime.test.tsx` (live preview without storing, one version and one undo step per drag, handles, keyboard nudge, snapping guide, clamping, Esc cancel, touch needs selection, drop on another track and refusal, ruler scrub, Esc in fields). Existing goldens unchanged. In the PR: Chrome drag on the real player (the live frame equals the stored one after release, the page and iframe are kept), 390 and 1440 screenshots with touch drags, 44 px targets. |
| 2.5 ✅ P78 | **Agent tools and rule** through `core.agent`: `create_scene_clip`, `get_scene`, `list_scene_objects`, `add_scene_object`, `set_scene_object` (base properties, model, animation, functions), `remove_scene_object`, `add_scene_event`, `update_scene_event`, `retime_scene_event`, `remove_scene_event`, `set_scene_world` (world, camera, lights). Pure operations in `domain/sceneAgent.ts` (built on `domain/sceneEdit.ts` / `sceneRetime.ts`, checked with the scene validator: an edit that adds an error is refused and changes nothing; errors list the valid objects, calls and arguments). The runner `clipTypes/scene/agent.ts` is loaded lazily by the core (`import()`; a new `clipTypes/agent` layer may use the domain at runtime) and reads / stores scene blobs through `ClipAgentApi.blobs`; each edit is **one undo step** saved as a scene version under the version-save rules (`mode` new / replace, remembered like the other tools). AI guide **RULE 79** `scene-clips`. `get_timeline` scene fields were left out (they would need the scene blob; `get_scene` covers it). | `domain/sceneAgent.test.ts` (every operation on frozen input, error texts, refusals, read models); `ui/agent/sceneAgentTools.test.ts` (WebMCP registration of the contributed tools, an agent session using every tool with one undo step each, mode new / replace, errors change nothing, no media store); `clipTypeAgent.test.ts` (only scene contributes). `gen:ai` diff = the 11 tools in `WEB_MCP.md` / `llms.txt` and rule 79 (additions only); `agentParity` golden: only the tool-list, rule and timeline-tool-guide hashes change, and the dumps show the pre-P78 content as an exact prefix. |
| 2.6 P79 | **Storyboard** (decision 5): asset type `scene` and shot `render: "scene"` (optional values in 3.1); `core.story` for scene (Send uses the planned `durationSec`, Update, Sync); storyboard validator, `STORYBOARD_FORMAT.md` and the AI guide. | Storyboard tests; the story-mapping golden unchanged for existing slot types. |

**Split and renumbering (P76).** The owner confirmed the scene editor UX (own timeline per scene clip, desktop panel
and phone full-screen sheet, tracks per object, blocks labelled with their call, drag to retime and resize, a side
panel for args and ease, add / delete events and objects, base properties, one undo step per gesture, saved under the
version-save rules) and allowed a split if one PR would be too big to review. It was split: **2.3 (P76)** is the
editor with the object list, the property and event forms, add / delete, and a read-only track view with selection;
**2.4 (P77)** adds drag and resize retiming on those tracks. The former 2.6 (sub-tracks under the clip on the main
timeline) is dropped: the tracks live in the scene editor. Agent tools and the AI rule moved from 2.4 to **2.5
(P78)**, the storyboard mapping from 2.5 to **2.6 (P79)**.

### Phase 3 — third-party clip types

- A plugin package is a zip (or URL) with a manifest (`dionysus.cliptype/1`: id, version, data schema, params,
  storyboard mapping, agent tool declarations, AI rule texts) and a renderer page that speaks the HTML clip frame
  protocol (`dionysus:init`/`params`/`frame`, `render(t, ctx)`).
- The renderer always runs sandboxed (iframe with opaque origin and the clip CSP, or a worker), like HTML clips today:
  no access to the editor, storage, cookies or network beyond its own files and allowed libraries.
- The host owns everything else (core rules are data, not code). Agent tool calls are validated against the declared
  schemas by the host and forwarded to the sandbox as messages.
- Projects keep working without the plugin (§6). Loading is per project, with the user's consent; a lock records
  id + version + content hash.

## 8. What this does not change

Effects, transitions, blend modes, text animations and stickers stay presets (`src/v2/presets/`). Tracks stay
video/audio/text/effect. Undo stays one engine dispatch per edit. The storyboard format stays
`dionysus.storyboard/1` (schema 3.1), and projects stay `dionysus/3.1`.

## 9. Open questions

Answered on 2026-11-15; see [§0 Decisions](#0-decisions). Kept for the record.

1. **Scene rendering:** run the scene clip in the sandboxed HTML clip host (recommended: safe, export already proven)
   or in-process WebGL in the player (faster, simpler debugging, but a new export path)?
2. **Where scene data lives:** an asset version (versionable, works with storyboard slots and Replace) or inline on the
   placement? The proposal uses an asset version plus per-use overrides.
3. **New type ids:** store the plugin id in `clipType` (simple; older builds treat it as an unknown `video` clip) or
   keep `clipType` to the six built-ins and put new types in `Placement.plugin.type`?
4. **Custom scene functions:** declarative only (GLB animation, material, visibility) in Phase 2, with user JavaScript
   only in Phase 3 sandboxed plugins — agreed?
5. **Storyboard:** may we add optional values `render: "scene"` and asset type `scene` within schema 3.1, knowing older
   builds will reject such a storyboard?
6. **Priority of per-object sub-tracks** in the timeline: part of Phase 2 or later?
7. **Phase 3 trust:** where may plugins be loaded from (any https URL, a list you approve, only local zip files), and
   may they add inspector UI (sandboxed iframe panels) and agent tools?
8. **Phase 1 order and size:** eight PRs as listed, merged one at a time — or fewer, larger PRs?
