# DYS-011 — Hierarchical audio lanes, linked source audio, and mute

**Status:** In progress — model foundations exist; full lane UX is outstanding  
**Milestone:** M3 — Timeline model and Version workflow  
**Last updated:** 2026-10-18

## Goal
Make source audio visible as an expandable child lane under its video layer. Let users unlink it into an independent Audio Layer, then independently edit or mute it.

## Required interaction model
- Video layer headers can expand/collapse their linked source-audio child lane.
- The child lane has a visible Unlink action and a clear linked indicator.
- Unlinking preserves the current start and duration; it detaches the audio so it can move, trim, mute, or delete independently.
- Each independent Audio Layer has its own persistent Mute/Unmute toggle; mute is not a global audio switch.
- Do not use a generic Media track.
- The same behavior must be available in both Master Timeline and nested Version timelines where source audio exists.

## Scope
- [x] Represent video/audio timeline items and linked-source references.
- [x] Add operations to link by default, move/trim linked clips together, unlink, and delete safely.
- [ ] Display linked source audio as a nested child lane under its video layer rather than a flat metadata list or generic media lane.
- [ ] Support independent per-audio-layer mute state in model, UI, preview, and eventual composition output.
- [ ] Preserve the distinction between linked and unlinked audio through layer reordering, project import/export, and Undo/Redo.
- [ ] Define safe group semantics for deleting a video with linked child audio; unlinked audio must never be deleted as a side effect.
- [ ] Support independent move/trim/split/delete operations after unlinking.

## Acceptance criteria
- Expanding a video layer reveals linked audio as an indented child lane.
- Unlink does not move or trim either the audio or video at the moment of unlink.
- The unlinked audio becomes an independent Audio Layer.
- Muting one audio layer leaves all other audio layers unaffected and mute state persists after save/reload.
- Deleting unlinked audio leaves the video intact.
- Unit/integration tests cover linking, movement, trim, unlink, mute isolation, deletion, invalid references, Undo/Redo, and project JSON round-trip.
- Do not add automated browser smoke tests unless explicitly requested by the user.

## Dependencies
DYS-005 timeline/version model; DYS-007 history and project portability; DYS-008 audio/procedural rendering.
