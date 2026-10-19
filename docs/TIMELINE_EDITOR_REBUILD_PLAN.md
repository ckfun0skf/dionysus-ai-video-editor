# Dionysus Timeline-First Editor Rebuild Plan

**Status:** Active implementation plan · **Updated:** 2026-10-19  
**Product direction:** Owner-confirmed  
**Repository:** `ckfun0skf/dionysus-ai-video-editor`

## 1. Executive decision

Rebuild the **Timeline Editor workspace** as the first complete, coherent authoring experience. Do not rebuild the whole product as an empty project or discard proven domain code. Replace the Editor's UI/workspace architecture and, where needed, consolidate its state boundary while preserving project compatibility, validated editing operations, media/provenance models, and regression coverage.

The Timeline Editor must be useful before Storyboard or Reference-planning workflows exist. It contains its own source browser for project media and an Effects/Transitions area, a preview/canvas, and a multitrack timeline. Later, Storyboard and References become separate planning tools connected to the Editor—not prerequisites for opening or editing a timeline.

This plan is the authoritative sequence for the workspace rebuild. Existing broad roadmaps and old mobile navigation notes should be read through this direction whenever they conflict.

## 2. Decisions and boundaries

### Confirmed product direction

1. **Timeline-first:** Timeline Editor is the first complete product surface and the foundation that future planning modules connect to.
2. **Desktop workspace:** source/assets/effects browser in the upper-left, preview/canvas in the upper-right, and multitrack timeline across the lower workspace.
3. **Editor-owned asset access:** a user can browse project assets, audio, text, effects and transitions without leaving the Timeline Editor. The Editor source browser is not the same as a future full Asset Management workspace.
4. **Contextual editing controls:** selecting a clip/layer exposes operations for that element. On mobile, the bottom action bar is for selected-element/workspace editing controls—not a permanent row of Storyboard / Timeline / Assets / References navigation buttons.
5. **Separate app/module navigation:** future modules remain available from a project/workspace switcher or app-level navigation. That navigation must not compete with the Editor's contextual tool bar.
6. **One editor model:** Master Timeline and nested Clip Asset Compositions use the same document contract, editing commands and history semantics.
7. **Data safety over visual speed:** preserve import of current schema-1.0 projects; migrations are deterministic and non-destructive. A pinned Shot/Clip version never silently changes.
8. **Rebuild the workspace, not the entire product:** retain validated pure utilities, types, project validation, media identities, test fixtures and compatible project I/O when evidence supports reuse. Do not copy the current large `App.tsx` wholesale into a second editor or create parallel mutable editor state.
9. **No browser smoke tests:** use deterministic unit/component/integration tests, TypeScript/build CI, then a deployed manual acceptance pass. Do not add/run automated browser smoke tests.

### Target desktop layout

```text
┌──────────────────────── Dionysus / Project / Workspace Switcher ───────────┐
│ [Media | Audio | Text | Effects | Transitions] │ [Preview / Canvas / Play] │
│ [Browse / search / source versions / add]       │ [Optional Inspector]      │
├────────────────────────────────────────────────────────────────────────────┤
│ Timeline toolbar: selection | undo/redo | zoom | fit | settings            │
├────────────────────────────────────────────────────────────────────────────┤
│ Track headers         │ Time ruler / playhead / editable placements        │
│ Video / Audio / Text  │ Multi-track timeline; horizontal timeline scrolling│
└────────────────────────────────────────────────────────────────────────────┘
```

The upper area is resizable/collapsible where practical. The preview remains the visual focus. A selected-element Inspector may dock beside the preview on wide screens or appear as a panel/sheet when space is constrained; it must not permanently crush the timeline.

### Target mobile layout

```text
┌──────────── Project / Back / Workspace menu ────────────┐
│                 Preview / Canvas                        │
├─────────────────────────────────────────────────────────┤
│ Compact playback / timecode / Undo-Redo                 │
│ Timeline toolbar and horizontally scrollable tracks     │
│ Video / Audio / Text lanes                              │
├─────────────────────────────────────────────────────────┤
│ Contextual action bar: selected clip/layer operations   │
└─────────────────────────────────────────────────────────┘
```

On mobile, Media/Effects browsing and detailed properties open focused sheets/panels. The bottom contextual action bar changes with selection: with no selection it offers workspace actions; with a clip selected it offers appropriate operations such as edit, trim, split, duplicate, mute or properties. App/module switching remains reachable from the header/menu, not permanently embedded in this bar.

### Included in the first usable Timeline Editor

