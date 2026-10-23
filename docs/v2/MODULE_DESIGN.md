# Dionysus v2 — Module Architecture Design

**Status:** Proposal · **Date:** 2026-10-23 · **Scope:** `src/v2/` rebuild, coexisting with the legacy app

## 1. Context

The current app is a monolith (`src/App.tsx` ≈3.4k lines, `styles.css` ≈3.5k lines). Its core mistake is treating storyboard, timeline, references and assets as separate state planes with separate mutation paths. Issue #110 and `docs/architecture/UNIFIED_COMPOSITION_MODEL.md` already identify the fix: **one canonical composition engine, one history, command-based editing**. PR #111 (`editorSession*.ts`) moves in that direction inside the legacy shell. v2 makes it the foundation rather than a retrofit.

Ideas reused from existing docs (all retained as v2 invariants):
- **Master Timeline = root Composition**; **Clip Asset Version = reusable Composition**, edited by the same editor.
- **Track kinds** are `video | audio | text` (+ `overlay` for HTML in v2); image/video/shot/code/clip are *source* types, not track kinds.
- **Linked audio is an owned child placement** of the video placement; **Extract Audio** detaches it, **Duplicate Audio** copies it to an audio track.
- **Pinned versions:** new generations never silently replace a placement's pinned version.
- **Atomic history:** every user gesture = one undo step (e.g. split + reselect, drag across tracks).
- **Save-as-Clip** preserves editable structure (it copies the Composition, not a render).
- **Manual-first production:** copy-prompt/import works before any API integration.

## 2. Goals / Non-goals

**Goals**
1. Full-featured timeline composer first: video, image, audio/music, subtitles, HTML components (html/css/js, native three.js); transitions later.
2. A one-stop pipeline: story chat → template-driven JSON → storyboard (shots, references, prompts, QA) → production to-do → timeline.
3. First-class **versions** for assets and shots (choose among ~10), with provenance and dependency/staleness tracking (incl. *last frame of shot X* as an asset).
4. Extensible by registries (clip types, effects, importers/exporters, AI providers, QA checkers) so the tool can be published later.
5. Pure, testable domain core; UI is a thin client of the engine.

**Non-goals (v2.0)**
- Cloud sync, multi-user collaboration, accounts (interfaces only).
- Built-in AI generation API calls or an autonomous agent (provider interface only).
- Transitions/effects beyond a registry stub; color grading; keyframe curves beyond opacity/volume/transform.
- Bidirectional compatibility with legacy schema (import is one-way).

## 3. Layered architecture

```
 ┌───────────────────────── ui/ (React) ─────────────────────────┐
 │ workspace shells (desktop / mobile), panels, timeline view    │
 └──────────────┬──────────────────────────────┬─────────────────┘
                │ dispatch(Command), select()   │ <PreviewSurface/>
 ┌──────────────▼──────────────┐   ┌───────────▼─────────────────┐
 │ engine/  commands, history, │   │ render/  frame graph,        │
 │ store, selectors, events    │   │ playback clock, audio, export│
 └──────────────┬──────────────┘   └───────────┬─────────────────┘
                │                               │
 ┌──────────────▼───────────────────────────────▼─────────────────┐
 │ domain/  pure TS types + functions (no DOM, no async, no React) │
 └──────────────▲─────────────────────────────────────────────────┘
                │ implements ports
 ┌──────────────┴──────────────┐   ┌─────────────────────────────┐
 │ persistence/ IndexedDB,     │   │ plugins/ registries' built-in│
 │ memory, (cloud later)       │   │ clip types, importers, QA…   │
 └─────────────────────────────┘   └─────────────────────────────┘
```

**Dependency rules** (enforced by ESLint `no-restricted-imports` + a test that scans imports):
| Layer | May import | Must not import |
|---|---|---|
| `domain` | nothing outside `domain` | React, DOM, `idb`, `engine`, `render` |
| `engine` | `domain`, `ports` | React, DOM, persistence implementations |
| `persistence` | `domain`, `ports` | `engine` internals, UI |
| `render` | `domain`, `ports`, `registry` | `engine` mutation APIs, UI |
| `plugins` | `domain`, `registry`, `render` types | UI internals |
| `ui` | everything above via public `index.ts` | other features' internals; `legacy` `src/*` |
| v2 anything | — | legacy `src/*.ts(x)` (except the one-way importer, which copies needed code) |

