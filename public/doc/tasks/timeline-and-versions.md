# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress  
**Progress estimate:** 82%  
**Last updated:** 2026-10-18

## Goal
Provide the prototype-style Master Timeline with Shot Version selection, an in-workspace nested timeline for editing each Version, and an independent Master placement model.

## Implemented
- [x] Preserve multiple Versions and switch the active Version independently for each Slot.
- [x] Show Master Shot blocks by default, including a thumbnail when available and an explicit placeholder otherwise.
- [x] Version dropdown supports active Version selection, **+ Add Version**, and **Edit** on each Version.
- [x] Master Timeline and nested Shot-Version timelines live in separate tabs within the Timeline workspace.
- [x] Nested Version Timeline displays typed layer rows for video, image, audio, text, and procedural/Three.js modules.
- [x] Replace the ambiguous visible “Media track” heading with “Timeline layers.”
- [x] Persist optional absolute Master Shot positions while legacy projects fall back to their original sequential layout.
- [x] Move Master Shot blocks by drag-and-drop with project-frame-rate snapping.
- [x] Keep Master Shot target duration, Clip Slot duration, and Version-internal duration separate.
- [x] Render nested Version layers using the Master Shot's absolute offset.
- [x] Edit a Version's internal duration without changing the Master Shot or Clip Slot duration.
- [x] Edit each nested module's start/duration in the Inspector and move module blocks with frame-rate snapping.
- [x] Reorder nested modules using layer-header controls; compositor collection preserves the stored Version layer order.
- [x] Generate compact local thumbnails for imported image/video sources and generated image outputs when the browser can decode them.
- [ ] Complete real media thumbnail extraction, richer source assignment/preview, and a dedicated ripple/reorder mode with an explicit overlap policy.
- [ ] Expand project JSON round-trip and Undo/Redo coverage for all nested relationships and placement edits.

## Validation
- CI run [#39119716811](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39119716811): 75 tests passed across 9 files, TypeScript check and production build passed, and npm audit reported 0 vulnerabilities.
- Regression coverage checks legacy sequential fallback, independent Shot movement/duration, independent Version duration, module start/duration, frame-snapped drag placement, layer reordering, absolute offsets in composition collection, and thumbnail extraction/URL fallbacks.
- Automated browser smoke tests were not run or added.

## Related files
- [Creative Editing Workflow Specification](../creative-editing-workflow-spec.md)
- [Task detail page](./timeline-and-versions.html)
- [Completion report](../reports/timeline-and-versions-report.md)
- [Task dashboard](../task.html)
