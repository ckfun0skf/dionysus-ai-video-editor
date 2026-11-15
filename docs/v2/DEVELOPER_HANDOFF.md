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
  clipTypes/     clip type registry (P65+): one folder per type with core.ts (trackKind, caps); see its README.md
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
3. **`public/doc/tasks.json`:** add one entry per PR with the next free P-number: `{ "id": "P66-SHORT-NAME", "title":
   "<what and why, one paragraph>", "status": "done", "progress": 100 }` appended after the latest entry (the latest is
   `P65-CLIP-TYPES-SKELETON`; the next is **P66**). Bump `updatedAt`. Edit the file surgically (insert text); do not
   re-serialise the whole JSON. `scripts/check-tasks-updated.mjs` fails a PR that changes `src/` without it. If an id
   is already taken, use the next number and say so in the PR.
4. **AI guide rule:** append to `RULE_LIST` in `src/v2/domain/storyPrompt.ts` (append-only; numbers are positions;
   latest is **78** `story-order-insert`, next is **79**). Then:
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
8. Commit in English; PR title `P66: …`; body says what, why, tests, and `Fixes #N` (or `Refs #N` if partial), plus
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
| `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md` | clip type plugins: accepted design, decisions, Phase 1 progress |
| `public/doc/tasks.json` | every task and its status |

## 9. Recent history (P47–P65)

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
| P65 | — | Clip type plugins Phase 1 step 1.1: `src/v2/clipTypes/` registry, core caps, parity test (no behaviour change). |

## 10. Known unverified areas

These have unit tests but were never checked end to end on real devices or with real services:

- **iPhone Safari fullscreen and orientation** (P59): the CSS-rotate fallback and controls were tested in Chrome
  device emulation only.
- **GLB / three.js export comparison** (P55, P57): no frame-by-frame comparison of preview vs exported MP4 for a code
  clip that loads a real GLB with animation.
- **Live WebMCP client sessions** (P12 onwards, P62, P63): tools are tested by calling them directly; no long session
  with a real browser agent client has been recorded since P62.
- **Local file server CORS / Private Network Access** (P62): `attach_asset_version(s)` and `import_storyboard` with
  `url` were tested with a mocked fetch; a real local server sending `Access-Control-Allow-Origin` and
  `Access-Control-Allow-Private-Network: true` from the public site was not tried. Real audio/video decode of fetched
  files was not tried either.
- P63 was verified with unit tests and placeholder shots in a browser, not on a large real project.

## 11. Where the plugin architecture stands

`docs/v2/CLIP_PLUGIN_ARCHITECTURE.md` is **Accepted** (decisions in its §0). Phase 1 (eight small PRs, zero behaviour
change, each merged on green CI) is under way:

- **1.1 done (P65):** `src/v2/clipTypes/` with `types.ts`, `registry.ts`, `load.ts`, glob discovery in `index.ts`,
  `variantOf`/`clipTypeOf`, and a `core.ts` per built-in (video, image, audio, text, html, effect, placeholder,
  blank, unknown) with `trackKind` and `caps` only. `clipTypes/parity.test.ts` pins every cap to today's predicates.
  Nothing in the app reads the registry yet.
- **Next, 1.2:** make `trackKindFor`, `isStill`, `hasSound`, `canChromaKey` (`model.ts`), `canSetRange`
  (`clipRange.ts`), `needsThumb` and the `ops.ts`/`slip.ts`/`chain.ts` checks read `clipTypeOf(p).caps`, and
  `audioPlan` use `caps.sound`. That step lets `domain` import `clipTypes` (add it to `ALLOWED.domain` in
  `architecture.test.ts`); the parity test must keep passing unchanged.

Until Phase 1 is finished, add new behaviour the existing way and note in the PR which switch points you touched, so
the later steps can move them.

## 12. Working habits that avoid repeat mistakes

- Search before writing: `rg -n "clipType ===|kind === \"html\"" src/v2` finds type-specific code.
- The word "document" in a domain-layer string fails the architecture test; reword it.
- `tasks.json` and `RULE_LIST` are append-only; never renumber.
- Generated files (`public/ai/*`, `public/llms.txt`, tool blocks in `WEB_MCP.md`) come from `npm run gen:ai`; edit
  the sources (`storyPrompt.ts`, tool definitions, presets), not the outputs.
- jsdom has no `Blob.text()` or `URL.createObjectURL`; tests that need them polyfill locally (see
  `ui/agent/mediaTools.test.ts`).
- `git push` can fail with a TLS handshake error now and then; retrying the same command works.