## 4. Folder tree

```
src/v2/
  main.tsx                 # v2 entry (mounted by ?v2 or /v2/)
  domain/
    ids.ts  time.ts        # branded ids, frame/tick math (integer ticks, rational fps)
    project.ts asset.ts shot.ts composition.ts subtitle.ts htmlComponent.ts
    graph.ts               # dependency graph + staleness
    validate.ts            # structural validation (schema 3.x)
    ops/                   # pure placement ops: insert, move, trim, split, ripple, snap
  ports/                   # interfaces only
    storage.ts blobStore.ts clock.ts generator.ts
  registry/
    clipTypes.ts trackTypes.ts effects.ts importers.ts exporters.ts generators.ts qaCheckers.ts
  engine/
    commands/              # one file per command family (timeline, asset, shot, storyboard)
    history.ts transaction.ts store.ts selectors.ts events.ts
  persistence/
    indexeddb/ memory/ schema/ (migrations 3.x→3.y) importLegacy/ (1.0/2.0 → 3.0)
  render/
    frameGraph.ts          # resolve composition @ t → ordered layer list (pure)
    canvas2d/ webgl/ html/ audio/ playback.ts export/
  plugins/                 # built-in registrations: video,image,audio,text,subtitle,html,three
  pipeline/                # story JSON schema, prompt templates, todo derivation, QA
  ui/
    shell/ desktop/ mobile/ timeline/ preview/ browser/ inspector/ storyboard/ versions/
    hooks/ (useEngine, useSelector, usePlayback)
  test/fixtures/
```

## 5. Domain model (schema 3.0)

Time is stored in integer **ticks** (`1 s = 120_000 ticks`, divisible by 24/25/30/48/50/60 and 44.1k-friendly rounding) to avoid float drift; UI converts to frames.

```ts
type Id<T extends string> = string & { __brand: T };

interface Project {
  schema: "dionysus/3.0"; id: Id<"project">; name: string;
  settings: { width: number; height: number; fps: { num: number; den: number }; sampleRate: number };
  rootCompositionId: Id<"composition">;
  assets: Record<Id<"asset">, Asset>;
  shots: Record<Id<"shot">, Shot>;
  compositions: Record<Id<"composition">, Composition>;
  storyboard: Storyboard;            // ordered shot ids + edges
  subtitles: Record<Id<"subtitleDoc">, SubtitleDoc>;
  htmlComponents: Record<Id<"html">, HtmlComponent>;
  qa: QaResult[]; meta: { createdAt: string; updatedAt: string; appVersion: string };
}

type AssetKind = "image" | "video" | "audio" | "character" | "location" | "prop" | "style" | "clip";
interface Asset {                     // identity ("Hero character", "Shot 3 last frame")
  id: Id<"asset">; kind: AssetKind; name: string; tags: string[];
  prompt?: PromptSpec;                // generation prompt for this asset
  versions: AssetVersion[]; selectedVersionId?: Id<"assetVersion">;
  derivation?: Derivation;            // e.g. last frame of a shot
}
interface AssetVersion {
  id: Id<"assetVersion">; createdAt: string; label?: string; rating?: 0|1|2|3|4|5;
  media?: MediaRef;                   // blob key + mime + duration + dims + thumb key
  compositionId?: Id<"composition">;  // kind "clip": Clip Asset Version = Composition
  provenance: Provenance;
}
interface MediaRef { blobKey: string; mime: string; durationTicks?: number; width?: number; height?: number; thumbKey?: string; hash?: string }

interface Shot {
  id: Id<"shot">; title: string; description: string; durationHintTicks?: number;
  referenceAssetIds: Id<"asset">[];   // required inputs
  prompt: PromptSpec;
  versions: ShotVersion[]; selectedVersionId?: Id<"shotVersion">;
  qaChecks: QaCheckSpec[];
}
interface ShotVersion {
  id: Id<"shotVersion">; createdAt: string; media: MediaRef; rating?: number; notes?: string;
  provenance: Provenance;
}
interface Provenance {
  source: "import" | "manual-generation" | "provider" | "derived" | "legacy";
  providerId?: string; model?: string; seed?: string;
  promptText?: string;                       // exact prompt used (frozen copy)
  inputs: { assetId: Id<"asset">; versionId: Id<"assetVersion"> }[]; // frozen input versions
}
type Derivation =
  | { type: "lastFrame";  shotId: Id<"shot">; shotVersionId: Id<"shotVersion"> }
  | { type: "firstFrame"; shotId: Id<"shot">; shotVersionId: Id<"shotVersion"> }
  | { type: "frameAt";    shotId: Id<"shot">; shotVersionId: Id<"shotVersion">; ticks: number };

interface Storyboard { order: Id<"shot">[]; edges: { from: Id<"shot">; to: Id<"shot">; kind: "continuity" | "cut" | "match" }[] }
```

