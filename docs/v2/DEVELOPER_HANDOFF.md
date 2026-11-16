# Developer handoff (Dionysus v2)

For a developer (human or AI bot) picking up Dionysus with no earlier context. Written at `main` `36c37b14`
(after P63, November 2026). Read this, then `MODULE_DESIGN.md` and the doc for the area you touch.

## 1. What Dionysus is

A local-first video editor and AI planning tool in the browser. A user (or an AI through WebMCP) plans a video as a
**storyboard** (shots, assets, audio cues; JSON format `dionysus.storyboard/1`), sends it to a multitrack **timeline**,
edits, previews and exports MP4. No AI model is built in: the app writes prompts, the user's own AI (or an agent)
answers with JSON, HTML clips or media files. Projects live in the browser (IndexedDB); nothing is sent to a server.

## 2. Ground rules

- **v2 only.** The app is `src/v2`. There is no v1 code path and no schema 1.0 support to keep.
- **Project format `dionysus/3.1`** (`SCHEMA` in `src/v2/domain/model.ts`; older projects upgrade through
  `persistence/schema.ts` `MIGRATIONS`). New features add **optional fields only**; old projects must load unchanged.
- **Storyboard format** `dionysus.storyboard/1`, `schemaVersion` "3.1" (clip-centric since P16; 3.0 files are migrated on import). Same optional-only rule.
- **Every feature must be AI-definable:** whatever a user can do, an agent must be able to do through WebMCP tools,
  and the AI guide must explain it. A feature PR normally has: WebMCP tool(s) or tool changes, a new AI guide rule,
  docs, unit tests, and a `tasks.json` entry.
- **English** for code, comments, commits, PRs and docs.
- **Do not merge your own PRs.** Open the PR, wait for the `build` check to pass on the exact head commit, report.
- **Do not touch:** `.github/workflows/*`, `workflow-changes.patch`, any root `ep01_*` file. Do not commit screenshot or
  helper scripts.
- **No hard-coded deployment host.** Never write the GitHub Pages URL (or any host) in `src/`, docs or tests. Runtime
  links come from the page origin + Vite `base`; build-time URLs from `DIONYSUS_SITE_URL`; the single fallback lives in
  `src/v2/domain/siteUrl.ts` (see `docs/v2/DEPLOYMENT.md`).

## 3. Repo layout

```
src/main.tsx                 boots the v2 app
src/v2/
  domain/        pure model + logic, no DOM (model.ts, ops.ts, storyboard*.ts, storySend.ts, storyJson.ts,
                 storyPrompt.ts = AI guide RULE_LIST, storyAgent.ts = storyboard WebMCP tools,
                 timelineReview.ts = timeline WebMCP tool schemas, htmlClipPackage.ts, …). index.ts is the barrel.
  engine/        Engine (undo history; one dispatch = one undo step) and commands.ts (Command factories)
  persistence/   IndexedDB/memory stores, media import (media.ts), schema migrations, project archive
  ports/         storage interfaces (BlobStore, …)
  clipTypes/     clip type registry (P65+): one folder per type with core.ts (trackKind, caps; storyboard mapping and file import since P71; agent tools/rules/checks since P72); domain predicates read it (P66); render.ts renderers (P67, P68); ui.tsx timeline UI (P69), inspector/toolbar/menus (P70); state.ts placeholder state and unknown-type handling (P73); scene/ the 3D scene type (P74; GLB models and animation P75; docs/v2/SCENE_FORMAT.md); how to add a type: docs/v2/ADDING_CLIP_TYPES.md
  registry/      preset registry (effects, transitions, text animations, stickers, blends, audio fx, fonts)
  presets/       one file per preset, auto-discovered (docs/v2/ADDING_EFFECTS.md)
  render/        Player (preview AND export compositor), htmlClip.ts (sandboxed HTML clip host), text, effects,
                 transitions, masks, chroma key, audio fx, export/ (plan.ts, encode.ts, videoFrames.ts)
  ui/            React UI: V2App.tsx (editor shell + inspector), Timeline*.tsx, storyboard/, agent/ (webMcp.ts,
                 timelineTools.ts, mediaTools.ts), desktop/, mobile pieces, Icon.tsx
  architecture.test.ts   enforces the layer rules below
docs/v2/        design and format docs (index in §8)
public/ai/      GENERATED AI files (guide, formats, presets.json) — do not edit by hand
public/llms.txt GENERATED
public/doc/     tasks.json (task tracker, source of truth) and the task dashboard
public/vendor/  vendored libraries for HTML clips (three.js, …)
public/poc/     standalone proof-of-concept pages (not part of the app)
scripts/        check-tasks-updated.mjs, validate-storyboard.mjs, new-preset.mjs
```

**Layer rules** (`src/v2/architecture.test.ts`, `MODULE_DESIGN.md` §3): `domain` imports only `domain`/`registry`;
`engine`, `persistence`, `render` sit above it; `ui` may import everything but only through each layer's `index.ts`
barrel. `registry`, `presets`, `domain`, `ports` and `engine` must not use DOM globals; the test greps for the words
`document`, `window`, `indexedDB`, `HTMLElement` outside comments, **including inside strings** (e.g. tool
descriptions in `domain/timelineReview.ts`). `clipTypes` (P65) is also DOM-free and may import `domain` only with `import type`.

## 4. Commands

```bash
npm install
npm run dev            # Vite dev server on :3000
npx tsc -b             # type-check
npx vitest run         # all tests (≈ 211 files / 1,640 tests); read the summary, not only the exit code
npm run build          # tsc -b && vite build (also writes the AI files for the build's site URL into dist/)
npm run gen:ai         # regenerate public/ai/*, public/llms.txt and the tool blocks in docs/v2/WEB_MCP.md
npm run new:preset -- videoEffect my-effect
npm run validate:storyboard -- my.storyboard.json
npm run preview        # serve dist/ (base path from DIONYSUS_SITE_URL / vite.config.ts)
```

Screenshots for UI PRs: build, `npm run preview` (or `npx vite preview --host 127.0.0.1 --port 4173`), drive it with
playwright-core and a local Chrome, at **390×844** (mobile, `isMobile`, `hasTouch`) and **1440×900** (desktop). Keep the
script outside the repo.

## 5. CI

`.github/workflows` runs on pull requests to `main` and pushes to `main`. The check that matters is the job **`build`**
(workflow "CI"): `npm install` → `npm test` → `npm run build`. Wait for it to succeed on the PR's exact head SHA
(`gh run list --branch <branch>` then `gh run watch <id>`). Pages deploys on merge to `main`. Newer pushes cancel
older runs of the same ref (a cancelled run is not a failure). Other workflows (`pages.yml`, PR previews) are not
required checks.

## 6. PR workflow

