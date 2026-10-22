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

## Design gate — wireframes, prototype and UML

Before production UI implementation, review DYS-020: [responsive wireframe prototype](../public/doc/design/timeline-editor-wireframes.html), [UML overview](architecture/TIMELINE_EDITOR_UML.md) and standalone [PlantUML sources](architecture/plantuml/), and [design pack checklist](architecture/TIMELINE_EDITOR_UX_DESIGN_PACK.md). These artifacts define component boundaries, canonical Composition ownership, command/Undo flow and mobile contextual controls. The prototype is low-fidelity, not production code. Resolve major layout/interaction questions before DYS-017; safe model/test work may continue in parallel.

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


## Owner-confirmed linked-audio interaction (2026-10-22)

Implement source audio as child placements owned by video placements / their Video Layer relationship, not as ordinary Audio Tracks. Adding a video must not create a blank Audio Track. Add a linked audio child only when the source has audio. A Video Layer may contain many clips; each clip's child audio remains individually muteable and follows its parent through move, trim, split, duplicate and delete operations.

Do not provide routine Unlink/Relink or direct dragging for linked audio. Provide **Extract Audio** to transfer audio into an independent Audio Track without double playback, and **Duplicate Audio** as a separate intentional command that retains the linked original and creates an independent copy. Add a parent Video Layer mute for all linked source audio on that layer, alongside per-clip mute. Users explicitly add standalone Audio Tracks when needed.

Update the editing model, command layer, track rendering and tests together. Required regression cases: source with audio/no audio; multiple clips in one Video Layer; no accidental empty Audio Track; per-clip and layer mute; extract vs duplicate semantics; linked-child synchronization during move/trim/split/delete; unrelated Audio Track deletion; undo/redo and project JSON round-trip. This target supersedes earlier rebuild-plan wording that listed unlink/per-audio-track mute as the expected behavior. It is a design decision, not a statement that the current implementation is complete.


## E1 implementation checkpoint — 2026-10-22: atomic Editor history

The first E1 code slice now puts the Project compatibility projection and canonical root Composition in the same undo/redo snapshot. `src/editorSessionHistory.ts` supplies a bounded immutable history with 800 ms coalescing for matching non-empty edit groups, redo invalidation on a new edit, and paired undo/redo. `src/App.tsx` records that compound snapshot through the shared change boundary, restores the canonical document and re-projects legacy fields on Undo/Redo, and clears the single history on project import. `src/editorSessionHistory.test.ts` covers paired snapshots, group coalescing, redo invalidation, history limit, and empty history behavior.

This removes the two separately maintained history stacks, but deliberately does not claim that current project state, Composition state, persistence, or rendering have already converged on one authoritative document. Those remain E1–E3 work. Initial exact-head CI passed on pre-documentation SHA `c85f45d55ec4d4df474239fb63dd26208324964b` in [run 39859261009](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39859261009): 24 test files / 274 tests, TypeScript/build passed, audit 0 vulnerabilities. The task/handoff synchronization creates a newer PR head and must be followed by a fresh exact-head CI result. No browser smoke tests or manual UI acceptance are claimed.


## E1 implementation checkpoint — 2026-10-22 (atomic Editor session follow-up)

The implementation now consists of two related slices in PR #111. First, `editorSessionHistory.ts` stores the Project compatibility projection and root Composition together in bounded undo/redo history. Second, `App.tsx` initializes the pair as one `EditorSessionSnapshot` React state and updates that pair atomically during normal edits, Undo/Redo, and project import. Existing workspace components receive derived `project` and `rootComposition` values; schema-1.0 compatibility and migration remain in place.

Exact-head CI passed for code head `3ce28e4dca4d26deebcc483851e70f64b8e561c8` in [run 39859937316](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39859937316): 24 test files / 274 tests, TypeScript/build passed, audit reported 0 vulnerabilities. Synchronizing this checkpoint into the docs/task registry changes the branch head and therefore requires another exact-head CI result.

Boundaries still outstanding: refs are maintained separately for callback compatibility; persistence writes `dionysus.project.v1` and `dionysus.composition.v2`; non-root Shot/Slot editing and renderer/playback still cross legacy projections. Do not call the full canonical-state/persistence/render rebuild complete. No browser smoke tests or manual UI acceptance are claimed.


## E1 implementation checkpoint — 2026-10-22: shared session reference

The current PR #111 slice now routes all root timeline callback reads through a single `editorSessionRef` instead of separate `projectRef` and `rootCompositionRef`. Commit paths (normal edit, Undo, Redo, and import) replace the entire session object `{ project, composition }` before scheduling the paired React state update. Static inspection of the branch head found no remaining references to the removed refs and no direct writes to `editorSessionRef.current.project` / `.composition`.

Exact-head CI passed on code SHA `6ccacdd359f3c508aeeae93c8e87b5b1c381f66b` in [run 39860285572](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39860285572): 24 test files / 274 tests; TypeScript/build passed; audit 0 vulnerabilities. This note/task update changes the branch head, so the latest docs-synchronized SHA needs its own CI confirmation.

Still not solved by this slice: project and canonical document are paired but not yet a canonical-only schema; browser persistence is still split across v1/v2 keys; renderer/playback still consumes legacy projections in some paths; the non-root editing model still needs a shared command/session boundary. The Editor remains in progress, not release-ready by virtue of CI alone.


## E1 implementation checkpoint — 2026-10-22: extracted session transition