### 5.1 Dependency graph and staleness
`domain/graph.ts` derives (never stores) a DAG: `AssetVersion ← ShotVersion.provenance.inputs`, `Asset(derivation) ← ShotVersion`, `Placement ← pinned version`.
- `staleness(project)` returns warnings: **`input-changed`** (a shot's selected version used asset version v1 but the asset's selected version is now v2); **`derived-source-changed`** (an asset derived from *last frame of Shot A v3* while Shot A now selects v5 → every shot consuming that asset gets “may not match”); **`pinned-outdated`** (timeline placement pins an older version — info, never auto-replaced).
- **Link last frame** is one command: `asset.deriveFromShot({shotId, versionId, at:"last"})` extracts the frame (render port), creates an AssetVersion with `source:"derived"`, and adds it as a reference to the target shot — single undo step.
- Cycle detection reuses the idea of legacy `clipAssetGraph.findClipAssetCycle` for both clip nesting and derivations.

### 5.2 Composition

```ts
interface Composition {
  id: Id<"composition">; name: string; settings?: Partial<Project["settings"]>;
  tracks: Track[];                    // ordered; index 0 = top visual layer
}
interface Track { id: Id<"track">; kind: string /* registry: video|audio|text|overlay */; name: string;
  muted?: boolean; locked?: boolean; hidden?: boolean; placements: Placement[] }   // sorted, non-overlapping
interface Placement {
  id: Id<"placement">; trackId: Id<"track">;
  startTicks: number; durationTicks: number;     // on parent timeline
  source: SourceRef; sourceInTicks: number; speed?: number;
  clipType: string;                              // registry key: "video","image","audio","text","subtitle","html","three","composition"
  props: Record<string, unknown>;                // validated by clip type schema
  transform?: Transform2D; opacity?: number; volume?: number; fadeInTicks?: number; fadeOutTicks?: number;
  effects?: EffectInstance[]; transitionIn?: TransitionInstance;
  linkedChildren?: Placement[];                  // owned linked audio
}
type SourceRef =
  | { kind: "assetVersion"; assetId: Id<"asset">; versionId: Id<"assetVersion"> }   // pinned
  | { kind: "shotVersion";  shotId: Id<"shot">;   versionId: Id<"shotVersion"> }
  | { kind: "composition";  compositionId: Id<"composition"> }                     // nested clip
  | { kind: "subtitle";     docId: Id<"subtitleDoc"> }
  | { kind: "html";         componentId: Id<"html"> }
  | { kind: "generated" };                                                          // text/solid
interface SubtitleDoc { id: Id<"subtitleDoc">; cues: { id: string; startTicks: number; endTicks: number; text: string; style?: string }[]; styles: Record<string, TextStyle> }
interface HtmlComponent { id: Id<"html">; name: string; html: string; css: string; js: string;
  runtime: "dom" | "three"; params: ParamSchema; durationTicks?: number }
```