1. `git fetch` and branch from the latest `origin/main` (e.g. `p66-short-name`).
2. Implement with tests. Keep PRs small (MODULE_DESIGN §14 targets < 400 changed lines; feature PRs here are often
   larger, but split refactors).
3. **`public/doc/tasks.json`:** add one entry per PR with the next free P-number: `{ "id": "P82-SHORT-NAME", "title":
   "<what and why, one paragraph>", "status": "done", "progress": 100 }` appended after the latest entry (the latest is
   `P81B-SCENE-CAMERA-LIGHTS`; the next is **P82**). Bump `updatedAt`. Edit the file surgically (insert text); do not
   re-serialise the whole JSON. `scripts/check-tasks-updated.mjs` fails a PR that changes `src/` without it. If an id
   is already taken, use the next number and say so in the PR.
4. **AI guide rule:** append to `RULE_LIST` in `src/v2/domain/storyPrompt.ts` (append-only; numbers are positions;
   the latest built-in is **78** `story-order-insert`). Clip types append their own rules after the built-ins
   (`core.agent.rules`, P72): since P78 the scene type's `scene-clips` is **79**. A new built-in rule therefore takes
   79 and moves `scene-clips` to 80 (move its copy in `STORYBOARD_FORMAT.md` and the key lists in `aiGuide.test.ts`
   with it, and say so in the PR); a rule about one clip type belongs in that type's `core.agent.rules`. Then:
   - add the same text as `79. …` after rule 78 in `docs/v2/STORYBOARD_FORMAT.md` (the test checks it verbatim);
   - update `src/v2/domain/aiGuide.test.ts`: rule count, the `slice(-10)` and `slice(30)` key lists, `ruleNumber(…)`,
     `full` contains `79. ${RULES[78]}`, and a few key phrases.
5. **WebMCP:** storyboard tools in `domain/storyAgent.ts` (`STORY_TOOLS`, sync, run by `ui/agent/webMcp.ts`
   `callAgentTool`); timeline/media tools: schema in `domain/timelineReview.ts` `TIMELINE_TOOLS`, runtime in
   `ui/agent/timelineTools.ts` `runTimelineTool` (async, gets blobs). Every edit is one `engine.dispatch` (one undo
   step) and returns structured JSON. Hand-written explanations go in `docs/v2/WEB_MCP.md` outside the generated
   `<!-- tools:start/end -->` and `<!-- timeline-tools:start/end -->` blocks.
6. Run `npm run gen:ai` after changing rules, tools or presets, and commit the regenerated files (tests fail if they are
   stale).
7. `npx tsc -b && npx vitest run && npx vite build`.
8. Commit in English; PR title `P82: …`; body says what, why, tests, and `Fixes #N` (or `Refs #N` if partial), plus
   what was not verified. Push, open the PR, wait for `build` on the head SHA. Do not merge.

## 7. UI conventions

- Every change works at **390 px** (phone) and **1440 px** (desktop). Mobile uses bottom sheets and a scrollable
  toolbar; desktop uses the inspector panel and toolbar (`ui/V2App.tsx`).
- Touch targets **≥ 44 px** on mobile.
- **Monochrome line icons** only: `ui/Icon.tsx` (`Ic g="…"`, lucide stroke icons mapped from short keys). No emoji or
  colour icons in new UI.
- Accessible names (`aria-label`) on icon buttons; dialogs with `role="dialog"` and a label. Tests find controls by them.
- Destructive actions confirm or offer Undo (one undo step).

## 8. Docs index

| Doc | What |
|---|---|
| `docs/v2/MODULE_DESIGN.md` | layers, folder tree, domain model, registries, commands, storage, render pipeline, tracking rules |
| `docs/v2/VISION.md` | product direction |
| `docs/v2/STORYBOARD_FORMAT.md` | storyboard JSON format + the numbered AI guide rules (generated copy in `public/ai/`) |
| `docs/v2/HTML_CLIP_PACKAGE.md` | HTML/code clips: `dionysus.htmlclip/1`, `dionysus.clip({ render(t, ctx) })`, params, inputs, libraries, attached files, determinism |
| `docs/v2/WEB_MCP.md` | WebMCP: how agents connect, every tool (generated blocks), safety, examples |
| `docs/v2/AUDIO_CLIP_FORMAT.md` | `dionysus.audioclip/1` (Audio editor) |
| `docs/v2/ADDING_EFFECTS.md` | adding presets (effects, transitions, text animations, …) |
| `docs/v2/MASKING.md`, `docs/v2/TRACKING.md` | clip masks (P49), motion tracking (P39/P40) |
| `docs/v2/DEPLOYMENT.md` | hosting, `DIONYSUS_SITE_URL`, base path |
| `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md` | clip type plugins: accepted design, decisions, Phase 1 (done) and the Phase 2 step table |
| `docs/v2/ADDING_CLIP_TYPES.md` | adding a clip type step by step, with a worked example (P73) |
| `docs/v2/SCENE_FORMAT.md` | 3D scene clips: `dionysus.scene/1` objects, events, custom functions, rendering (P74), GLB models and animation (P75), the scene editor (P76, P77; Save / Cancel, drafts and the phone toolbar P80; Edit view and gizmos P81a; camera and lights as objects P81b), agent tools (P78; saving session, batch and GLB URLs P79), storyboards (P79) |
| `public/doc/tasks.json` | every task and its status |

## 9. Recent history (P47–P81b)

