# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress · **Progress estimate:** 87% toward the revised target · **Updated:** 2026-10-20

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
- Verify atomic Undo/Redo parity for root and nested interactions and persistence after export/reopen.
- DYS-014 stays in progress until the Save-as-Clip UI produces an independent, structurally editable snapshot from the active authoritative state. PR #88 is helper-only; Draft PR #89 has a failed exact-head TypeScript/build and must not be merged as-is.
- Ask the owner for visual acceptance only after merge and a verified GitHub Pages deployment. No browser smoke tests.

## Nested resize command follow-up — 2026-10-20

Branch `feat/dys005-nested-resize-composition-command` adds `applyCompositionResizePreview()` to the immutable Composition command layer. The nested resize adapter now commits its already frame-snapped primary resize and any adjacent trim through that command, instead of directly transforming legacy layer arrays. Linked descendants receive the root timing and source range in the same immutable transaction, and legacy fields remain synchronized.

Focused local validation passed 18 tests in `src/compositionCommands.test.ts`, `src/nestedTimelinePlacement.test.ts`, and `src/clipVersionTracks.test.ts`. This is not a PR CI or deployment result. DYS-005 remains in progress: Master insertion/conflict dispatch, root/nested history parity, canonical persistence, and structure-preserving Save-as-Clip are still open. No browser smoke tests were run.