## 6. Extension points (registries)

All registries share `createRegistry<T extends { id: string }>()` with `register/get/list` and are populated in `plugins/index.ts`; third-party plugins later register the same way.

| Registry | Contract (abridged) |
|---|---|
| `clipTypes` | `{ id, trackKinds, propsSchema, defaultDuration(src), renderLayer(ctx,t), audioNode?(ctx), inspector?: React.FC }` |
| `trackTypes` | `{ id, accepts(clipType), renderOrder }` |
| `effects` / `transitions` | `{ id, params, apply(gpuCtx, inputs, t) }` (stub in v2.0) |
| `importers` / `exporters` | `{ id, accept(file|json), import(...) → Command[] }` / `{ id, export(project, opts) → Blob }` (story JSON, SRT/VTT, legacy 1.0/2.0, MP4/WebM, project zip) |
| `generators` | `{ id, kinds, buildPrompt(spec), generate?(req, signal) → AssetVersion }` — `manual` provider (copy prompt, import result) ships first |
| `qaCheckers` | `{ id, appliesTo: "asset"|"shot"|"composition", run(project, target) → QaResult[] }` (missing reference, stale input, duration mismatch, resolution, aspect) |

## 7. Commands & history

- **Command** = `{ type, payload }`; a handler is `(draft: Project, payload, ctx) => void` applied via Immer-style structural sharing (or hand-rolled patches) producing **forward + inverse patches**.
- `engine.dispatch(cmd | cmd[], { label, coalesceKey? })` runs one **transaction**; validation runs on the result; on failure nothing is committed.
- **History** stores `{ label, patches, inversePatches, selectionBefore/After }`. One stack per project (root and nested compositions share it — editing a Clip Asset in a nested view is still undoable globally). Coalescing merges continuous drags/slider changes with the same `coalesceKey` within a gesture.
- **Gesture previews** (drag, trim) are ephemeral UI state rendered via pure `domain/ops` preview functions; a single command commits on pointer-up.
- Selection, playhead, zoom are **session state** (not in history, persisted separately).
- Events: `engine.subscribe(selector, cb)`; `useSelector` in React via `useSyncExternalStore`.

## 8. Storage

```ts
interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id): Promise<Project>; save(project, { baseRevision }): Promise<{ revision: number }>;
  delete(id): Promise<void>;
}
interface BlobStore { put(blob, meta): Promise<string /*key*/>; get(key): Promise<Blob>; url(key): Promise<{ url: string; release(): void }>; delete(key) ; gc(liveKeys) }
```
- **IndexedDB now** (`idb` wrapper): stores `projects`, `blobs`, `thumbs`, `session`. Debounced autosave (≈500 ms after commit) + save on `visibilitychange`. Optimistic `revision` guards against two tabs.
- Blobs content-hashed (SHA-256) for dedupe; GC from reachable `MediaRef`s.
- **Cloud later**: same interfaces; `revision` becomes server etag; blobs uploaded lazily. Memory implementation used in tests; one shared contract test suite runs against every implementation.
- Export/import: `.dionysus.zip` (project JSON + blobs).

## 9. Render pipeline

1. **Frame graph** (pure): `resolveFrame(project, compositionId, t)` → ordered `Layer[]` (recursing into nested compositions with time remap; cycle-safe).
2. **Preview**: Canvas 2D compositor first (`<video>` elements with seek/play sync, `ImageBitmap` for images, text via canvas); WebGL compositor later for effects/transitions. Playback clock = `AudioContext.currentTime` master; video elements slaved with drift correction.
3. **Audio**: Web Audio graph per active placement (gain envelopes reusing `audioEnvelope` math).
4. **HTML / three.js layers**: run in a sandboxed `iframe` (`sandbox="allow-scripts"`, no same-origin) with a postMessage protocol `{ seek(t), play, pause, params }`; component must be **deterministic in t** (the `t` is supplied, no wall clock). Preview overlays the iframe in the DOM above canvas; export captures via `OffscreenCanvas` transfer from the iframe (three.js renders to its canvas → `transferToImageBitmap`); DOM-only components export via SVG `foreignObject` rasterization (documented limitation).
5. **Export**: frame-stepped offline render → **WebCodecs** `VideoEncoder`/`AudioEncoder` + mp4 muxer (`mp4-muxer`); fallback `MediaRecorder` WebM (legacy approach). Runs in a worker where possible; progress + cancel.

