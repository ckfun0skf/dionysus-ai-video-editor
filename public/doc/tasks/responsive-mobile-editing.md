# DYS-012 — Responsive mobile editing

**Status:** Planned  
**Milestone:** M4 — Preview, compositing, and mobile editing

## Goal
Make the editing workspace usable on phone and tablet screens without removing the existing Storyboard, References, or Assets workflows.

## Scope
- Reflow the editing workspace into a mobile-first, touch-friendly layout.
- Keep preview, timeline, clip selection, and Inspector access discoverable on small screens.
- Provide touch targets and gestures for selecting clips, moving the playhead, and opening version controls.
- Preserve desktop layout behavior and keyboard shortcuts.
- Test narrow portrait, landscape, and tablet breakpoints.

## Out of scope
- Replacing the app's navigation or redesigning non-editing views.
- Implementing media playback/compositing itself (DYS-006).

## Acceptance criteria
- [ ] No horizontal page overflow at supported mobile widths.
- [ ] Preview and timeline can both be accessed without losing the current selection.
- [ ] Core controls have practical touch targets and visible focus states.
- [ ] Storyboard, References, and Assets remain available.
- [ ] Automated responsive checks and manual device/browser smoke tests are documented.

## Verification evidence
Record viewport sizes, browser/device, screenshots, overflow checks, and the tested editing flows before changing status to complete.

## Dependencies
DYS-005 timeline workflow; DYS-006 preview/compositing.
