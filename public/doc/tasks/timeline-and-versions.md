# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress · **Progress estimate:** 89% toward the revised target · **Updated:** 2026-10-20

## Implemented
- [x] Master and nested Shot-/Clip-Version tabs, active Version selection, **+ Add Version**, and **Edit**.
- [x] Typed timeline lanes, Version thumbnails/placeholders, and no generic **Media track** heading.
- [x] Independent Master placement, Clip Slot timing, Version duration, and nested module timing.
- [x] Frame-snapped movement, drag/drop destination preview, cross-layer edge snapping, and same-layer overlap prevention.
- [x] Midpoint/playhead split and duplicate while keeping linked audio, source ranges, and fades aligned.
- [x] Resize preview with grey dashed overlap feedback; trim the adjacent clip on release.
- [x] Resize and adjacent trim share one Undo/Redo step; linked audio and source ranges update together.
- [x] Project JSON covers placement, nested layer order/source ranges, links, mute/mix, and thumbnails.
- [x] Nested Version module edits survive Undo/Redo and JSON export.

## Architecture transition (DYS-014)

User acceptance for #53/#54 remains open. This is not only a visual mismatch: Master Shots live in project.shots and use special handlers, while ordinary placements live in project.timelineClips. The target is one root/nested Composition schema and one shared Editor/Placement engine. Current behavior is the migration baseline, not proof the revised target is complete. See [Unified Composition Model](https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/architecture/UNIFIED_COMPOSITION_MODEL.md) and [DYS-014](./unified-composition-model.md).

## Unified nested track follow-up (2026-10-19)