## 10. Schema versioning & legacy import

- Every document carries `schema: "dionysus/<major>.<minor>"`. Minor bumps = additive, migrated in `persistence/schema/migrations` (ordered pure functions, each tested with fixtures). Major = new importer.
- **One-way legacy importer** (`importLegacy/`) for schema **1.0** (legacy `types.ts` project) and **2.0** (`dionysus-project-document`): reuse ideas from `compositionMigration` (legacy timeline → root composition; linked audio → owned children), output 3.0 plus a warnings report (unsupported fields, missing blobs). No 3.0 → legacy writer.

## 11. Legacy module audit

| Module | Decision | Notes |
|---|---|---|
| `compositionModel.ts` | **Adapt** | Concepts (track kinds, linked audio child, pinned version, provenance) carried into `domain/composition.ts`; drop dependency on legacy `types.ts`. |
| `compositionCommands.ts` | **Adapt** | Placement ops + invariants (insert/move/trim/split/duplicate, resize preview) ported into `domain/ops` as pure functions; tests ported. Ticks replace seconds. |
| `compositionRenderer.ts` | **Drop** (mine ideas) | Coupled to legacy project, master timeline, DOM; v2 splits frame graph/compositor/export. Keep video-seek wait and WebM fallback ideas. |
| `timelineResize.ts` | **Drop** | Superseded by composition-level resize in `compositionCommands`/`domain/ops`. |
| `audioEnvelope.ts` | **Reuse as-is** | Pure, tiny, tested; copy to `domain/audio/envelope.ts` (seconds→ticks wrapper). |
| `mediaAssetStore.ts` | **Adapt** | Becomes `persistence/indexeddb/blobStore.ts` behind `BlobStore`; add hashing, GC, URL lifetime. |
| `mediaThumbnail.ts` | **Reuse (light adapt)** | Image/video thumbnail generation moves to `render/thumbnails.ts`; store thumbs as blobs not data URLs. |
| `projectDocument.ts` | **Drop** (input only) | 2.0 envelope only read by legacy importer. |
| `projectValidation.ts` | **Drop** | Rewritten for schema 3.0 in `domain/validate.ts`; legacy validation reused inside importer. |
| `compositionMigration.ts` | **Adapt** | Core of `importLegacy/` (one-way); `projectRootCompositionToLegacy` dropped. |

PR #111 `editorSession*.ts`: treat as reference for session-state shape (selection/playhead/zoom); do not import.

## 12. Coexistence & switch-over

1. **Side-by-side:** v2 is a separate Vite entry (`v2/index.html` → `src/v2/main.tsx`), also reachable via `?v2` on the main page. Same Pages deployment; legacy untouched.
2. **Separate storage:** v2 uses its own IndexedDB database (`dionysus-v2`). Legacy data reaches v2 only through *Import legacy project* (from JSON export or by reading the legacy DB read-only).
3. **Feature flag** `localStorage["dionysus.ui"] = "v2"` makes `/` redirect to v2; banner “Back to classic”.
4. **Switch-over** when the MVP + importer pass the acceptance checklist: v2 default, legacy at `?legacy` for one release, then removed (legacy files deleted in one PR; importer keeps its copied code).

## 13. Testing strategy

- **Domain/engine:** Vitest unit tests; property-style tests for ops (no overlaps, duration conservation on split, `undo∘do = id`), fixture tests for importers and migrations.
- **Contract tests:** one suite per port run against memory + IndexedDB (`fake-indexeddb`).
- **Render:** frame-graph tests are pure; compositor tested with a fake 2D context recording draw calls.
- **UI:** React Testing Library for panels and command wiring; Playwright smoke (desktop + mobile viewport) on the Pages preview later.
- **Architecture test:** scan imports to enforce §3 rules.
- CI gate: `npm test && npm run build` on every PR (existing `ci.yml`).

