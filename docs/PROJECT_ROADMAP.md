# Dionysus Project Roadmap and Agent Pickup State

**Last reconciled:** 2026-10-22  
**Repository:** `ckfun0skf/dionysus-ai-video-editor`  
**Source of truth:** Git history, open PR/Issues, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`, and `public/doc/tasks.json`.

This document is a durable pickup ledger, not a claim that planned behavior already exists. Re-check GitHub before acting: issue/PR/CI state may change after this file is updated.

## Live architecture checkpoint — 2026-10-22

- Current PR: [#111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111), branch `feat/e1-editor-session-history`; validated code checkpoint before this roadmap sync: `6a4632ece321518b95c48bea29d34c559a8d6ecb`. Exact-head CI [39877068547](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39877068547) passed 26 test files / 297 tests, TypeScript/build and audit 0; this documentation sync creates a new head, so re-check exact-head CI.
- Editor state/history/import/recovery use a paired session snapshot. Autosave writes canonical v2 only; schema-1.0 is a read-only fallback.
- Nested version render layers use canonical nested Composition where present, including linked-audio child source/ranges/mute/volume/fades and track mute. Master preview/audio/code preview/export start from canonical root Composition via a memoized adapter to the legacy renderer interface.
- Nested track mute, duration and description operations update canonical Composition and compatibility projections through dedicated helpers. Version description editing, duplication, and blank-version creation now synchronize canonical metadata. Initial Clip Assets and New Blank Versions own independent canonical Composition documents with empty placements and parent canvas size.
- Legacy-only version duplication canonicalizes its source and remaps track, placement, and linked-audio references; duplicate top-level Composition documents also get a fresh ID while nested pinned child snapshots remain unchanged.
- Save-as-Clip Asset receives the live canonical root and derives both the stored nested Composition and flattened renderer projection from that same root; regression coverage protects against stale legacy Project projections dropping canonical-only edits.
- Remaining: renderer output still uses legacy `CompositionLayer[]`; editable master/nested Timeline UI and some non-root/pinned snapshot paths remain compatibility-first. Do not call DYS-014 complete or claim canonical-only in-memory state.
- Next: verify CI on the docs-synchronized head; then audit remaining non-root mutations and plan a tested nested editable UI migration. Keep Issue #100 open, no browser smoke tests, and no merge without explicit owner approval.

## Current strategic plan — Timeline-first Editor workspace

The owner confirmed a new execution order: complete the Timeline Editor workspace first, with an embedded Media/Audio/Text/Effects/Transitions source browser, Preview/Canvas, multitrack Timeline and selection-driven tools; then integrate Storyboard and References as planning modules. This is a workspace/state-boundary rebuild, not a wipe of project data or tested utilities. Current detailed plan: [`docs/TIMELINE_EDITOR_REBUILD_PLAN.md`](TIMELINE_EDITOR_REBUILD_PLAN.md). UI contract: [`docs/architecture/TIMELINE_EDITOR_WORKSPACE.md`](architecture/TIMELINE_EDITOR_WORKSPACE.md).

**Live baseline observed 2026-10-19:** main was `a54526fc82345c8813a6f0b770056dfe6e25a526`. Draft PR #88 and #89 are not on main. PR #89 exact-head CI [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) passed 206 tests but failed TypeScript/build due to an unused import and unsafe union-field access. Do not merge as-is; inspect current head/checks first. Existing mobile spec's persistent four-module bottom navigation inside the Editor is superseded by contextual editing controls at the bottom; app/module navigation must be separate. No browser smoke tests.

## Current checkpoint

- Latest functional code release SHA: `ee1f90c3304ce0f2be5cef294c387192d2aa8969`; main CI [39234313896](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313896) and Pages deployment [39234313840](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313840) passed. A docs-only checkpoint may advance `main` without changing the app code; re-query live Git before editing.
- Public preview: https://ckfun0skf.github.io/dionysus-ai-video-editor/. Issues #53/#54 were closed as fixed at the owner’s direction. PR #65 shipped safe click-to-place insertion; PR #66 shipped New Blank Version for Clip Assets.
- Current limitations remain: creating a Storyboard Shot makes a Slot/Version but no separate reusable Clip Asset; canonical Shot/Clip/Composition relation remains a DYS-014 item. Clip Assets now support both Duplicate Version and New Blank Version.
- Versioned project-document reads now reject mismatched project identity/name/root Composition identity; legacy schema-1.0 data remains authoritative.
- #53/#54 remain open pending acceptance. Save-as-Clip still flattens legacy layers; structure-preserving snapshots remain unfinished. No browser smoke tests or PR-branch deployment are claimed.

### Follow-up — Safe Add Clip insertion (2026-10-19)

PR #65 merged safe click-to-place insertion as `990158fc70cf0e6fe17a994237c1b0d65b7d60fb`; exact main CI [39233639480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39233639480) and Pages [39233639536](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39233639536) passed. PR #66 shipped New Blank Version for Clip Assets on feature code SHA `ee1f90c3304ce0f2be5cef294c387192d2aa8969`; main CI 39234313896 and Pages deployment 39234313840 passed. The target UX is consistent with the standard distinction between Insert/ripple and trim-to-fit; do not silently overwrite existing content.

## Product destination

Dionysus should guide the user from narrative intent through reference/media preparation, prompt creation, AI generation and retries, Shot Version selection, timeline composition, reusable nested compositions, and final output. It must remain useful in manual copy-prompt/import mode before API integrations exist.

Core architecture:
1. Storyboard = narrative/production plan; order is not timeline time.
2. Shot = narrative production identity and generation requirements; Shot Version = one concrete generated video output plus provenance.
3. Media Asset = identity and metadata for an imported/generated source.
4. Composition = ordered Tracks and Timeline Placements.
5. Project Master Timeline = root Composition.
6. Clip Asset Version = reusable, independently editable Composition snapshot.
7. Production Task = intended work with output, prompt, input requirements and dependencies.
8. Generation Run = immutable record of one generation attempt and its effective prompt/settings/reference snapshot.
9. Root and nested compositions use the same editor and placement mechanics. Context-specific save/settings actions may differ; drag/drop/snap/overlap/resize/trim/undo must not.
10. Save-as-Clip preserves structure and pinned versions; it is not an MP4 render, flat list of layers or live link to the source project.

## Historical roadmap ledger (scope retained; execution order superseded)

The following phase breakdown retains existing implementation scope and historical evidence, but its original sequencing predates the Timeline-first workspace decision. Use `docs/TIMELINE_EDITOR_REBUILD_PLAN.md` and the `executionSequence` field in `public/doc/tasks.json` for current priority/order. Do not resume full Asset/Reference or Production work ahead of the Timeline Editor vertical slice merely because those historical phases appear earlier below.

### Phase 0 — Architecture contract and review
**Task:** DYS-014 planning baseline, PR #63  
**State:** Draft PR; documentation baseline and task tracking exist.  
**Exit:** Architecture contract is internally consistent, current-schema limitations are explicit, task dashboard links resolve, and CI passes on the exact PR head. Keep Draft while reviewing; don't merge just to publish docs.

### Phase 1 — Typed Composition model and safe migration
**Tasks:** DYS-014, DYS-002  
**Current progress:** The first projection slice is implemented in `src/compositionModel.ts` and `src/compositionMigration.ts`; regression fixtures are in `src/compositionMigration.test.ts`. This is an adapter only; schema-1.0 persistence and editor integration remain unchanged.  
**Deliverables:**
- Define typed Composition, Track, Placement, source reference, source-range, transform/mix settings and version pins.
- Define migration from current `schemaVersion: "1.0"`: `timelineClips[]`, `Shot.slots[]`, `ClipVersion.layers[]`, linked audio and `storyboard-*` materialized clips.
- Use versioned, deterministic, non-destructive migration; preserve IDs/alternatives/prompts/provenance/track order/source ranges/audio links and detect duplicates/ambiguous data.
- Keep import/export round-trip and existing projects working; surface missing references instead of silently dropping them.
**Exit tests:** legacy fixtures migrate deterministically; round-trip preserves data; no duplicate Storyboard placements; linked audio, version pins, and missing references are covered.

### Phase 2 — One shared Composition Editor / Placement engine
**Tasks:** DYS-005, DYS-014; issues #53 and #54  
**Current progress:** Project-level mixed-model placement, move and resize operations are extracted to `src/projectTimelinePlacement.ts`; App uses the same occupancy/resize engine for ordinary clips and Master Shots, and both move paths delegate to the same project-level move operation. Cross-model neighbor trims apply atomically. Nested Clip Versions now have visible Video/Audio/Text track rows with multiple placements per track and track-aware add/move operations. App integration and pure helper tests passed in CI run 39217800522, including TypeScript/Vite build. Project import/export now emits a versioned 2.0 compatibility envelope that includes the canonical projection and authoritative legacy schema-1.0 payload, while still accepting legacy files. This is a migration bridge, not schema-2.0-only persistence. Separate editor state/data paths still exist. Exact-head code CI run 39218695102 passed.  
**Deliverables:**
- Root and nested editors share the same Composition document contract, components and placement operations.
- Remove the special Master Shot drag/resize path after migration; don't patch parity with CSS or duplicate handlers.
- Share drop preview, snap calculation, cross-video-track move, overlap policy, resize preview, adjacent trim and atomic Undo/Redo.
- Preserve source/version pins and linked audio during all edits.
**Exit tests:** equivalent root/nested operations produce equivalent document changes; test destination preview, snapping, cross-layer drag, overlap prevention, resize/trim, Undo/Redo and version pinning. Keep #53/#54 open pending user's manual acceptance.

### Phase 3 — Structure-preserving Project-to-Clip snapshots
**Tasks:** DYS-014, DYS-013  
**Deliverables:**
- Save the root Composition as a new Clip Asset Version by copying the composition tree and mapping stable IDs/relationships.
- Preserve tracks, ordering, backgrounds/transparency, placements, start/duration, source in/out, transforms, audio/mix, concrete Shot/Clip version pins and nested relationships.
- Snapshot is independently editable; edits create a new Clip Version and never mutate source Project or older versions.
- Place the saved Clip into another Composition, open it in the same Editor, and expand/edit nested content.
- Prevent recursive cycles and enforce a reasonable UI depth; report missing dependencies. Media bytes may be shared by Asset ID within a Project, but portable export must include or report dependencies.
**Exit tests:** structure round-trip; source/snapshot independence; pinned versions stable after new generation; nested preview; cycle prevention; dependency/missing-source handling.

### Phase 4 — Production Task graph and Generation Run history
**Task:** DYS-015; coordinate DYS-004 and DYS-009  
**Deliverables:**
- Replace the Shot-only checklist with explicit tasks for asset generation, references, Shot video generation and follow-up work.
- Tasks contain expected output, prompt/template, target, required assets/references and dependencies.
- DAG validation/readiness shows blocked, ready, running, completed, failed and manual-import-required states.
- Each attempt preserves effective prompt, provider/model/parameters, exact reference snapshot, output/error and timestamps where available.
- Copy prompt/import output works before APIs exist; future providers plug into the same task/run contract. Retry creates a new run and does not overwrite old output.
**Exit tests:** dependency cycles/dangling IDs detected; prompt/reference snapshots immutable; retry history and JSON round-trip pass.

### Phase 5 — Asset and Reference management
**Task:** DYS-004; issue #56  
**Deliverables:**
- Asset picker/library uses a consistent browse/search/filter pattern.
- Asset context menu supports Settings, Edit Timeline for Clip Assets, confirmed Delete and reference management.
- Reverse usage shows every Shot Version, task, Reference Set, Composition and Placement using an asset.
- Delete/replace previews affected dependants and applies explicit deterministic repair/removal; no silent cascading data loss.
- Per-asset dimensions/frame metadata, import/relink/missing-media state and thumbnails are explicit.
**Exit tests:** reverse-use consistency, safe delete/replace, shared references and import/relink tests.

### Phase 6 — Timeline settings and navigation
**Tasks:** DYS-005/DYS-014 and DYS-010; issues #58 and #59  
**Deliverables:**
- Project output, Composition canvas, Track and Placement settings are distinct.
- Composition settings: title, canvas size/resolution, ratio, background/transparency and duration; project export settings are not accidentally confused with clip canvas.
- New visual placements default to canvas size; transform/position is relative to canvas.
- Timeline zoom works; background/transparency changes rendered output rather than just lane UI.
- Left navigation collapses by default as requested in #58.
**Exit tests:** settings scope tests, dimension/ratio persistence, background compositing and zoom calculations.

### Phase 7 — Preview, audio, procedural layers and output
**Tasks:** DYS-006, DYS-008, DYS-011, DYS-009  
**Deliverables:**
- Root/nested composition rendering uses the same source/placement model.
- Linked audio/unlink/mute/mix/fades and procedural visuals survive migration and snapshots.
- AI plan import/export reconciles the task DAG and pinned versions without silently overwriting manual edits.
- Define and implement honest output scope: current experimental WebM compositor is not equivalent to accurate MP4 export. MP4/export requirements and codec constraints need explicit tests.
**Exit tests:** renderer parity for root/nested content; audio sync/mix; procedural layer; plan round-trip/reconciliation; output validation.

### Phase 8 — Portability, recovery and release
**Tasks:** DYS-007, DYS-010, DYS-012  
**Deliverables:**
- Undo/Redo and recovery cover multi-object edits and nested editing.
- Portable project bundle includes or reports media dependencies and preserves IDs/pins.
- Mobile layout is usable for intended core editing tasks.
- Release notes, task dashboard and deployment evidence reflect the actual shipped SHA.
**Exit tests:** recovery/round-trip/portable bundle; mobile layout tests where feasible; exact-head CI and post-merge Pages deployment checks.

## Known GitHub issues to preserve

Re-query GitHub before every major slice. At the last recorded check, these were open:

- [#53 Master Timeline and Clip Timeline have different UI](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/53) — closed at the owner’s direction after the deployed UI/interactions were accepted as fixed; canonical Composition convergence remains DYS-014 work.
- [#54 Clip drag/drop and resizing](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/54) — closed at the owner’s direction. Add Clip insertion-overlap was treated as a separate bug and fixed in PR #65.
- [#56 Asset Management UX](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/56) — asset picker, context menu, dependency-aware deletion/reverse usage, references and dimensions.
- [#58 Collapsible left navigation](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/58).
- [#59 Timeline settings/zoom/background behavior](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/59).

The issue search last returned #56, #58 and #59 as the remaining listed open issues; #53/#54 are closed. This is not a promise that no new issue has since been opened. Review every open issue before marking architecture work complete.

## Task ownership and dependencies

- DYS-002: schema validation and safe migration.
- DYS-003: task dashboard/task artifacts and tracking.
- DYS-004: asset/reference library and dependency visibility.
- DYS-005: timeline editing/version workflow; #53/#54.
- DYS-006: preview/playback/compositing.
- DYS-007: Undo/Redo, recovery, portable project bundles.
- DYS-008: advanced audio/procedural layers.
- DYS-009: AI plan reconciliation and export.
- DYS-010: CI/release/deployment.
- DYS-011: existing multi-track/linked-audio slice; preserve regression coverage.
- DYS-012: responsive mobile workspace.
- DYS-013: existing reusable Clip Asset slice; not proof of structure-preserving Project snapshots.
- DYS-014: shared Composition model, migration integration and structure-preserving snapshots.
- DYS-015: dependency-aware Production Tasks and Generation Runs.

Do not create a parallel competing model in DYS-013/DYS-005; DYS-014 owns the canonical Composition contract. Use `public/doc/tasks.json` as dashboard data and keep each task's Markdown/HTML/report artifacts aligned.

## Handoff checkpoint template

At the end of every substantial work slice, update this file or the dedicated handoff note with:
- date and exact `main` SHA / feature branch / PR / head SHA;
- changed behavior and files;
- CI run URL and exact test/build/audit outcomes;
- migration/backward-compatibility risks;
- user acceptance state;
- next single concrete implementation step;
- tasks changed in `public/doc/tasks.json`.

Never mark a task done because its documentation exists. Mark done only when its acceptance tests pass and user acceptance is recorded where requested.


## Mobile editing progress — 2026-10-19

The owner explicitly wants a future phone version with a CapCut-inspired interface. DYS-012 is active; responsive mobile web shares the desktop project model and does not imply a separate native app.

- PR #68 merged the first responsive layout foundation as main commit `3513d51f9a52599e0231d8cb4db884cc59e5d611`: four-item bottom navigation, safe-area spacing, compact top bar, preview-first timeline layout, larger controls and isolated horizontal scrolling for root/nested timeline ruler + lanes. Exact-head PR CI [39236495588](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39236495588) passed on `aca468fb345b523361467ae8da66b42d1207904a`. Main push CI and Pages deployment still require independent confirmation.
- Active follow-up branch `feat/mobile-timeline-touch-drag` implements long-press touch movement for Master Timeline clips, with short swipes routed to timeline/page scrolling and a regression test. This is not yet merged.
- Not complete: nested Clip Version touch drag, robust touch scrubbing/trim validation, mobile Inspector/Version picker behavior, portrait/landscape/tablet viewport acceptance and no-overflow evidence. Keep DYS-012 in progress.
- No automated browser smoke tests are to be added or run. Do not ask the owner to test until code is merged and Pages deployment is confirmed.
- Continue DYS-014 canonical Composition persistence and structure-preserving Save-as-Clip after the touch workflow; mobile UI does not resolve the Shot/Clip model.


## Nested mobile editing follow-up — 2026-10-19

PR #69 merged as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; its exact-head CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed at `31ed8795ef883e556285eecd6ab7073bee094a87`. The Master Timeline supports long-press touch move with short-swipe panning.

The active branch `feat/mobile-nested-timeline-touch` extends touch move to nested Clip Version layers, preserving the existing version-specific placement and overlap checks. It includes a component test and remains pending CI. DYS-012 is still in progress: mobile Inspector/Version picker behavior, robust scrubbing/trimming, viewport acceptance and independently verified Pages deployment remain outstanding. Do not add browser smoke tests or ask the owner to test before deployment is confirmed.


## Mobile contextual editing — 2026-10-19

PR #70 merged nested Clip Version long-press movement as main commit `fd51602f92640cf18ad426a418bb7c8d8cb39207`; exact-head CI run [39237693258](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237693258) passed at `1b1da31e6cec749f3888385ea5c201183c4facba`.

Active branch `feat/mobile-contextual-editor-tools` adds contextual mobile actions for the selected Master Timeline clip, a functional mobile Inspector open/close control, and touch-sized nested Clip Asset version selection. It has an App integration test and is pending exact-head CI. DYS-012 remains in progress; mobile viewport acceptance, version UX polish and deployment confirmation remain. Do not add browser smoke tests or ask the owner to test before deployment is confirmed.


## Mobile timeline zoom — 2026-10-19

PR #71 merged contextual selected-clip tools and the mobile Inspector toggle as main commit `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`; exact-head CI run [39238524459](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238524459) passed at `19eda997ad20a8a38d6b1e63345f03bccf9eb09e`.

Active branch `feat/mobile-timeline-zoom-controls` adds phone-only Zoom In / Zoom Out / Fit controls, scaling root and nested track surfaces without mutating clip timing. An integration test checks zoom width and Fit behavior. DYS-012 remains in progress; deployment and portrait/landscape viewport acceptance are not confirmed. Do not add browser smoke tests or ask the owner to test before deployment is verified.


## Mobile trim ergonomics — 2026-10-19

PR #72 merged timeline Zoom In / Zoom Out / Fit controls as main commit `f57b5ad3ffe5b80bd586b513fc2fc1e201898cf8`; exact-head CI run [39238940480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238940480) passed at `2ce2e57f9a4360c6f438a56d721625cb54081947`.

Active branch `feat/mobile-touch-trim-handles` expands trim hit targets to 20 px on mobile, adds visible grab markers, and tests touch-pointer trimming. DYS-012 remains in progress; deployment and portrait/landscape viewport acceptance remain unconfirmed. Do not add browser smoke tests or ask the owner to test before deployment is verified.


## Mobile editing follow-up — 2026-10-19 (preview history)

PR #79 has merged frame-accurate keyboard scrubbing as main commit `0a5ace89e28fff5d1f46bc0e4330d56e91f9035e`. The active branch `feat/mobile-preview-undo-redo` adds touch-sized Undo/Redo controls beside the preview and an App integration test covering duplicate → Undo → Redo. Keep DYS-012 in progress until exact-head CI, main push CI, Pages deployment, and viewport acceptance are independently recorded. Do not add or run browser smoke tests.


## Mobile editing follow-up — audio mute (2026-10-19)

PR #80 merged phone-accessible preview Undo/Redo as main commit `85646e4a70cdde113bee728b4ed1cd781a022f0a`; exact-head CI run [39248435319](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39248435319) passed. The active branch `feat/mobile-audio-clip-mute` adds selected-audio Mute/Unmute and integration coverage. Keep DYS-012 in progress until exact-head CI, main push CI, Pages deployment, and viewport acceptance are independently recorded. Do not add or run browser smoke tests.


## Mobile editing follow-up — visible audio mute state (2026-10-19)

PR #81 merged selected-audio Mute/Unmute as main commit `7ba96ec0eae8d6e3fb2196d7b9f492e293ff10e2`; exact-head CI run `39249271916` passed. The active branch `feat/mobile-audio-mute-state` adds a visible active state for muted audio and checks the accessible pressed state. Keep DYS-012 in progress until exact-head CI, main push CI, Pages deployment, and viewport acceptance are independently recorded. Do not add or run browser smoke tests.


## DYS-012 follow-up — Issue #83
The mobile UI needs another usability pass: consolidate layer actions into a safe-area-aware menu, improve touch button affordances, and reduce the amount of vertically stacked controls. Do not mark complete until CI/deployment evidence and viewport acceptance are recorded.


## Mobile UX handoff checkpoint — 2026-10-19

PR #84 merged the Issue #83 correction at `a83f4a6836d7c4ee683b17a1ccdb5897e17364e2`; exact-head PR CI [39252298875](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39252298875) passed. It consolidates Master Timeline layer controls into a compact menu, improves touch button affordances and selected states, respects bottom-navigation safe areas and reduces vertical clutter. Issue #83 is closed by the merge, but main push CI/Pages deployment and owner acceptance were not confirmed in the handoff session. Do not ask the owner to test until deployment is verified.

The next agent should read `docs/MOBILE_AGENT_PICKUP_PROMPT.md` and `docs/MOBILE_AGENT_HANDOFF.md`, verify live GitHub state and deployment, then continue the mobile usability/viewport pass. DYS-012 remains in progress; no browser smoke tests. Once the mobile pass is stable, return to DYS-014 canonical Composition persistence and structure-preserving Save-as-Clip.


## Mobile preview control release and DYS-014 pickup — 2026-10-19

- PR #86 merged the progressive-disclosure preview-control slice as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`.
- Exact-head feature CI [39259760793](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259760793), main push CI [39259981315](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981315), and GitHub Pages deployment [39259981194](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981194) all passed. This proves automated build/deployment, not device-level UX acceptance.
- On phones, history/playback/start/frame-step stay prominent; +0.5s, the playhead slider, overlay and optional image clear are progressively disclosed. No browser smoke tests were added or run.
- DYS-012 remains in progress pending owner evidence for phone portrait, landscape, tablet, touch interactions and page-level overflow.
- Next implementation branch: `feat/dys014-alternative-provenance-roundtrip`. The current slice adds migration tests for all Shot Slot alternatives and generation/reference/model/output provenance, plus JSON round-trip tests for schema-1.0 and the versioned 2.0 envelope. Exact-head CI is required before calling that test slice validated.
- After these checks, resume canonical-only Composition persistence and structure-preserving Project-to-Clip snapshots. Do not auto-create duplicate Clip Assets per Shot without an explicit owner decision.