| Id | PR | One line |
|---|---|---|
| P47 | #297 | Caption word timings: word-pop (one clip per word) and word-highlight (karaoke); Even split and Align with AI. |
| P48 | #298 | Export drops trailing placeholder shots and renders middle ones black, with a warning (RULE 59). |
| P49 | #299 | Clip visibility masks: rectangle, ellipse, split, band and editable Bézier paths, feather, invert. |
| P50 | #300 | Mobile Import SRT works with the media sheet closed; clearer import/export icons. |
| P51 | #301 | Upload inside Fill placeholder / Replace asset; Insert clip after current clip; paste placement dialog. |
| P52 | #302 | Mobile toolbar scrolling, ripple toggle next to Delete, paste at playhead onto a chosen track. |
| P53 | #303 | Code Editor file attachments by drag and drop. |
| P54 | #304 | One shared code-clip preview with real params and a Mix toggle (storyboard and timeline). |
| P55 | #305 | Code clip export loads attached files (GLB etc.) like preview and warns on failures. |
| P56 | #306 | Build SHA, build time and CI run number in the Projects menu. |
| P57 | #307 | Preview attached files in the Code Editor (images, media, interactive GLB viewer). |
| P58 | #308 | Per-clip version pin; Replace as a new version with trim; delete versions. |
| P59 | #309 | Version save mode (new vs replace), brand logo, mobile fullscreen controls and orientation. |
| P60 | #310 | Track-level caption style, Align all with AI, three-state word highlight. |
| P61 | #311 | Fix: WebMCP `create_storyboard` starts boards as schema 3.1 (clip shots were rejected). |
| P62 | #313 | WebMCP `attach_asset_version(s)` from URLs, `import_storyboard`, `send_to_timeline` modes `relayout`/`replace` (RULE 77). |
| P63 | #315 | New shots on a sent timeline go in story order and use their shared clip's version (RULE 78). |
| P64 | #316 | Docs only: clip type plugin architecture proposal and this handoff. |
| P65 | #317 | Clip type plugins Phase 1 step 1.1: `src/v2/clipTypes/` registry, core caps, parity test (no behaviour change). |
| P66 | #318 | Step 1.2: domain predicates and export audio plan read the clip type registry (no behaviour change). |
| P67 | #319 | Step 1.3a: text, placeholder and blank renderers move to `clipTypes/<id>/render.ts`; canvas-call golden + Chrome pixel parity. |
| P68 | #320 | Step 1.3b: html, video, image and audio renderers move to `clipTypes/<id>/render.ts` (`frame(host)`, shared `render/mediaClip.ts`); golden + Chrome pixel + export frame parity incl. a GLB clip. |
| P69 | #321 | Step 1.4: timeline clip look and asset thumbnails/previews read `clipTypes/<id>/ui.tsx` (`ui/clipTypeUi.tsx`); markup golden, legacy-helper parity, 390/1440 screenshot parity. |
| P70 | #322 | Step 1.5: inspector icon/title/tabs/header buttons, mobile toolbar, context menu and sheets read `clipTypes/<id>/ui.tsx` (host-owned tab/tool/action ids); inspector/toolbar/menu DOM golden for every clip type, legacy-switch parity, 390/1440 screenshot parity. |
| P71 | #323 | Step 1.6: storyboard mapping (`kindForSlot`, Send lengths, Sync slot/layer types, video takes, html params) and file import (`mediaKindOf`, `mimeOf`) read `core.story` / `core.accepts`; frozen-switch parity and a Send/Update/Sync golden recorded before the move. |
| P72 | #324 | Step 1.7: WebMCP tools, AI guide rules and `get_timeline` fields can come from `core.agent` (built-ins add none; `gen:ai` byte-identical); per-type checks of the timeline tools read `agent.clipTools` / `agent.props` / `caps.sound`; compact hash golden recorded before the move. |
| P73 | #325 | Step 1.8, the last of Phase 1: placeholder is a cross-type clip state handled by the host before any plugin (`clipTypes/state.ts`, shared slate `render/placeholderSlate.ts`, `PLACEHOLDER_UI`; `clipTypes/placeholder/` retired; Fill filters by the intended type); unknown clip types load, keep their data, draw a slate, export black and silent after a warning, have an info-only inspector and `unknown: true` in `get_timeline`; `docs/v2/ADDING_CLIP_TYPES.md`. Image placeholders and blank unchanged (golden recorded before the move). |
| P74 | #326 | Phase 2 step 2.1 (decision 5 accepted: storyboard `render: "scene"` / asset type `scene` as optional values in 3.1, no version bump; Phase 2 step table added): the `scene` clip type (`clipTypes/scene/`), `dionysus.scene/1` schema and validation and the pure evaluator `stateAt` (`domain/scene.ts`), rendering in the sandboxed HTML clip host from `t` only (`render/scenePage.ts`), Code → 3D scene, read-only Scene inspector tab; `docs/v2/SCENE_FORMAT.md`. Existing goldens unchanged; preview, export and seek order pixel-identical in Chrome. |
| P75 | #327 | Phase 2 step 2.2: GLB models in scene clips (`files` map of data: URLs, `model`, fit by `size`), animation as a property (object `animation`, `play` / `stop`, function rows; speed, repeat / once / pingpong, start offset, cross-fades from `t`) and node show/hide (`nodes`); the page loads models with the vendored GLTFLoader through its clip manifest and poses them with `mixer.setTime` per frame (no `update(delta)`); `domain/glb.ts`; Scene tab Add GLB model. P74 gaps: Scene sheet on phones, scenes in the picker's Code tab, no `volume` on scene clips. Existing goldens unchanged; Chrome parity with a real skinned GLB (Fox). |
| P76 | #328 | Phase 2 step 2.3 (owner-confirmed scene editor UX, split in two; step table renumbered): a scene clip's own timeline editor (`ui/SceneEditor.tsx`; desktop: in place of the timeline panel, from Edit scene / the clip menu; phone: full-screen sheet from the Scene tool with a mirrored preview), one track per object plus the scene/camera track, blocks labelled with their call (read-only on the tracks, select to edit), side-panel forms for event call / time / duration / ease / args, object base properties, scene, camera and lights; add / duplicate / delete events, add / delete objects. Pure operations in `domain/sceneEdit.ts`. One undo step per committed edit, saved as a scene version under the version-save rules; the player keeps the clip's page across event and property edits (`scenePageKey`, `primeSceneDoc`) so the preview updates at once. Existing goldens unchanged. |
| P77 | #329 | Phase 2 step 2.4: drag and resize retiming in the scene editor (`domain/sceneRetime.ts`; move / start / end handles, mouse, pen and touch with 44 px handles; snapping to the playhead, other events, clip in / out and whole frames with a toggle and Alt; clamped to the clip range; drop on another object's track when the call fits; live preview via `Player.previewSceneDoc`; one undo step per drag under the version-save rules; Esc cancels), ruler scrubbing synced with the player, arrow-key nudges; Esc in fields reverts first; desktop editor ≥ 440 px. Existing goldens unchanged. |
| P78 | #330 | Phase 2 step 2.5: scene agent tools and AI guide RULE 79 (`scene-clips`), contributed through the scene core's `core.agent` (the first type that adds tools): `create_scene_clip`, `get_scene`, `list_scene_objects`, `add_scene_object`, `set_scene_object`, `remove_scene_object`, `add_scene_event`, `update_scene_event`, `retime_scene_event`, `remove_scene_event`, `set_scene_world`. Pure ops in `domain/sceneAgent.ts` (refuse edits that add validation errors; errors list valid objects, calls and args); runner `clipTypes/scene/agent.ts` loaded with `import()` (new `clipTypes/agent` layer); `ClipAgentApi.blobs`; one undo step per edit under the version-save rules (`mode` new / replace). `gen:ai` diff = the new tools and rule only; agent golden: only tool / rule hashes. |
| P79 | #331 | Phase 2 step 2.6, the last of Phase 2: storyboard asset type `scene` and shot `render: "scene"` (optional values in 3.1, decision 5): validator (inline `scene` checked with the scene validator), Send / Update / Re-lay place scene clips or a placeholder of intended type `scene` (`core.story.shotRender`), Sync maps main-track scene clips to render scene shots, `attach_asset_version(s)` take scenes, `import_storyboard` / the Import screen store inline scenes in the import's undo step, Box icon and **3D scene** render in the storyboard UI. P78 gaps: agent edits in mode `new` coalesce into one session version (`newVersion: true` starts another), batch tool `apply_scene_edits` (one undo step, one version, all or nothing), GLB from a URL in `add_scene_object` / `set_scene_object`. Rule 9 and rule 79 texts extended (no renumbering). |
| P80 | #332 | Scene editor Save / Cancel and phone layout (owner feedback after Phase 2): the editor edits its own copy with its own undo / redo; Save asks Replace current or Save as new version (one project undo step); Cancel / X / Esc ask before discarding unsaved changes; unsaved work is autosaved as a device draft (IndexedDB, per project and clip, with its base version) and offered back on the next open (a draft from another version saves as a new version); an outside change while editing shows a banner; phone: a bottom context toolbar for the selection whose buttons open form sections in sheets, header Save. Existing goldens unchanged. |
| P81a | #333 | Scene editor Edit view (owner feedback item 4, first half): a Camera view / Edit view toggle for the preview; the Edit view is a second sandboxed instance of the scene page in editor mode (orbit camera, grid, TransformControls move / rotate / scale, tap to pick, live drag values posted back); a drag writes the selected move / rotate / scale event's end value, or with Auto-key a key ending at the playhead, or the object's start value, as one step of the editor's undo; touch: larger handles, a floating chip bar (mode, axis X / Y / Z / Free, Snap, Auto-key, Reset view), one finger drags a handle or orbits, two fingers pan and zoom. OrbitControls / TransformControls vendored as editor-only libraries. Existing goldens unchanged. |
| P81b | — | Scene editor camera and lights (owner feedback item 4, second half): the camera has its own Camera track (the Scene track keeps scene-wide settings only) and is selected from it or in the Edit view, which draws its frustum and look-at point; the gizmo moves its position or look-at point, writing world.camera start values, the selected camera moveTo / lookAt event or (Auto-key) a camera key at the playhead. Lights get an optional `id` in `dionysus.scene/1`, a track each (static, no events), a form, and Edit view handles with helpers; selectable and movable only. Phone toolbar actions for the camera and lights. Rotate drags keep whole turns (360° no longer comes back as 0°). Agents: `set_scene_light`; `list_scene_objects` lists the camera start and lights; rule 79 text updated. Existing render goldens unchanged; the agent parity golden changed for the new tool and rule text. |