The compatibility reconciliation algorithm has moved from `App.tsx` to `src/editorSession.ts`. `reconcileEditorSessionComposition(current, target)` preserves existing canonical placement timing, track, source range, typed source and linked ownership, while allowing descriptive metadata to refresh and requiring new placements to pass canonical insertion checks. `commitEditorSessionChange(current, nextProject, canonicalRoot?)` returns the next `EditorSessionSnapshot`, using an explicit root when a root command supplies one or reconciling the legacy project projection against the current Composition otherwise. The main App `change()` path now calls this pure session boundary.

New tests in `src/editorSession.test.ts` cover canonical geometry preservation, legacy metadata updates, paired Project projection, explicit root updates and source snapshot independence. Exact code-head CI passed on `d32ea856511b0fa13821577d5786048fa6983b37` in [run 39860987542](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39860987542): 25 test files / 277 tests, TypeScript/build passed, audit 0 vulnerabilities. The accompanying task/handoff update creates a newer SHA that requires a fresh exact-head run.

The broader boundary is still transitional: Project remains a compatibility projection, legacy domain editors may drive reconciliation, the v1/v2 browser persistence keys remain separate, and playback/rendering still uses legacy projections. No browser smoke tests or UI acceptance are claimed.


## E1 implementation checkpoint — 2026-10-22: transaction + persistence boundaries

`transitionEditorSession()` in `src/editorSession.ts` now owns the main edit transaction: paired pre-edit history capture, Project-domain update, common revision timestamp, Composition reconciliation/projection, and paired result. `App.tsx`'s main `change()` applies the returned session/history pair. This keeps transaction logic testable and prevents the UI callback from independently constructing each half.

`src/editorSessionPersistence.ts` centralizes the v1/v2 storage keys and autosave operation. It writes the v2 versioned envelope containing the canonical root first, then writes its v1 Project projection mirror with the same `updatedAt`. If the mirror write fails after the canonical write succeeds, recovery can still see the newest root. This is deliberately a safe transitional dual-key design, not yet one storage key. Tests cover write ordering, projection/revision consistency, and mirror failure.

Exact code-head CI passed on `784b2ca83e7861ef85667341911459c3a599a494` in [run 39862266483](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39862266483): 26 test files / 280 tests; TypeScript/build passed; audit 0 vulnerabilities. The docs/task synchronization creates a newer SHA and requires fresh exact-head verification.

Remaining work: move other command families through the session boundary; consolidate recovery/persistence without breaking v1 imports; make non-root editing and render/playback use the intended shared Composition contract. No browser smoke tests or UI acceptance are claimed.


## E1 implementation checkpoint — 2026-10-22: edit + Undo/Redo + persistence boundaries

`transitionEditorSession()` in `src/editorSession.ts` owns the main edit transaction: paired pre-edit history capture, Project-domain update, common revision timestamp, Composition reconciliation/projection, and paired result. `restoreEditorSessionHistory()` now also owns Undo/Redo restoration, rebuilding the compatibility projection and timestamp alongside the restored canonical Composition. `App.tsx` consumes each returned session/history pair rather than rebuilding the halves inline.

`src/editorSessionPersistence.ts` centralizes v1/v2 storage keys and autosave. It writes the v2 versioned envelope containing the canonical root first, then the matching v1 Project projection mirror with the same `updatedAt`. If the mirror write fails after the canonical write succeeds, recovery can still see the newest root. This remains a safe transitional dual-key design, not yet one storage key.

Exact code-head CI passed on `f288bc97afb3c6ae097482534cef2b2f50b4408b` in [run 39862822226](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39862822226): 26 test files / 281 tests; TypeScript/build passed; audit 0 vulnerabilities. The docs/task synchronization creates a newer SHA that needs a fresh exact-head run.

Remaining work: route import and remaining direct state mutations through the session boundary; consolidate recovery/persistence without breaking v1 imports; migrate non-root editing and render/playback to the shared Composition contract. No browser smoke tests or UI acceptance are claimed.


## E1 implementation checkpoint — 2026-10-22: import boundary

`createImportedEditorSession()` in `src/editorSession.ts` now owns project import pairing. It accepts an imported canonical root only when the root's legacy Project projection exactly matches the imported Project; otherwise it selects the deterministic migrated root. In both cases it returns the Project compatibility projection rebuilt from the selected Composition. `App.tsx` routes import through this helper and resets paired history after the session is constructed.

The new import tests cover accepted canonical root, stale canonical geometry fallback, schema-1.0 migration, pair consistency, and input immutability. Exact code-head CI passed on `4e372e079d8b3f4068493b472eb34956ece0eb52` in [run 39863556870](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39863556870): 26 test files / 283 tests; TypeScript/build passed; audit 0 vulnerabilities. The docs/task synchronization creates a newer SHA that needs fresh exact-head verification.

Remaining: route other direct state mutations through the session boundary; safely consolidate recovery/persistence without breaking v1 imports; migrate non-root editing and render/playback to the shared Composition contract. No browser smoke tests or UI acceptance are claimed.


## E1 follow-up — import replacement and history reset as one result (2026-10-22)

`createImportedEditorSessionTransition()` in `src/editorSession.ts` now returns the imported `EditorSessionSnapshot` and a newly empty `EditorSessionHistory` together. `App.tsx` replaces the current session and history from that result, rather than creating the session first and independently resetting history afterward. A regression test starts with populated Undo history and asserts that import produces a consistent legacy/canonical pair with no entries from the previous project.

This narrows the project-replacement transaction boundary; it does not solve dual-key persistence, recovery arbitration, nested-editor state, or legacy rendering/playback. DYS-014 remains in progress. No browser smoke tests or manual UI acceptance are claimed.