## Architecture follow-up — canonical source projection cleanup (2026-10-22)

- Nested Clip Version compatibility layers and root linked-audio child projections now clear source-type-specific legacy IDs before projecting the canonical source union. Regression coverage guards against Clip-to-asset source switches and stale linked-audio `clipVersionId` metadata.
- This is a bounded consistency fix, not completion of DYS-014: the editable Timeline UI and renderer still have compatibility-projection boundaries to migrate. Exact-head CI passed on the docs-synchronized head `2121c59ad7d0da64548081301655df6e3f6a82a4`, [run 39878411955](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39878411955): 26 test files / 297 tests, TypeScript/build passed, npm audit 0 vulnerabilities.

## Architecture follow-up — complete source-selector cleanup (2026-10-23)

A follow-up audit extended the canonical-source projection cleanup to remove stale `childCompositionId` and `shotVersionId` fields from both root placements and linked-audio children, alongside asset/shot/slot/clip/script selectors. Regression fixtures now prove those fields do not survive an Asset source projection. Code/test commits: `da2c294151ae691cb3924bacd6d6b6c92674a26b`, `f2ad672ca5a6a5f1bccaae0a3e68e0946b78b47d`. Exact-head CI for this latest increment is pending; previous exact head `e8743fc4b0569587d6b2573b2420a52c058adbcb` passed [run 39878812633](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39878812633). DYS-014 remains in progress; editable Timeline UI, non-root/pinned paths and canonical render/playback remain outstanding.

## Validation correction — projection fixture metadata is intentionally legacy-only (2026-10-23)

The first CI for the expanded selector cleanup passed all 26 test files but failed TypeScript because `childCompositionId` and `shotVersionId` are intentionally not declared on the public `TimelineClip` type. The projection handles them as unknown legacy compatibility fields. Updated the implementation to narrow legacy metadata through `Record<string, unknown>` and changed regression fixtures to inject those unknown legacy fields through typed spreads. Fix commits: `d2ac053a9179802828b2d47ce7bffbe810327e56`, `bd012ac135cb0a20da38232217bce42c083dff1a`. Exact-head CI for this correction and the docs-synchronized head is pending; do not mark the selector expansion complete until it passes.
