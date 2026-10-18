# DYS-005 — Master and nested Timeline editing with Version management

**Status:** In progress  
**Progress estimate:** Reassess after implementation  
**Last updated:** 2026-10-18

## Goal
Build one coherent Timeline workspace with a Master Timeline tab, editable Shot-Version timeline tabs, and a Version selector on each Master Shot.

## Required interaction model
- The preview stays above visible multi-layer lanes.
- The default tab is Master Timeline. Editing a specific Shot Version opens a new tab for that Version and keeps Master Timeline available.
- Each Master Shot block shows its active-Version thumbnail/placeholder, Shot label, and a dropdown/chevron.
- The dropdown shows versions, offers + Add Version, and has an Edit action for every Version. Selecting a version changes the active output; Edit opens that Version's internal timeline.
- No generic Media track. Media is an asset library/source concept, not a timeline layer.
- Version internals contain ordered video/image, text, audio, and procedural Three.js modules. The Master Shot's placement/duration stays independent from internal Version timing.
- Timeline edits are non-destructive and integrated with Undo/Redo.

## Scope
- [x] Select a Clip Slot / timeline item and switch the active Version.
- [x] Preserve existing Versions when creating a new Version.
- [ ] Separate Master Shot placement/duration from Version-internal timing in the model and UI.
- [ ] Add Master Timeline + nested Version timeline tabs.
- [ ] Add per-Shot thumbnail/version dropdown with + Add Version and per-Version Edit.
- [ ] Make visible track/layer lanes authoritative; remove generic Media-track presentation.
- [ ] Support nested composition depth/cycle protection and explicit fixed-duration, auto-extend, and ripple operations.
- [ ] Preserve Version selection, layer order, and nested data through project JSON round-trip and Undo/Redo.

## Acceptance criteria
- Master Timeline remains open while any Shot-Version timeline is open in another tab.
- Adding a Version never overwrites existing Versions; choosing a Version updates only that Shot's active Version.
- The Shot block shows an actual thumbnail when one exists and a neutral placeholder otherwise.
- Project JSON preserves active-Version selection and nested Version data.
- Unit/integration tests cover the model and project-state behavior; CI test and build pass.
- Do not add automated browser smoke tests unless explicitly requested by the user.

## Related specs
- [Creative Editing Workflow](../creative-editing-workflow-spec.md)
- [Completion report](../reports/timeline-and-versions-report.md)
- [Task dashboard](../task.html)