- Project open/restore and non-destructive save/export compatibility for existing projects.
- Source browser for project media and generated/imported sources, search/filter, preview where supported, and explicit insert/add-to-timeline actions.
- Tabs/categories for Media, Audio, Text, Effects and Transitions. Only effects/transitions that actually work end-to-end may be enabled; do not ship inert controls pretending to apply an effect.
- Composite preview/canvas, playhead/timecode, playback, aspect ratio/resolution/background/canvas settings.
- Video, Audio and Text tracks; visual source kinds can include Shot Versions, image/video assets, Clip Compositions and authorized procedural/Three.js content.
- Selection, move, trim/resize, snapping, split, duplicate, delete, zoom/fit, track ordering and visible selection state.
- Contextual Inspector for selected placements and canvas/track-level settings with clear ownership.
- Undo/Redo, persistence, linked source audio / unlink / per-audio mute as existing model supports.
- The same editing semantics for root Master Composition and nested Clip Asset Version.

Advanced effect catalogs, provider integrations, dependency-driven AI production, a full asset-administration workspace and final MP4 export are separate milestones; they must not block establishing the basic Editor workspace. Do not claim an effect, codec or export path is supported unless its output is tested.

## 3. Code and data strategy

### Preserve working logic selectively

Before replacing UI, inspect the active main branch and all open PRs. Classify each existing behavior as:
- keep and reuse with regression tests;
- wrap behind a canonical Editor command/adapter;
- redesign because it is coupled to the old layout or has separate root/nested behavior;
- defer explicitly with a task and reason.

Reuse is evidence-based. Passing tests for a pure utility are a reason to consider reuse, not proof that a full App-level interaction is complete.

### Single source of truth

The new workspace must not independently mutate React copies of timeline clips, nested layers and canonical Composition data. UI gestures dispatch commands to one Editor session/service; the view renders its result. Required command families include:

- composition context: open root / open pinned Clip Version / return to parent;
- source placement: add, move, reorder, split, duplicate, delete;
- time edit: trim source in/out, resize, snap, update duration, resolve overlap;
- track/layer: add/remove/reorder track, move placement to compatible track;
- visual/audio properties: transform, canvas fit, volume/mute/fades where supported;
- history and data: atomic transaction, Undo/Redo, save/restore and schema migration.

Command semantics must be testable without the visual workspace. Group multi-object changes (e.g. video and linked audio, adjacent trim, ripple operation) into one atomic history transaction.

### Compatibility and migration

The current schema-1.0 project shape includes root `timelineClips[]`, `Shot.slots[]`, nested `ClipVersion.layers[]`, linked audio, and materialized `storyboard-*` placements. Keep old files importable while the canonical Composition model is made authoritative. Migration must preserve stable identity, every alternative/version, selected-version markers, prompt/reference/provenance metadata, source ranges, ordering, audio relationships and pinned nested versions. Detect ambiguity and missing assets; never silently discard or overwrite content.

Do not promote a transitional envelope/projection to authoritative persistence until migration and round-trip tests pass. Save-as-Clip must be a deep, independently editable structural snapshot—not a rendered MP4, flattened layers, or a live alias. Opening/editing a nested Clip creates a new version and cannot rewrite the source Project or older pinned references.

## 4. Execution milestones

The task dashboard keeps existing task IDs for continuity. These milestones define the recommended execution sequence and map to DYS-005 / DYS-012 / DYS-014 / DYS-016–DYS-019 and current task records.

| Milestone | Goal | Main tasks | Exit criteria |
|---|---|---|---|
| E0 — Live-state audit | Establish what is truly on main; inventory open PRs, issue state, tests and deployed SHA. | DYS-016, existing PR triage | Exact main SHA, exact PR heads/checks; documented keep/adapt/replace/defer table. No claims based on stale chat notes. |
| E1 — Workspace contract | Agree panel layout, navigation hierarchy, contextual controls, mobile behavior and acceptance. | DYS-016 | This plan and `docs/architecture/TIMELINE_EDITOR_WORKSPACE.md` agree; task dashboard/handoff links resolve; CI validates documentation/data. |
| E2 — Canonical editing boundary | Make one Composition/editor state contract and tested commands; keep schema-1.0 compatibility. | DYS-014, DYS-005, DYS-011, DYS-013 | Migration/import/export/round-trip tests preserve versions, provenance, source ranges, linked audio, nested relationships and IDs; canonical commands support history; TypeScript/build pass. |
| E3 — Desktop Editor shell | Build new workspace layout with embedded source/effects browser, composite preview and lower multitrack timeline. | DYS-017, DYS-006 | No page-level overflow at supported desktop/tablet widths; all visible core controls operate through the one Editor command boundary; view-state tests cover selection/panels/context. |
| E4 — Core editing parity | Complete ordinary and nested operations, canvas settings, source insertion, contextual Inspector, linked audio and structure-preserving Save-as-Clip. | DYS-005, DYS-011, DYS-013, DYS-014, DYS-017 | Root/nested edit parity; no parallel behavior paths; Undo/Redo and JSON reopen preserve the results; tests and build pass. |
| E5 — Mobile Editor workspace | Adapt the same Editor to touch and narrow screens, using selected-element controls at the bottom and a separate workspace switcher. | DYS-018, DYS-012 | Supported phone portrait/landscape and tablet widths have a documented acceptance matrix; controls are reachable, timeline pans independently, no page overflow; touch/select/trim/move/history tests pass. |
| E6 — Planning modules around Timeline | Add Storyboard planning and explicit assembly into Timeline; later connect References/Profiles and full Asset Management. | DYS-019, DYS-004 | Storyboard changes do not silently rewrite manually edited timeline timing; source/version pins and reference snapshots survive workflows; editor remains independently usable. |
| E7 — Production and release quality | Add/complete Production Tasks/Generation Runs, recovery/portable bundles and tested output capabilities. | DYS-015, DYS-007, DYS-009, DYS-010 | Task DAG and run history preserve effective inputs; import/export recovery and output scope validated; exact-head CI and Pages deployment are recorded separately. |

