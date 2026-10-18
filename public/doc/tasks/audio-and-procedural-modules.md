# DYS-008 — Audio layers, timed text, and procedural Three.js modules

**Status:** In progress  
**Progress estimate:** 60%  
**Last updated:** 2026-10-18

## Implemented in the current slice
- [x] Persist independent mute state on every Audio Layer track and individual audio clips.
- [x] Add Master Timeline Text blocks and typed text track lanes.
- [x] Add a typed procedural/Three.js Master Timeline block and Version-internal procedural layer.
- [x] Store a procedural block's optional pinned script/scene Version ID in the project.
- [x] Edit nested Version duration and each Text/procedural module's internal start/duration independently.
- [x] Move nested modules by frame-snapped drag and reorder them through layer headers.
- [x] Preserve stored Version layer order in compositor collection.
- [x] Expose per-Audio-Layer volume, Fade In, and Fade Out in both Master and nested Version inspectors.
- [x] Apply a shared normalized audio envelope to live playback and WebM export using per-layer Web Audio gain automation.
- [x] Keep source trim controls independent from nested Version duration; splitting a video splits linked audio in sync and preserves source/fade boundaries.
- [x] Clamp Fade In/Out values when trim/source range edits shorten an audio module or clip.
- [x] Round-trip per-layer audio mix, source ranges, linked audio, and mute state through project JSON validation.
- [x] Distinguish procedural layer representation from actual final rendering; current renderer does not execute Three.js code.

## Remaining scope
- [ ] Audio automation, ducking, effects, and richer multitrack mixing.
- [ ] Rich timed text styling, typography, transitions, and keyframes.
- [ ] A full procedural parameter UI and safe runtime/sandbox model.
- [ ] Explicit user authorization before executing custom or imported code.
- [ ] Pinned script-version validation, runtime error isolation, and actual preview/render integration.
- [ ] Final composition/export support for procedural output.

## Acceptance criteria
- Muting one Audio Layer does not mute another; track/clip mute state persists and is honored by preview/composition audio.
- Volume and fade settings persist per Audio Layer and the same envelope is applied to preview playback and WebM export.
- Text and procedural blocks are typed project items, not disguised media files.
- Saved Shot Versions can identify the specific procedural script/module version they depend on.
- Custom code is never executed automatically when imported or selected.
- The UI clearly distinguishes represented modules from rendered output.

## Validation
- CI run [#39122750551](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39122750551): 90 tests passed across 10 files, TypeScript check and production build passed, npm audit reported 0 vulnerabilities.
- Automated browser smoke testing was not run.
