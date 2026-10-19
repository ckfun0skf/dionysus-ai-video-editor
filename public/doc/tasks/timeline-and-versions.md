# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress · **Progress estimate:** 75% toward the revised target · **Updated:** 2026-10-19

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