- Nested Clip Timeline now renders actual Video/Audio/Text track rows; each track may contain multiple placements.
- **Add layer** creates a track; **Add content** adds a placement to a compatible track. Track-row Add buttons target a specific track.
- Compatible nested track drag/drop and track-aware operations are covered by `src/clipVersionTracks.test.ts`; App tests cover menu choices, adding content and ruler/track alignment.
- Project JSON export now uses a versioned 2.0 compatibility envelope while preserving the authoritative schema-1.0 payload. Legacy schema-1.0 imports remain supported.
- The Master Timeline and nested editor still do not share one persisted Composition state model; #53/#54 remain open. This code is not deployed and awaits user acceptance.
- Consolidated CI [#39218891285](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39218891285) passed tests, TypeScript and Vite production build.

## Remaining work
- [ ] Improve durable media import/relinking and missing-source recovery (DYS-004).
- [ ] Continue preview/compositing fidelity and export roadmap (DYS-006/DYS-009). Experimental WebM is not production-grade MP4 export.

## Validation
- PR #55 CI [#39159781393](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39159781393): 123 tests, TypeScript, and production build passed.
- PR #57 CI [#39165133176](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39165133176): 137 tests across 16 files, TypeScript, and production build passed at code/test SHA `794e3ff024c26d55d76583160d96238df8d84a12`.
- Main CI [#39159896542](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39159896542) and Pages deployment [#39159896506](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39159896506) passed on the prior merge commit. Browser smoke tests were not run.

## Related files
- [Creative Editing Workflow Specification](../creative-editing-workflow-spec.md)
- [Task detail](./timeline-and-versions.html) · [Report](../reports/timeline-and-versions-report.md) · [Dashboard](../task.html)


## Follow-up correction for Issues #53 and #54
PR #55 was merged and the Pages deployment succeeded, but user acceptance later showed the requested interactions still did not work end to end. PR #57 replaces the drop placement helper so snapping changes the actual destination, enables compatible cross-layer drag/drop, tracks resize with global pointer events, and makes nested Version clip blocks use the Master Timeline's icon/thumbnail and two-line copy structure. App-level regressions now cover the destination preview/guide, adjacent trimming, linked-audio propagation, and single-step Undo/Redo.

## Previous validation checkpoint
- [CI #39165133176](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39165133176) at code/test head `794e3ff024c26d55d76583160d96238df8d84a12`: 137 tests across 16 files passed; TypeScript, Vite production build, and npm audit (0 vulnerabilities) passed.
- Browser smoke tests were not run, per project instructions.


## Shared Composition command integration — 2026-10-20

PR [#93](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/93) merged to main as `5f8dbea57cc72a8b4a909db3b082ea0c54894529`. Exact-head CI [39398098386](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39398098386) passed 210 tests across 22 test files; TypeScript and Vite production build also passed. The dependency audit step is non-blocking. This established the immutable Composition command boundary for root Timeline operation adapters and nested Clip Version movement, but it did not complete root/nested parity or canonical persistence.

Follow-up branch `feat/nested-composition-command-integration` routes nested `addClipVersionLayer()` through `insertCompositionPlacement()`, adds `deleteClipVersionLayer()` through `deleteCompositionPlacement()`, and uses that adapter from the nested Editor's Remove layer action. Unit tests were added for preserved layer metadata, non-mutation, duplicate IDs, root-with-linked-child deletion and child-only deletion. Implementation/test head `5c3d3aedda2316e5ac2adf2b46740d857d04e56a` passed exact-head CI [39402243280](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39402243280): 212 tests across 22 files; TypeScript and Vite production build passed; the audit summary reported 0 vulnerabilities. Documentation checkpoint SHA `56afcc51dd6819a91bcbeba752bdb1f0e244d0a3` passed exact-head CI [39402541055](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39402541055): 212 tests across 22 files, TypeScript/build passed, audit summary 0 vulnerabilities. Verify the actual current PR head and matching checks before merge. The branch is not deployed.

### Remaining acceptance gates

- Project-aware Master Timeline insertion/conflict resolution must dispatch through the shared Composition boundary while preserving snap, overlap, ripple/trim and auto-extend behavior.
- Extend shared-command routing from resize to root/nested move, split, duplicate and insertion; verify atomic Undo/Redo parity and persistence after export/reopen.
- DYS-014 stays in progress until the Save-as-Clip UI produces an independent, structurally editable snapshot from the active authoritative state. PR #88 is helper-only; Draft PR #89 has a failed exact-head TypeScript/build and must not be merged as-is.
- Ask the owner for visual acceptance only after merge and a verified GitHub Pages deployment. No browser smoke tests.

## Nested resize command follow-up — 2026-10-20

Branch `feat/dys005-nested-resize-composition-command` adds `applyCompositionResizePreview()` to the immutable Composition command layer. The nested resize adapter now commits its already frame-snapped primary resize and any adjacent trim through that command, instead of directly transforming legacy layer arrays. Linked descendants receive the root timing and source range in the same immutable transaction, and legacy fields remain synchronized.

Focused local validation passed 18 tests in `src/compositionCommands.test.ts`, `src/nestedTimelinePlacement.test.ts`, and `src/clipVersionTracks.test.ts`; full local validation passed 214 tests across 22 files, TypeScript, and the Vite production build. `npm audit` is unavailable because this repository has no lockfile. This is not a PR CI or deployment result. DYS-005 remains in progress: Master insertion/conflict dispatch, root/nested history parity, canonical persistence, and structure-preserving Save-as-Clip are still open. No browser smoke tests were run.


## Root resize, move and insertion command integration — 2026-10-20

Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96) routes valid Master/root resize transactions through the same immutable `applyCompositionResizePreview()` command used by nested Clip Versions. Changed Composition placements are projected back into the transitional project model, including linked audio timing and source ranges. Valid ordinary root insertions now pass through `insertCompositionPlacement()`; duplicate placement IDs are rejected before insertion. Ordinary root clip moves now use `moveCompositionPlacementToTrack()` and synchronize moved linked descendants while preserving source ranges. Regression tests cover resize, move, linked-audio propagation/source ranges, input immutability, insertion, duplicate-ID rejection, and one-step Undo/Redo for a linked video+audio split.

Exact-head CI [39425783751](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39425783751) passed at code/test SHA `30afa93ea6ff9f6086229b4fd7bd9daba6a02796`: 219 tests across 23 files, TypeScript and production build passed. The dependency-audit workflow step is non-blocking. This is CI evidence only, not merge/deployment or visual acceptance. This is CI evidence only, not merge/deployment or visual acceptance. The adapter deliberately retains a compatibility fallback for materialized Storyboard placements and invalid legacy link groups; canonical-only persistence is not complete. No browser smoke tests were run.


## Save-as-Clip follow-up — 2026-10-20

The Master Timeline Save-as-Clip path now calls `createClipVersionSnapshot()` instead of only flattening renderer layers and regenerating their IDs. This is shared DYS-014 foundation work: DYS-005 remains in progress and canonical-only editing is not complete. See [DYS-014](./unified-composition-model.md) for the snapshot contract and remaining editor-adapter gap.


## Canonical nested editing adapter — 2026-10-20

The nested Clip Version editor now treats `ClipVersion.composition` as authoritative when present. Insert/move/resize/delete and inspector edits update canonical placements/tracks, while legacy `layers` and `tracks` are derived projections. Transform-only edits preserve source references; explicit source changes update typed references. Exact-head CI [39428872953](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39428872953) passed at code SHA `c82f305726afaacb424d9bf8e39c0fac37de5fc4`: 222 tests/23 files, TypeScript, production build and dependency audit (0 vulnerabilities). Remaining: full edit/save/reload/reopen parity, canonical nested Undo/Redo, pinned-version immutability, and migration/Shot Slot compatibility. DYS-005 remains in progress; no browser smoke tests.


## Save-as-Clip edit/reopen regression — 2026-10-20

Added snapshot → canonical nested edit → JSON save/reload → reopen coverage, including placement timing/transform/mix, source ranges, pinned child Composition/provenance, and proof the source Clip Asset Version is unchanged. Exact-head CI [39429740312](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39429740312) passed at SHA `7098229556fd466283a2e815de2ab44778089483`: 223 tests/23 files, TypeScript/build and dependency audit (0 vulnerabilities). Canonical nested Undo/Redo and broader pin/migration audit remain open.


## Source-reference preservation follow-up — 2026-10-20

Inspector changes now pass only changed fields to the canonical adapter, preserving exact typed source references during transform-only edits and reconstructing the reference only for deliberate source changes. Exact-head CI [39430375517](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39430375517) passed at SHA `47b700ea44937dbb8bfb6c35fbcf9efe690d4416`: 223 tests/23 files, TypeScript/build, audit 0 vulnerabilities.


## Canonical nested edit checkpoint — 2026-10-20

The nested Timeline helpers now treat an existing `ClipVersion.composition` as authoritative. Add/delete/move/resize, track-add and inspector patches update canonical placements/tracks, then refresh legacy `layers`/`tracks` projections. Inspector-only changes preserve typed Shot Slot/script source references and synchronize source ranges, transforms and mix/fade metadata. Regression tests cover stale projections, nested provenance, track/placement updates and source immutability.

Exact-head CI [39431744433](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39431744433) passed at `bbbbf18743a66de4ba66c14b9cde98bd9d490238`: 223 tests across 23 files, TypeScript/build passed, dependency audit 0 vulnerabilities. Remaining: nested Undo/Redo, migration/pin immutability breadth, and audit legacy Storyboard/Shot Slot handlers that directly mutate `layers`. Keep DYS-005 in progress; no browser smoke tests.


## Canonical migration hardening — 2026-10-20

Migration now preserves already-canonical Clip/Shot Slot Version documents instead of reconstructing them from compatibility layers, and Save-as-Clip keeps existing embedded nested subtrees. Exact-head CI [39445108693](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39445108693) passed 223 tests/23 files, TypeScript/build and dependency audit 0 vulnerabilities.

**Remaining architectural boundary:** root Composition in the V2 export remains a projection regenerated from the live schema-1.0 project. Canonical root Composition is not yet the live editor source of truth. Keep DYS-005 in progress; next root-persistence work must include canonical command state, deterministic legacy projection, edit/save/reopen and Undo/Redo coverage.


## Canonical duplication and nested mutation follow-up — 2026-10-20

- Clip Version, Shot, and Slot duplication now use `duplicateClipVersionComposition()`. The helper creates fresh local track/placement IDs, remaps track and linked video/audio references, refreshes compatibility projections, and retains pinned child Composition snapshots, source ranges, and provenance.
- The legacy Shot Slot inspector now routes edits for timing, source in/out, prompt, generation output, layer properties, insertion and deletion through the canonical nested Composition adapter. Direct `version.layers` mutations were removed from these nested edit handlers.
- Added regression cases for canonical and legacy-only duplication, linked references, track/placement identity, source ranges, provenance, pinned child retention and source immutability.
- Validation is pending on the final documentation-updated branch head. Do not treat previously passed CI as evidence for these latest changes. PR #96 remains Draft; no browser smoke tests or merge.
- Remaining architecture gap: root Composition is still a projection, not the live editor source of truth. Continue with root persistence, save/reopen and Undo/Redo after exact-head CI, and investigate any non-inspector legacy workflows still intentionally writing Shot Slot layers.


## Root Composition persistence follow-up — 2026-10-20

- Local recovery in `src/App.tsx` now writes the versioned project-document envelope, preserving the generated root Composition snapshot alongside the schema-1.0 compatibility project. Startup accepts both this envelope and existing schema-1.0 localStorage projects.
- Added `src/projectDocument.test.ts` coverage for root placement timing across save/reopen and project Undo/Redo.
- This does **not** complete canonical root authority: project edit commands still mutate schema-1.0 `DionysusProject`, and the root Composition is regenerated from that state. Remaining gate: root Composition-backed live commands plus deterministic compatibility projection, migration/pin/nesting coverage, and exact-head CI.
- No browser smoke tests were added or run. PR #96 remains Draft and unmerged.


## Root Composition mutation audit — 2026-10-20

The Master Shot move path now invokes the shared immutable Composition move command and projects the committed start/duration/track fields back into the schema-1.0 Shot, keeping materialized Storyboard placements aligned. A guarded compatibility fallback remains for malformed legacy projects.

This is a partial root-command audit, **not** completion of canonical root live state. `App.tsx` still owns schema-1.0 `DionysusProject`; root Composition is regenerated from that project. The next architectural gate is to make `CompositionDocument` the root timeline state/history authority and derive deterministic compatibility projections from it. Save/reopen/Undo/Redo must prove stale legacy fields cannot override canonical placements.


## Canonical root Composition live state — 2026-10-20

- App owns a live root `CompositionDocument` with paired Composition Undo/Redo snapshots. Root move and resize handlers execute Composition commands against this state before updating schema-1.0 compatibility fields.
- General root edits reconcile inserts, deletes, moves, resizes and track add/update/reorder/removal through Composition command invariants. The project model continues to carry assets, scripts, references, shot metadata and nested versions as compatibility/domain data.
- Save/export serializes the current canonical root. Startup restores a persisted root only when the envelope validates and the full schema-1.0 project payload matches; otherwise it safely migrates the legacy project. The compatibility projection preserves linked IDs/source ranges and materializes sequential Shot starts only when a root edit requires it.
- Regression coverage includes canonical root move → compatibility projection → save/reopen → Undo/Redo. Exact final-head CI is required before calling this checkpoint verified; do not claim complete until CI passes and remaining mutation-path edge cases are audited.


## Validation checkpoint

Exact-head CI #1404 passed on `90949d515d30827502e61fd4e9b1de5235037382`: 230 tests across 23 files, TypeScript/production build passed, dependency audit reported 0 vulnerabilities. The task registry and handoff were subsequently refreshed, so CI must be rerun on the final documentation head before this checkpoint is called fully verified.


## Canonical-first root mutation audit — 2026-10-20

- Root timeline insertion, conflict ripple/trim, move/drop and Master Shot Ripple Reorder now use live Composition placements as the source of timing and occupancy. Ripple moves linked groups together and preserves source ranges.
- Root clip metadata/source edits, preview transforms, mute/unlink, split/duplicate/delete, media import and track add/update/remove route through Composition commands first. The schema-1.0 project is derived compatibility data; domain reconciliation no longer overwrites existing canonical geometry/source/link fields from a stale migration.
- Track removal guards the last video track, requires a fallback for Master Shots, preserves video when removing only a linked audio child track, and catches invalid operations in the UI.
- Validated v2 import/recovery restores the saved canonical root when its compatibility projection matches; v2 tracks are not normalized a second time through the legacy migration path. Schema-1.0 imports remain supported.
- Tests cover stale legacy timing vs canonical occupancy, insertion/ripple/trim source-range preservation, Master Shot ripple reorder, track removal edge cases, canonical import, and App persistence/Undo/Redo.
- Exact-head CI must be checked on the final docs/code SHA. DYS-005/DYS-014 remain in progress pending green CI and remaining compatibility-only path review. No browser smoke tests; PR #96 remains Draft/unmerged.


## Canonical-first mutation audit — verified 2026-10-20

- Canonical root Composition drives pending insertion planning, conflict ripple/trim, drag/drop occupancy and Master Shot ripple reorder. Ripple updates linked placement groups through shared commands and preserves source ranges.
- Root clip metadata/source edits, mute/unlink, move, resize/trim, split, duplicate, delete, media import and track add/update/removal now route through canonical commands first. Compatibility reconciliation does not overwrite existing canonical timing, track, source or link state from a stale migration.
- Track-removal regression coverage includes final-video-track protection, Master Shot fallback requirements and deleting a linked audio child without deleting its parent video.
- Validated v2 import/recovery restores the stored root when the deterministic compatibility projection matches; schema-1.0 import still uses migration. Regression coverage also includes canonical save/reopen and App Undo/Redo.
- Exact-head CI [#39470992130](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39470992130) passed on `37ae7063f1e92018b75cb469ec198f9ba826cfee`: 240 tests across 23 files, TypeScript/production build passed, dependency audit 0 vulnerabilities. Docs are being refreshed in a single commit, so rerun CI on the resulting final SHA.
- DYS-005/DYS-014 remain in progress while compatibility-only Storyboard materializations and remaining domain-editor boundaries are reviewed. PR #96 remains Draft/unmerged. No browser smoke tests.


## Canonical resize/drop planner follow-up — 2026-10-20

- Root clip resize previews now derive the moving placement, source in-point, adjacent-placement timing and trim candidates from the live root `CompositionDocument`. Canonical drag/drop also uses the root placement's duration and root extent rather than stale legacy duration/timeline bounds.
- Compatibility projection now clears legacy `clipVersionId` and `scriptVersionId` values when the canonical typed source no longer carries them, and re-emits only the selector appropriate to a canonical Clip or Script source.
- Added stale-projection regressions for resize/adjacent trim planning and drag/drop duration, a source-selector projection regression, and an App-level resize → linked audio → Undo/Redo → saved Composition envelope → reopen regression.
- Exact-head CI [#39483256604](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39483256604) passed on `004302b6e0c4baca91681d9f6da0b200e1e45ad7`: 243 tests across 23 files, TypeScript and production build passed, npm audit reported 0 vulnerabilities.
- Remaining gaps: some Storyboard materializations are compatibility-only and are not canonical placements; Shot/Slot and other domain editors still mutate schema-1.0 project data before reconciliation; broader root track-reorder and malformed-snapshot recovery behavior need explicit end-to-end coverage. Keep DYS-005/DYS-014 `in_progress`. No browser smoke tests; PR #96 stays Draft and unmerged.


## Linked audio with independent source ranges — 2026-10-20

- Fixed canonical trim, resize and split so linked placements share timeline start/duration while retaining each placement's own source range. Linked audio can use a different source file/in-point; it must not inherit the video's sourceIn/sourceOut.
- Regression tests cover independent non-zero source offsets through trim, resize and split, including input immutability. The App-level split test now seeds linked audio with source range 7–12 seconds and asserts it becomes 7–9.5 and 9.5–12 seconds while video splits at 0–2.5 and 2.5–5 seconds.
- This follow-up still requires exact-head CI after the code/test/docs commit; the preceding CI above does not validate these new changes.
- Remaining architecture gaps are unchanged: compatibility-only Storyboard materializations, legacy-first Shot/Slot/domain editors, full track reorder/edit integration, and malformed root-snapshot recovery still need audit and regression coverage. DYS-005/DYS-014 remain in_progress; PR #96 remains Draft and unmerged. No browser smoke tests.


## Linked source fallback and canonical drag/drop audit — 2026-10-20

- Follow-up CI run [39484081761](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39484081761) exposed one compatibility regression: legacy linked audio with no explicit source range must inherit the video range instead of defaulting to 0. The command now inherits the root range only when the child has no explicit in/out; an explicitly sourced child retains its own offset through trim, resize and split.
- Root drag/drop and Master Shot drag/drop now normalize preview duration/start/track from the canonical root placement where present. The Master Shot overlap check uses canonical root occupancy and frame rate, not the potentially stale legacy project duration.
- Regression coverage retains distinct linked audio source offsets (including the App split from source range 7–12 seconds) and adds an explicit test that untrimmed legacy children inherit their root source range. The failed CI is preserved as a diagnostic record; this next source/test/docs head must run CI again.
- Known remaining gaps: canonical Composition is not yet authoritative across every Shot/Slot and Storyboard domain editor, Storyboard materializations remain compatibility-only, root track reorder needs end-to-end coverage, and malformed/nested/pinned root persistence/history requires further audit. DYS-005/DYS-014 remain in progress; keep PR #96 Draft and unmerged; no browser smoke tests.


## Canonical envelope restore and linked-source compatibility — 2026-10-20

- Corrected the v2 document boundary so createProjectDocument derives its schema-1.0 project projection from the validated root Composition; readProjectDocument validates root and nested/pinned snapshots, then reprojects compatibility placement fields from root instead of rejecting valid root timing/source/track/link edits because stored legacy fields are stale.
- App recovery now prefers a valid Composition envelope when project identity matches and its updatedAt revision is at least as new as the schema-1 recovery copy. A clearly newer or timestamp-ambiguous legacy recovery remains the fallback. The two storage reads are isolated so corrupt legacy JSON cannot prevent a valid v2 recovery.
- CI on 165708d2f5e5a1f7954d6ed370d4a9e625fa430e passed all 246 tests but failed TypeScript because getMasterShotPlacementItems became unused after canonical overlap checks. That helper has been removed. This source/test/docs follow-up requires exact-head CI.
- Added tests for deliberately stale projection geometry, invalid canonical placement legacy metadata, and retaining valid stored nested/pinned snapshots without reconstructing them from legacy fields.
- Still in progress: compatibility-only Storyboard materializations, legacy-first Shot/Slot/domain editors, broader root track reorder and track-settings integration, and malformed/nested/pinned snapshot/history coverage beyond these focused tests. DYS-005/DYS-014 remain in_progress; PR #96 stays Draft and unmerged. No browser smoke tests.


## Recovery-fixture correction — 2026-10-20

- CI run [39485463504](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39485463504) failed 32 App assertions because those tests manually replaced schema-1.0 local storage while retaining the prior v2 envelope at the same updatedAt. Legacy-only fixture writes now remove the v2 key; dedicated save/reopen tests continue to exercise both stores.
- Project-document assertions compare with the deterministic canonical compatibility projection included in the v2 export, instead of the raw pre-projection object. The raw schema-1.0 import path remains lossless.
- Exact-head CI for the correction is required. DYS-005/DYS-014 stay in_progress; PR #96 remains Draft and unmerged; no browser smoke tests.


## Canonical track settings — 2026-10-20

- Generic and Video layer settings now call the root Composition track command directly. Canonical fields include name, mute, background, transparency and opacity; track geometry/settings that have not been promoted yet remain in that track's legacyData so the schema-1.0 projection remains compatible.
- App regressions now check not only the schema-1.0 track object but the stored root Composition track for background transparency/opacity and X/Y/width/height transform values.
- The preceding exact-head CI run 39486016683 passed on 8bdafe463fea6b1bdb0ec082aab92c87b9bc7aba (249 tests/23 files, TS/build successful, npm audit found 0 vulnerabilities). This track-settings patch requires its own exact-head CI run.
- Remains in progress: Shot/Slot and other storyboard/domain editors still perform legacy-first mutations; Storyboard materializations remain compatibility-only, and wider root track reorder plus invalid/nested/pinned history cases require additional coverage. DYS-005/DYS-014 stay in_progress. Keep PR #96 Draft/unmerged; no browser smoke tests.

## Recursive nested/pinned snapshot validation — 2026-10-20

- Composition validation now recursively checks embedded nestedCompositions, rejects cyclic embedded document graphs, validates provenance kind/createdAt and pinned-version reference shape, and continues to check each nested document's local track/placement/link invariants.
- Replaced the prior top-level migration-snapshot check with tests that serialize and reopen an actual root containing a nested Composition with pinned-version provenance. Added rejection coverage for invalid nested timing, empty pinned version IDs and cyclic embedded snapshots.
- The immediately preceding head 85cf6043070a711c469f2ec5baa588ad538d1ce5 passed exact-head CI run 39486652985: 249 tests across 23 files, TypeScript/build passed, npm audit reported 0 vulnerabilities. The recursive-validation batch still requires CI on its own exact head.
- Still incomplete: full App-level editing/history transitions for nested/pinned compositions, legacy-first Shot/Slot and other domain editors, compatibility-only Storyboard materializations, track reorder/settings end-to-end coverage beyond the new track settings tests, and malformed import/recovery cases beyond the focused validation suite. Keep DYS-005/DYS-014 in_progress and PR #96 Draft/unmerged. No browser smoke tests.