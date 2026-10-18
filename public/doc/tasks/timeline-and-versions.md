# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress  
**Progress estimate:** 55%  
**Last updated:** 2026-10-18

## Goal
Provide the prototype-style Master Timeline with Shot Version selection and an in-workspace nested timeline for editing each Version.

## Implemented
- [x] Preserve multiple Versions and switch the active Version independently for each Slot.
- [x] Show Master Shot blocks by default, including a thumbnail when available and an explicit placeholder otherwise.
- [x] Version dropdown supports active Version selection, **+ Add Version**, and **Edit** on each Version.
- [x] Master Timeline and nested Shot-Version timelines live in separate tabs within the Timeline workspace.
- [x] Nested Version Timeline displays typed layer rows for video, image, audio, text, and procedural/Three.js modules.
- [x] Replace the ambiguous visible “Media track” heading with “Timeline layers.”
- [ ] Fully separate master Shot placement/persistence from the media clip-placement model and add frame-accurate timing/trim.
- [ ] Complete nested module Inspector editing, source binding, ordering/reordering, and media thumbnail extraction.
- [ ] Expand project JSON round-trip and Undo/Redo coverage for all nested relationships.

## Validation
- CI run [#39117698570](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39117698570): 64 tests passed across 7 files, TypeScript check and production build passed, and npm audit reported 0 vulnerabilities.
- App integration tests cover opening/closing the nested Version tab, active Version operations, adding a procedural module, and returning to Master Timeline.
- Automated browser smoke tests were not run or added.

## Related files
- [Creative Editing Workflow Specification](../creative-editing-workflow-spec.md)
- [Task detail page](./timeline-and-versions.html)
- [Completion report](../reports/timeline-and-versions-report.md)
- [Task dashboard](../task.html)
