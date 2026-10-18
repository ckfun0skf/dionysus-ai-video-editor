# DYS-011 — Hierarchical audio lanes, linked source audio, and mute

**Status:** In progress  
**Progress estimate:** 65%  
**Milestone:** M3 — Timeline model and Version workflow  
**Last updated:** 2026-10-18

## Required interaction model
- Video track headers expand/collapse their linked source-audio child lanes.
- The child lane has a visible linked indicator and an **Unlink** action.
- Unlink preserves current start and duration. The detached audio moves into the normal independent Audio Layer lane.
- Each Audio Layer track has its own persistent **Mute/Unmute**; individual audio clips also have a separate mute flag.
- Muting a track or clip affects preview playback and compositor audio output without muting other tracks.
- The user-facing Timeline has typed layers and no generic **Media track**.

## Scope
- [x] Represent video/audio timeline clips and source-audio links.
- [x] Move/trim linked clips together and unlink without changing current timing.
- [x] Render linked source audio as an indented child lane beneath the parent video clip.
- [x] Add **Unlink**, per-clip mute, and per-Audio-Layer track mute controls.
- [x] Apply mute state during preview playback and propagate track mute to collected composition layers.
- [ ] Finish independent move/trim/split/delete behaviors, especially splitting.
- [ ] Add exhaustive round-trip and Undo/Redo tests for links, track mute, and clip mute.
- [ ] Verify group deletion semantics for every parent/child arrangement.

## Acceptance criteria
- Expanding/collapsing a video layer shows/hides its child audio lane.
- Unlink converts linked audio to an independent Audio Layer without shifting either source at unlink time.
- Muting one Audio Layer does not mute other Audio Layers; clip mute remains independently controlled.
- Deleting unlinked audio never deletes its video source.
- Tests cover linking, movement, trim, unlink, mute isolation, deletion, invalid references, Undo/Redo, and project JSON round-trip.

## Validation
- CI run [#39117698570](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39117698570): 64 tests passed across 7 files, TypeScript check and production build passed, npm audit found 0 vulnerabilities.
- App integration test checks linked child-lane visibility, clip mute, track mute, independent mute state, unlink, and unchanged video timing.
- No automated browser smoke test was run or added.
