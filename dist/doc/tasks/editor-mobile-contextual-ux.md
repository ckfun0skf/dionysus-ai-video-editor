# DYS-018 — Contextual controls and touch-first Timeline Editor

**Status:** Planned · **Progress:** 0%  
**Milestone:** M4 — Preview, compositing and responsive Editor UX  
**Depends on:** DYS-016 workspace contract; DYS-017 modular Editor workspace; existing DYS-012 touch foundations

## Goal

Adapt the new Timeline Editor for phone and tablet use without treating global application navigation as the Editor's bottom toolbar. Reuse the same project document, selected placement, commands and history as Desktop.

## Required mobile information hierarchy

1. Project/header actions and a workspace/menu switcher.
2. Preview/canvas with compact playback, timecode and accessible history controls.
3. Multitrack timeline in an isolated horizontal scroll region.
4. Bottom contextual action strip driven by the active selection.
5. Media/Effects browsing and dense properties in sheets/panels that return to the same editing state.

The bottom action strip must change with selection. With no placement selected it shows timeline/workspace actions; with a video, audio, text, asset or Clip selected it shows relevant operations only. Storyboard, Timeline, Assets and References are not four permanent buttons in this bottom strip.

## Interaction requirements

- Touch selection, long-press drag, pan, scrub, trim, zoom/fit, version picking, split/duplicate/delete, Undo/Redo and audio mute remain accessible.
- Drag initiation and panning are unambiguous. Timeline gestures must not accidentally scroll the whole page.
- Track labels and ruler remain aligned; trim handles have usable hit targets for short clips.
- Sheet open/close, rotation and viewport changes preserve selection and avoid losing unsaved edits.
- Safe-area insets and the on-screen keyboard do not hide the contextual controls.
- The same command/validation layer powers Desktop and Mobile. Do not fork data semantics per device.

## Acceptance criteria

- [ ] No page-level horizontal overflow at target phone portrait, phone landscape or tablet widths.
- [ ] Timeline/source browser own their horizontal scrolling.
- [ ] Bottom controls reflect selection and expose reachable, correctly labelled actions.
- [ ] Global module navigation remains available from header/menu without displacing the editing toolbar.
- [ ] Preview, playhead, selection, zoom and Inspector/sheet state survive layout changes.
- [ ] Existing DYS-012 touch behavior remains covered; regression tests protect selection, scrubbing, move, trim, zoom, version choice, Undo/Redo and mute.
- [ ] Manual acceptance matrix records actual viewport and outcome only after the deployment is verified.
- [ ] Exact-head CI, main CI and Pages deployment are recorded separately.
- [ ] No automated browser smoke tests are added or run.

## Relationship to existing work

DYS-012 has already shipped responsive/touch foundations. This task does not recreate them; it re-homes them within the new workspace and supersedes the earlier idea of a persistent four-module mobile bottom navigation inside the Editor. Keep DYS-012 in progress until actual viewport acceptance is recorded.