## 14. Project tracking

Problem observed: progress lived in long-lived PRs while `public/doc/tasks.json` and task docs on `main` went stale, so the owner could not read status from `main`.

Rules:
1. **`main` is the single source of truth.** Anything not merged does not count as progress.
2. **Small PRs, merged promptly** (target < 400 changed lines, ≤ 2 days open). No long-lived draft PRs; incomplete UI ships behind the v2 flag instead.
3. **Every PR updates `public/doc/tasks.json` in the same PR**: task `status`, `progress`, `prs: [{number,url,state}]`, `updatedAt`. CI check (`scripts/check-tasks-updated.mjs`) fails a PR that touches `src/` without touching `tasks.json` (label `no-task` to bypass for chores).
4. **Generated STATUS page**: `scripts/build-status.mjs` reads `tasks.json` → `public/doc/STATUS.html` at build time (per-milestone progress bars, in-flight PRs, last-updated, links to task docs). Deployed with Pages.
5. v2 milestones are added to `tasks.json` with ids `V2-Mx` / tasks `V2-0xx` (fragment: `tasks.v2.fragment.json` alongside this doc). Each task has `acceptance` criteria; `done` requires evidence (merged PR + test).

## 15. Phased roadmap (PR-sized)

| # | PR | Milestone |
|---|---|---|
| 1 | Design doc + tasks.json v2 entries + STATUS generator | V2-M0 |
| 2 | `domain/` ids, time, composition types, validate | V2-M0 |
| 3 | `domain/ops` placement ops ported + tests | V2-M1 |
| 4 | Engine: store, transactions, history, selectors | V2-M1 |
| 5 | Persistence ports + memory + IndexedDB + contract tests | V2-M2 |
| 6 | v2 entry + desktop shell (browser / preview / timeline) | V2-M2 |
| 7 | Media import (video/image/audio) + thumbnails | V2-M2 |
| 8 | Timeline view: add/move/trim/split/delete/snap | V2-M2 |
| 9 | Preview playback (canvas + audio clock) | V2-M2 |
| 10 | Mobile CapCut-style shell (fixed center playhead, contextual bottom toolbar, touch trim) | V2-M2 |
| 11 | Legacy importer 1.0/2.0 | V2-M2 |
| 12–15 | Text/subtitles, HTML+three.js clips, nested compositions/Save-as-Clip, WebCodecs export | V2-M3 |
| 16–20 | Story JSON template/importer, versions UI, dependency/staleness, to-do + QA, storyboard→timeline | V2-M4 |
| 21 | Switch-over | V2-M5 |

## 16. Parallelization (contract-first)

Once PRs 2, 4 and 5 land, the **contracts** (`domain` types, `ports/*`, `registry/*` interfaces, command catalogue) are frozen per milestone. Then independent streams can run in parallel with agents/contributors: (a) timeline UI, (b) render/playback, (c) persistence, (d) pipeline/storyboard, (e) clip-type plugins. Each stream owns a folder, codes against interfaces and fakes, and changes a contract only via a small dedicated PR reviewed first. Fixtures in `src/v2/test/fixtures` are the shared language.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Video seek accuracy/perf in browser preview | Canvas compositor with frame-cache; WebCodecs decode later; interactive mode tolerates late frames |
| HTML/three.js export determinism | Require `t`-driven components; iframe sandbox protocol; document DOM-raster limits |
| IndexedDB quota / Safari eviction | `navigator.storage.persist()`, quota UI, zip export |
| Scope creep before MVP is testable | Timeline-first roadmap; pipeline gated until V2-M2 done |
| Two apps diverge / user data confusion | Separate DB, explicit import, clear banner |
| Tracking drift again | CI check + generated STATUS page (§14) |
