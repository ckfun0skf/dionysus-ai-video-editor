# Dionysus Project Roadmap and Agent Pickup State

**Last reconciled:** 2026-10-19  
**Repository:** `ckfun0skf/dionysus-ai-video-editor`  
**Source of truth:** Git history, open PR/Issues, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`, and `public/doc/tasks.json`.

This document is a durable pickup ledger, not a claim that planned behavior already exists. Re-check GitHub before acting: issue/PR/CI state may change after this file is updated.

## Current checkpoint

- Main baseline at redesign start: `288b5f349080c470a119c33174dfaa93c0e8c9f0`.
- Active architecture PR: [#63](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/63).
- Feature branch: `feat/unified-composition-model`.
- Last verified checkpoint commit before this handoff update: `406d898ad5176cc2ed55441b3ed502c67db5f7a5`.
- PR #63 is intentionally Draft. CI [39207371506](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39207371506) passed tests and type-check/build for that checkpoint.
- PR #63 now includes the DYS-014 projection adapter and an interim #54 fix: ordinary clip drop/resize checks Master Shot occupancy, cross-model resize trims update both records, and Master Shot drag identity survives protected dragover. Import/export and full shared-editor integration remain outstanding; no production deployment is implied.
- The latest user feedback says #53/#54 still have issues. They must remain open until implementation is corrected and user acceptance is obtained.
- Do not add or run browser smoke tests unless the user explicitly requests them.

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

## Sequenced roadmap

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

## Open GitHub issues to preserve

Re-query GitHub before every major slice. At the last recorded check, these were open:

- [#53 Master Timeline and Clip Timeline have different UI](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/53) — target fix is one shared editor/data model, not superficial button styling.
- [#54 Clip drag/drop and resizing](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/54) — destination preview, snap, cross-track move, overlap/trim and Undo; user says residual problems persist.
- [#56 Asset Management UX](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/56) — asset picker, context menu, dependency-aware deletion/reverse usage, references and dimensions.
- [#58 Collapsible left navigation](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/58).
- [#59 Timeline settings/zoom/background behavior](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/59).

The issue search last returned these five open issues; this is not a promise that no new issue has since been opened. Review every open issue before marking architecture work complete.

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