### Task dependencies and allowed parallel work

- DYS-016 (this plan) must set the workspace/API contract before the UI rebuild begins.
- DYS-014 owns the canonical data contract, migration and structure-preserving snapshots. DYS-005 owns editing behavior and version workflows. They are the foundation, not reasons to wait before prototyping a non-persistent layout shell.
- DYS-017 may build the visual shell in parallel with DYS-014 only if it uses a typed adapter/command boundary and cannot create a second source of truth. Do not fake working commands or commit a UI-only shell as complete.
- DYS-018 follows the workspace structure and adapts it for mobile; it must not duplicate the editor state or restore the old persistent four-module bottom nav inside the editor.
- DYS-019 follows a stable Editor/source contract and integrates planning workflows without making the Editor dependent on them.
- DYS-004's full library/Reference Profile workflows and DYS-015's production graph are sequenced after the core Editor is stable, while the basic project media source browser is part of E3.

## 5. Pull requests and current baseline

Verified against GitHub during this plan's preparation (2026-10-19):

- Main HEAD was `a54526fc82345c8813a6f0b770056dfe6e25a526`.
- PR #88 (`feat/dys014-structure-preserving-clip-snapshots`) and PR #89 (`feat/dys014-save-clip-snapshot-integration`) are open Draft PRs, not part of main.
- PR #89 exact-head CI run [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) passed all 206 tests but failed the TypeScript/build step. The log reports an unused `CompositionDocument` import and unsafe accesses to the `CompositionSourceReference` union (`assetId`, `shotId`, `slotId`, `versionId`). Do not merge it as-is or treat its snapshot bridge as shipped.
- PR #45 (Shot/Clip/version contract), #37 and #33 were also open at the time of inspection; re-check all live PRs, not only these, before implementation. Issues #58 and #59 are open and overlap workspace navigation/settings requirements.
- No browser smoke tests were added or run. The exact-head build failure above was read from the workflow log, not inferred from status alone.

PR disposition rule: do not merge, close or discard code automatically based on this planning document. Inspect each diff and its tests; either repair and rebase a coherent slice onto the new plan or document why it is superseded. Avoid duplicate PRs and unnecessary CI runs.

## 6. Definition of Ready / Done for every implementation slice

**Ready**
- Names one behavior and a bounded surface area.
- Identifies source data, expected command/state changes and affected root/nested composition paths.
- Defines regression tests and owner-visible acceptance evidence.
- Lists migration/backward-compatibility risks and any deferred requirements.
- Is based on the latest main/PR/issue state, not old checkpoints.

**Done**
- Real code change exists; not only a README/dashboard status update unless the task is specifically a plan/spec task.
- Tests assert behavior, including failure and undo/reopen cases where relevant.
- `npm test` and `npm run build` pass locally when a usable checkout exists; otherwise exact-head CI is the evidence and the limitation is stated.
- Relevant i18n, task JSON, specs, report and handoff are updated in the same coherent batch.
- A single meaningful commit / minimal commits and one PR per coherent feature; never push directly to main.
- No automated browser smoke tests. Manual UI acceptance happens after a successful deployment and is recorded separately.
- Exact validated SHA, CI, main CI and Pages deployment are clearly distinguished.

## 7. Pickup instructions

Start from `docs/AGENT_PICKUP_PROMPT.md`, `docs/AGENT_HANDOFF.md`, this plan, `docs/architecture/TIMELINE_EDITOR_WORKSPACE.md`, `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`, and `public/doc/tasks.json`. Re-query main, open PRs/issues and exact-head CI before coding. The first implementation step is not to redesign every panel at once: audit current code and reconcile PR #88/#89, then implement the canonical editing boundary and a functional Desktop workspace vertical slice with tests. Keep the existing deployable app available until the new workspace has parity and passes CI.