## 10. Known unverified areas

These have unit tests but were never checked end to end on real devices or with real services:

- **iPhone Safari fullscreen and orientation** (P59): the CSS-rotate fallback and controls were tested in Chrome
  device emulation only.
- **GLB / three.js export comparison** (P55, P57): no frame-by-frame comparison of preview vs exported MP4 for a code
  clip that loads a real GLB with animation. (P68 compared a GLB clip's export frames before and after the renderer
  move, which proves no change, not preview-vs-MP4 equality.) For **scene clips** this is closed by P75: with a real
  skinned, textured GLB (Khronos Fox) the Player's export-mode and preview-mode frames are pixel-identical in any
  seek order. Code clips that animate a GLB with their own clock are still unverified (their determinism is the
  clip author's).
- **Live WebMCP client sessions** (P12 onwards, P62, P63): tools are tested by calling them directly; no long session
  with a real browser agent client has been recorded since P62.
- **Local file server CORS / Private Network Access** (P62): `attach_asset_version(s)` and `import_storyboard` with
  `url` were tested with a mocked fetch; a real local server sending `Access-Control-Allow-Origin` and
  `Access-Control-Allow-Private-Network: true` from the public site was not tried. Real audio/video decode of fetched
  files was not tried either.
- P63 was verified with unit tests and placeholder shots in a browser, not on a large real project.

## 11. Where the plugin architecture stands

`docs/v2/CLIP_PLUGIN_ARCHITECTURE.md` is **Accepted** (decisions in its §0). Phase 1 (small PRs, zero behaviour
change, each merged on green CI) is **complete** (P65–P73):

- **1.1 done (P65):** `src/v2/clipTypes/` with `types.ts`, `registry.ts`, `load.ts`, glob discovery in `index.ts`,
  `variantOf`/`clipTypeOf`, and a `core.ts` per built-in (video, image, audio, text, html, effect, placeholder,
  blank, unknown) with `trackKind` and `caps` only. `clipTypes/parity.test.ts` pins every cap to today's predicates.
- **1.2 done (P66):** `trackKindFor`, `isStill`, `canChromaKey`, `hasSound` (`model.ts`), `sourceSpan`/`canSetRange`
  (`clipRange.ts`), `slipKind` (`slip.ts`), `setVolumeKeys` (`ops.ts`), `pasteItemGroup` (`chain.ts`) and export
  `audioPlan` read `clipTypeOf(p)` / `coreOf(kind)`. `domain` and `render` may import `clipTypes`. The parity test
  also compares them with the frozen pre-P66 implementations, so it is not circular.
- **1.3a done (P67):** `render/clipRenderers.ts` discovers `clipTypes/*/render.ts`; text, placeholder and blank draw
  through them (`ClipDrawHost` gives them the player's `paint` / `blit`). `render/renderParity.test.ts` hashes every
  canvas call for the fixture `src/v2/__fixtures__/renderParity.ts` against a golden recorded before the move; run
  with `RENDER_PARITY_DUMP=<dir>` to get per-frame call logs when it fails. Only regenerate the golden
  (`UPDATE_RENDER_GOLDEN=1`) for an intended look change, and say so in the PR.
- **1.3b done (P68):** html, video, image and audio render through `clipTypes/<id>/render.ts` with `frame(host)`
  (called every frame for a visible clip with an asset version, with or without a canvas, so audio stays in sync).
  The Player still owns the pools (media elements, iframes, gains, posters, WebCodecs export frames) and lends them
  through `ClipMediaHost`; the per-frame `ClipFrameState` (`live`, `loads`, `stalled`, `missing`) replaces the old
  locals of `draw()`. The shared element path is `render/mediaClip.ts`; an unregistered `clipType` uses
  `clipTypes/unknown/render.ts` (today's element path, until 1.8). The parity fixture now has audio, a reversed video
  overlay and a GLB code clip, and the jsdom test stubs media elements as loaded.
- **1.4 done (P69):** the timeline (`TimelineClip.tsx`, `Timeline.tsx`, `MergeDialog.tsx` through the shared helpers)
  and asset thumbnails/previews (`useThumbs.ts`, `useMedia.ts`) read `clipUi(p)` / `assetUi(kind)` from
  `ui/clipTypeUi.tsx`, which discovers `clipTypes/*/ui.tsx` (declarative fields; `DEFAULT_CLIP_UI` = a plain media clip
  named after its asset, also used for unknown ids). `ui/timelineParity.test.tsx` hashes the timeline markup of a
  fixture with every type (`TIMELINE_PARITY_DUMP=<dir>` writes it; `UPDATE_TIMELINE_GOLDEN=1` only for an intended
  change). Known edge, as in P67: a non-image clip carrying a `placeholder` / `blank` flag (the app never makes one) is
  now shown as its own type.
- **1.5 done (P70):** `V2App.tsx` reads `clipUi(p)` for the inspector (`inspectorIcon`, `inspectorTitle`,
  `inspectorTabs`, `inspectorActions`), the mobile toolbar (`toolbar`, `toolbarMain`, `extraTools`), the context menu
  and sheets (`editor`, `speed`, `volume`, `timeTools`, `inOutFrames`, `linkedAudio`, `transformInAudioTab`).
  Plugins list ids; the panels, tools and buttons stay in `V2App.tsx` (Q4, declarative). `KIND_ICON` and the
  `clipType` switch in `inspectorTabs()` are gone. `ui/inspectorParity.test.tsx` snapshots the desktop inspector (each
  tab), the context menu and the phone toolbar and sheets for every clip type selected
  (`INSPECTOR_PARITY_DUMP=<dir>`; `UPDATE_INSPECTOR_GOLDEN=1` only for an intended change). Same known edge as P69.
- **Decision recorded in P70 (owner, 2026-11-15; no behaviour change yet):** placeholder becomes a **cross-type clip
  state**, not an `image` variant/plugin. Any clip type can be a placeholder (a slot without an asset that knows its
  intended type, so pickers can filter assets). Player, timeline and export check `placeholder` first and use one
  shared slate renderer before plugin lookup; plugins never handle placeholders. `blank` stays a small plugin
  (`image` variant). No schema change. Implement it in **step 1.8** together with unknown-type handling
  (CLIP_PLUGIN_ARCHITECTURE §0 decision 9, §5, §7 row 1.8). Until then, do not add placeholder logic to other plugins.
- **1.6 done (P71):** storyboard mapping and media-kind detection read the clip type cores. `core.story`
  (`assetTypes`, `slotFallback`, `slotType`, `layerType`, `layer`, `sendLength`, `takes`, `params`; types without it
  use `DEFAULT_CLIP_STORY`) replaces `kindForSlot`'s switch, the `shotClipSpan` / `shotClip` / `mediaLayer` / Update
  kind checks in `storySend.ts` and the slot type, layer type and video-take checks in `storySync.ts`.
  `core.accepts` (`mimePrefix`, `mime`, `ext`, `mimeByExt`) replaces the lists in `persistence/media.ts`
  `mediaKindOf` / `mimeOf` (persistence may now import the `clipTypes` barrel). Helpers: `clipTypes/story.ts`
  (`storyOf`, `kindForSlotType`, `kindForFile`, `mimeForFile`). `domain/storyMappingParity.test.ts` compares frozen
  pre-P71 switches over every slot type, 870 file shapes and every kind, and a golden of Send, Update and Sync over
  shots and layers of every asset kind (`UPDATE_STORY_GOLDEN=1` only for an intended change). Left for later: the
  storyboard JSON validator's asset-type rules (`storyJson.ts`), `cueVideo` (audio taken from a video file) and the
  audio-cue checks.
- **1.7 done (P72):** the agent surface reads `core.agent` (`clipTypes/agent.ts`). Contributed `tools` are appended
  to `TIMELINE_TOOLS` (so `ALL_AGENT_TOOLS`, the guide and `WEB_MCP.md` list them) and run through `agent.run(name,
  input, api)` (`api.project()`, `api.edit(label, apply)` = one engine dispatch); contributed `rules` are appended
  after `RULE_LIST`'s built-ins; `describe` adds `clipJson` fields after the common ones. Built-ins contribute no
  tools, rules or fields, so `npm run gen:ai` is byte-identical. The per-type checks of `timelineTools.ts` are
  declarations: `agent.props` (`effect` on effect, `text` on text) and `agent.clipTools` (`set_clip_input` on html;
  `even_split_words`, `set_caption_words`, `word_align_prompt` on text; `set_blank_color` on blank, matched by its
  flag as before), read by `clipPropFits` / `clipToolFits`; the sound-position check reads `caps.sound`. The
  per-field `clipJson` output stays in `timelineReview.ts` (moving it would reorder JSON keys). `ui/agent/
  agentParity.test.ts` hashes the tool lists, schemas, rules, guide tool section, `get_timeline` / clip JSON and
  every per-type check on every clip of the parity fixture (`AGENT_PARITY_DUMP=<dir>`, `UPDATE_AGENT_GOLDEN=1`).
- **1.8 done (P73):** placeholder is a cross-type clip **state** (decision 9). `clipTypes/state.ts` has
  `isPlaceholder`, `placeholderCore` (the old placeholder caps; the intended type's track kind) and
  `placeholderAccepts`; `clipTypeOf(p)`, `clipRendererFor(p)` (shared slate `render/placeholderSlate.ts`) and
  `clipUi(p)` (`PLACEHOLDER_UI` / `placeholderUi(type)` in `ui/clipTypeUi.tsx`) check it before any plugin;
  `variantOf` resolves only `blank`; `clipTypes/placeholder/` is gone. Fill filters by the intended type (the image
  placeholder Send makes still takes any non-audio asset; a video / audio / html placeholder only its kind). Unknown
  types (§6): `isKnownClipType`; `validateComposition` accepts them on any track; `clipTypes/unknown/render.ts` draws
  the slate "Unknown clip type “<id>”" (black in export, nothing on audio tracks); not mixed in export;
  `exportUnknownTypeWarning` in the export dialog; `UNKNOWN_CLIP_UI` (amber card, one info tab `unknown`, no type
  tools); `clipJson` adds `unknown: true`. `ui/placeholderParity.test.tsx` (golden recorded on the pre-P73 code,
  `PLACEHOLDER_PARITY_DUMP=<dir>`, `UPDATE_PLACEHOLDER_GOLDEN=1`) pins the image placeholder and blank; the timeline,
  inspector and agent goldens changed only for the fixture's unknown clip. `ui/clipTypeState.test.tsx` covers a
  placeholder of every type and the unknown round trip; `ui/addingClipTypes.test.tsx` checks the guide's example.

**Phase 2** (deterministic three.js `scene` clip, §7 of the design doc) started in P74. **Decision 5 is accepted**
(2026-11-15, as recommended): a storyboard may mark a shot `render: "scene"` and use a `scene` asset type, both optional
values within `dionysus/3.1`, no version bump; it is implemented in step 2.6 (P79). **Phase 2 is complete since P79.** Phase 2 has its own step table (§7):
2.1 scene type + schema + evaluator + rendering (P74), 2.2 GLB models and animation (P75), 2.3 scene editor part 1 (P76:
own timeline per scene clip, forms, read-only tracks with selection), 2.4 scene editor part 2 (P77: drag / resize
retiming), 2.5 agent tools and AI rule (P78), 2.6 storyboard mapping (P79); one small PR per step, each merged on green
CI. **Renumbered in P76:** the owner confirmed the editor UX (own timeline, tracks per object, blocks by call, drag to
retime and resize, side panel, one undo step per gesture, version-save rules) and allowed a split; the former 2.6
(sub-tracks under the clip on the main timeline) is folded into 2.3 / 2.4, so agent tools moved to 2.5 and the
storyboard to 2.6 (design doc §7, the note under the table, and decision 6).

- **2.1 done (P74):** `clipTypes/scene/` (core: video track, `asset: "media"`, no sound / source time / thumbnail;
  render: `frame(host)`; ui: cube icon, Scene tab, no speed or volume). `domain/scene.ts`: `validateScene` /
  `parseScene` (errors and warnings with JSON paths), `stateAt(doc, t)` (pure; stable sort by `at`, tweens start from
  the value at their own start, last-started wins, lookAt resolved at the event's end, camera position / lookAt /
  fov), `sceneSummary`, `SAMPLE_SCENE`. `render/scenePage.ts`: the built-in three.js page; the Player's `sceneHost` /
  `sceneDoc` (`ClipMediaHost`) build it in the HTML clip host and export waits for the document (`settleAll`). The
  renderer sends `stateAt` as `ctx.inputs.scene` each frame, so the page has no clock. A document that can't be read
  shows a slate (black in export). `cmd.addSceneClip`, Code → 3D scene (desktop asset panel, phone Add media and Media
  sheet), `ui/ScenePanel.tsx` (read-only). Tests: `domain/scene.test.ts` (with a `stateAt` golden,
  `UPDATE_SCENE_GOLDEN=1`), `ui/sceneClip.test.tsx`. Every existing golden unchanged. Tests that used `"scene"` as an
  unregistered id now use `"hologram"`. The render parity fixture does not include a scene clip on purpose (jsdom has
  no WebGL; the Chrome check in the PR covers it).
- **2.2 done (P75):** a scene's `files` map (GLB models as data: URLs in the scene asset's version) and model objects
  (`model`, a number `size` fits the model, standing on y = 0). Animation is a property: object `animation` (from 0 s),
  `play { clip, speed, loop, from, fade }` / `stop { fade }` and `animation` in function rows (fade = the event's `dur`);
  `stateAt` gives each model the clips playing at `t` with unwrapped local time and weight (a fade keeps the previous
  clip running with 1 − k). `nodes` (object, `nodes` call, rows) shows or hides parts by node name; it never tweens.
  `domain/glb.ts` (`glbInfo`: clip names and lengths from the accessor `max`, node names) feeds validation (unknown
  clip / node → warning; missing or broken file → warning, the shape is drawn) and the Scene tab.
  `render/scenePage.ts` writes the files and `libs: ["three", "three-gltf"]` into the page's clip manifest only when
  a model exists (shape-only scenes render exactly as before: 50/50 frames identical to `main` in Chrome), loads models in `init` (before the first frame, so export waits), clones their materials (opacity per
  object; a model keeps its own colours) and poses each frame: `stopAllAction` (rest pose), every playing action
  `reset()`, weight, time scale = local time, then `mixer.setTime(1)`. Scene tab: **Add GLB model**
  (`addSceneModel` + `ui/sceneAsset.ts` `sceneVersion`, `cmd.addAssetVersion` with a label; one undo step) and each
  model's clip list. P74 gaps fixed: `scene` tool first on the phone clip toolbar (sheet with the same panel), scene
  assets in the picker's Code tab (`projectMediaList`), and `placementForAsset` gives `volume` only to the pre-registry
  types or a type with sound. Tests: `domain/sceneModel.test.ts` (golden `__golden__/sceneModelState.json`, numbers
  rounded to 1e-6, `UPDATE_SCENE_GOLDEN=1`), `ui/sceneModelUi.test.tsx`. Fixture GLB: `ui/cubeGlb.ts`
  `makeAnimatedGlb()` (Bot / Body / Head / Arm; Wave, Spin, Bounce).
- **2.3 done (P76):** `ui/SceneEditor.tsx`, opened by `V2App` state `sceneEdit` (desktop: Scene tab **Edit scene** or
  the clip menu **Edit scene…**, rendered in the timeline panel in place of the timeline; phone: the **Scene** clip tool,
  a full-screen sheet whose preview mirrors the player canvas). Tracks from `sceneTracks` (scene/camera first, one per
  object, unknown objects last; overlapping blocks stack in rows; blocks ≥ 44 px), a scene-time ruler that seeks the
  player, zoom, Add object (shapes, GLB). Side panel: `SceneForm` (name, planned length, background, camera start,
  lights; adding a light to a default-lit scene writes the defaults first), `ObjectForm` (id rename with references,
  base properties, model animation and parts, add event, delete), `EventForm` (call, at, duration, ease, args from
  `sceneCallArgs`, duplicate, delete, go to). Fields commit on blur / Enter / change (colour on the native `change`),
  so one gesture = one `engine.dispatch` = one undo step. Saving: `edit()` applies a pure `domain/sceneEdit.ts`
  operation to the scene the clip shows, stores it with `sceneVersion` and dispatches `cmd.addAssetVersion` (new
  `remember` option): **New version** adds a version on the first edit of the session and replaces that version for
  later edits (not remembered as the project's save mode); **Replace current** replaces the shown version. Preview:
  `Player.primeSceneDoc` + `ui/sceneAsset.ts` scene cache; `sceneHost` keys the page by `scenePageKey` (lights and
  object id / shape / size / model and files), so event and property edits keep the page and the scene renderer asks
  for the same time again (`fresh`); structural edits rebuild it. Tests: `domain/sceneEdit.test.ts`,
  `ui/sceneEditor.test.tsx`.
- **2.4 done (P77):** drag / resize retiming in `ui/SceneEditor.tsx` over the pure `domain/sceneRetime.ts`
  (`retimeSceneEvent(doc, i, "move" | "start" | "end", deltaSec, { min, max, snap, tol, fps })`, `sceneSnapTargets`,
  `moveSceneEventTo` / `moveEventProblem`). A drag keeps the scene it started from and applies one op with the total
  offset on every move (no step-by-step drift); the tracks draw the result (`Draft` state, the dragged block stays in
  its own track so pointer events keep their target, the drop track is highlighted) and `onPreview` →
  `Player.previewSceneDoc(blobKey, doc)` shows it live (it swaps the doc for that blob key and puts the stored one back
  with `undefined`; the page is kept because only events change). Release = one `edit()` (one dispatch, one undo step,
  version-save rules unchanged), then the preview is restored for the old key. No engine gesture is needed because
  nothing is dispatched during the drag. Window listeners (pointermove / up / cancel, Esc in the capture phase) so a
  re-render can't lose the drag; on touch only the selected block (`touch-action: none`) and the 44 px handles drag.
  Snapping tolerance 8 px; snap targets: other events, playhead, 0, clip in / out, then whole frames
  (`project.settings.fps`). The tracks auto-scroll near their edges once the pointer has moved half a lane that way.
  Ruler scrub (window listeners, `seekLocal`). Arrow-key nudges to the next whole frame. Esc in a field reverts typed
  text first; the desktop editor row is at least 440 px (`SCENE_EDITOR_MIN_H`, the splitter value is kept). Tests:
  `domain/sceneRetime.test.ts`, `ui/sceneEditorRetime.test.tsx`.
- **2.5 done (P78):** scene agent tools and RULE 79 through `core.agent`. Declarations (names, schemas, rule text) in
  `clipTypes/scene/agentDefs.ts`, imported by the core; the runner `clipTypes/scene/agent.ts` (`runSceneTool`) is
  loaded with `import("./agent")` from `core.agent.run`, because a core may import the domain only as types (the
  domain reads the registry). `architecture.test.ts` has the `clipTypes/agent` layer for `<id>/agent.ts` and refuses a
  static import of it. `ClipAgentApi.blobs` (get / put) is passed by `ui/agent/timelineTools.ts`. Pure operations in
  `domain/sceneAgent.ts` (`applySceneTool(name, doc, input)` → `{ doc, info, warnings }` or an error; an edit that
  adds a validation error is refused; `newSceneFromInput`, `sceneForAgent` shortens data URLs,
  `sceneObjectsForAgent` lists calls with arg hints). Each edit stores a new blob and makes one `api.edit` through
  `clipVersion.applyMediaFromClip` (`mode` from the input, else the project's; an explicit mode is remembered).
  (P78 added a version per mutating call in mode `new`; P79 replaced that with the agent session and added
  `apply_scene_edits`, see 2.6.) `get_timeline` has no scene fields (`get_scene`
  covers it). Event indexes are array positions. Tests: `domain/sceneAgent.test.ts`,
  `ui/agent/sceneAgentTools.test.ts`, `ui/agent/clipTypeAgent.test.ts`.
- **2.6 done (P79), Phase 2 complete:** the storyboard mapping (decision 5). `domain/storyJson.ts`: `"scene"` in
  `STORY_ASSET_TYPES`, `"scene"` in `SHOT_RENDERS` (a render scene shot's `clip` must be a scene asset), an optional
  inline `StoryAsset.scene` validated with `validateScene` (paths `assets[i].scene.<path>`), no `lastFrame` for scene
  assets, a generated one needs a prompt (scene brief) unless `scene` is given. `storyRefs.SLOT_TYPES` has `scene`
  (its length is checked at load). The scene core's `story` = `{ assetTypes: ["scene"], slotType: "scene",
  sendLength: "planned", takes: false, layer: false, shotRender: "scene" }`; `ClipStory.shotRender` (new, optional)
  is what `storySend.placeholderClip` uses for the placeholder's intended type (only scene declares it, so html / still
  placeholders stay `image` and the story-mapping golden is unchanged) and what `storySync` uses to turn a main-track
  clip of that kind into a render shot with its own clip slot (no `needsPrompt`). Overlay scene clips are skipped by
  Sync. UI: `ShotEditor` render **3D scene**, Box icon on the board (`BoardView` `TYPE_ICON` / `shotIcon`), shot
  detail upload of a scene `.json` (`ui/sceneAsset.ts` `readSceneInput` / `storeSceneMedia`), production label.
  Agent: `attach_asset_version(s)` take `text` / `scene` / a `.json` URL for scene assets (`ui/agent/mediaTools.ts`
  `prepare`, "Scene rejected: …"); `import_storyboard` (and the Import screen, `StoryboardView` `importWith`) store
  inline scenes through `ui/storyboard/inlineScenes.ts` `inlineSceneStep` in the import's dispatch (one undo step;
  equal scenes skipped; without a media store the import fails). The P78 gaps: `clipTypes/scene/agent.ts` keeps a
  module-level session `{ assetId, clipId, versionId, at }` (`SCENE_SESSION_MS` 10 min, `resetSceneAgentSession()`
  for tests); in mode `new` an edit of the session's clip whose shown version is the session's version saves with
  `{ mode: "replace", remember: false }`; `newVersion: true` forces a new one. `apply_scene_edits` →
  `domain/sceneAgent.ts` `applySceneEdits` (all or nothing, at most 200). `file: { url }` is resolved by `resolveFile`
  (`agentMedia.checkAgentUrl` with the page origin, `fetch` without credentials, `.glb` name, glTF magic, 64 MB) into a
  data URL before the pure operation. Rule texts: rule 9 (`html-only-for-graphics`) gained a sentence pointing at
  render scene and rule 79 (`scene-clips`) gained saving / batch / URL / storyboard paragraphs; no rule was added
  (a new built-in would renumber 79). Tests: `engine/storyScene.test.ts`, `ui/agent/sceneP79.test.ts`.

- **Scene editor follow-ups (owner feedback, 2026-11-16; design doc note under the Phase 2 table).** P80 Save /
  Cancel and the phone layout (done), P81a the Edit view with gizmos (done), P81b the camera and lights as objects in
  the Edit view (done; lights only selectable / movable), P82 Script objects (next; raw three.js code plus templates).
- **P80 done:** `ui/SceneEditor.tsx` keeps a `Work` copy (`doc`, `saved`, its own `past` / `future`, at most 200
  steps, base blob key and version); `edit()` only changes it, the preview gets the unsaved scene through
  `onPreview` (`Player.previewSceneDoc`), and **Save** (`ChoiceDialog`: `data-choice="replace" | "new"`, the last mode
  first) stores it with `sceneVersion` + one `cmd.addAssetVersion(…, { mode, remember: true })`. Cancel / X / Esc ask
  (`ConfirmDialog`) when dirty. Drafts: `ui/sceneDrafts.ts` (IndexedDB `dionysus-scene-drafts`, key
  `projectId/clipId`, the record keeps `baseVersionId` / `baseBlobKey`; memory store in tests via the `drafts` prop),
  written 600 ms after an edit and on `pagehide` / hidden / unmount, deleted on Save, Discard and when clean. A draft
  from another blob, or an outside change while dirty (`outside`, banner `scene-outside`), forces Save as new version;
  the editor's own saves are recognised by blob key (`ours`). Phone: `nav.v2-sed-ctx` (the main `.v2-toolbar` classes)
  with `Part` sections (`SceneForm` / `ObjectForm` / `EventForm` take `part`) in `Sheet`s. Agent tools still save
  directly (P79 session). Tests: `ui/sceneEditorSave.test.tsx`; the P76 / P77 editor tests now check the editor's undo
  and Save instead of a version per edit.
- **P81a done:** the preview toggle (`view` state; Camera view = the player, Edit view = `ui/SceneEditView.tsx`,
  portalled into the preview's `.v2-canvas-wrap` through the `viewHost` prop on desktop, in place of the `Mirror` on
  the phone). The page is `render/sceneEditPage.ts`: `SCENE_BUILD_JS` (split out of `SCENE_RUNTIME_JS`, which is
  byte-identical) + `SCENE_EDIT_JS` (OrbitControls, GridHelper, TransformControls, BoxHelper outline, raycast pick,
  render on demand: the HTML runtime's virtual clock is never advanced there). Messages `scene-edit:*` (see the
  file); the view rebuilds the page only when `scenePageKey` changes. Drags: `domain/sceneGizmo.ts` (`gizmoTarget`,
  `applyGizmo`, `gizmoViewTime`, `gizmoTargetLabel`); the end of a drag is one `edit()`. Libraries:
  `three-orbit` and `three-transform` in `render/htmlLibs.ts` with `editorOnly: true` (left out of
  `CLIP_HTML_LIBRARIES` / `CLIP_LIBRARIES`, the picker and detection). Tests: `domain/sceneGizmo.test.ts`,
  `render/sceneEditPage.test.ts`, `ui/sceneEditView.test.tsx` (the page's messages played by hand; the page itself
  was checked in Chrome).
- **P81b done:** `sceneTracks` starts with the Scene track (`#scene`, kind `scene`, no events) and the Camera track
  (`camera`), then objects, then one track per light (`#light-<i>`, kind `light`); only camera and object lanes carry
  `data-track` (drop targets) and ＋. `SceneSel` gained `{ kind: "camera" }` and `{ kind: "light", index }` with
  `CameraForm` / `LightForm`; the phone toolbar has camera (Start, Add event, Move, Aim) and light (Light, Move,
  Delete) actions. Light ids: `SceneLight.id` (validator: unique among objects and lights, not `camera`, events can't
  name one), `lightIdProblem`, `sceneLightIndex`, `sceneLightLabel`, `lightHasPosition` in `domain/sceneEdit.ts`.
  Gizmo ids `camera`, `camera:target`, `light:<i>` (`GIZMO_CAMERA_TARGET`, `gizmoLightId`, `gizmoMovesOnly`);
  `domain/sceneGizmo.ts` routes them through a `channel` (event object, calls, argument, start-value writer) so the
  camera uses the same event / Auto-key / base rules; `applyGizmo(…, { from })` unwraps rotations next to the drag's
  start (`unwrapDeg`). The page (`SCENE_EDIT_JS`) adds the camera rig (CameraHelper to the look-at distance, look-at
  sphere, dashed line), light handles with Point / DirectionalLightHelper, and applies `lights` from the state message;
  `sceneEditPageKey` ignores light values so moving a light never rebuilds it. Agents: `set_scene_light` (edit tool,
  also in `apply_scene_edits`), `list_scene_objects` returns `camera.start`, `lights`, `defaultLights`; rule 79 text
  updated (no new rule). Tests: `domain/sceneGizmo.test.ts`, `domain/sceneEdit.test.ts`, `domain/sceneAgent.test.ts`,
  `render/sceneEditPage.test.ts`, `ui/sceneEditView.test.tsx`, `ui/sceneEditor.test.tsx`.

**Next phase: Phase 3, third-party clip types** (design doc §7 Phase 3): a plugin package (`dionysus.cliptype/1`
manifest + sandboxed renderer page speaking the HTML clip frame protocol), host-validated tool calls forwarded to the
sandbox, per-project loading with consent and a lock (id, version, content hash), projects that keep working without
the plugin. Start with a design PR for the manifest and the loader before code, like Phase 1 and 2. New clip types
follow `docs/v2/ADDING_CLIP_TYPES.md`; the scene format is `docs/v2/SCENE_FORMAT.md`.

**Backlog and known limits after Phase 2** (candidates for small PRs before or during Phase 3):

- Scene clips on overlay tracks are not synced to the storyboard (a storyboard has no scene layer type); a scene
  layer type would need `LAYER_TYPES` and Send / Sync support.
- Inline `scene` on a storyboard asset is stored only by `import_storyboard` and the Import screen; the storyboard
  edit tools (`create_storyboard`, `add_asset`, `update_asset`) keep it in the JSON but don't store a version.
- The agent's scene session lives in the page (module state): a reload or a second tab starts a new one; the timeout
  is fixed at 10 minutes. A coalesced edit replaces the session version in place, so other clips pinned to that same
  version (split halves, copies) change with it, as with Replace current.
- GLB from a URL: at most 64 MB, the server must send CORS headers for the site (and Private Network Access headers
  for a local server from the public site); tested with a mocked fetch only.
- `get_timeline` still has no scene fields (`get_scene` covers them).
- Code clips that animate a GLB with their own clock are still unverified for preview vs export (scene clips are
  covered since P75).
- The Edit view's three.js page is only exercised in Chrome (screenshots and a scripted pick and drag in the PR), not
  in unit tests (jsdom has no WebGL). Since P81b a rotate drag keeps whole turns per axis (unwrapped next to the
  drag's start); a drag that crosses an Euler flip (e.g. X past ±90° with Y and Z set) can still come back as an
  equivalent but different triple.
- Scene drafts are per device and browser (IndexedDB), not synced; a draft for a clip that was deleted stays until
  that project and clip id are opened again. The agent tools don't see the editor's unsaved work.
- A new built-in AI rule takes number 79 and moves `scene-clips` to 80 (see §6.4).

## 12. Working habits that avoid repeat mistakes

- Search before writing: `rg -n "clipType ===|kind === \"html\"" src/v2` finds type-specific code.
- The word "document" in a domain-layer string fails the architecture test; reword it.
- `tasks.json` and `RULE_LIST` are append-only; never renumber.
- Generated files (`public/ai/*`, `public/llms.txt`, tool blocks in `WEB_MCP.md`) come from `npm run gen:ai`; edit
  the sources (`storyPrompt.ts`, tool definitions, presets), not the outputs.
- jsdom has no `Blob.text()` or `URL.createObjectURL`; tests that need them polyfill locally (see
  `ui/agent/mediaTools.test.ts`).
- `git push` can fail with a TLS handshake error now and then; retrying the same command works.
