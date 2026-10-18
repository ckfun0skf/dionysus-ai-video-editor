# DYS-008 — Audio layers, timed text, and procedural Three.js modules

**Status:** Planned  
**Last updated:** 2026-10-18

## Summary
Provide independent track-level audio mute and mixing controls, timed text, and first-class user-authorized JavaScript/Three.js timeline modules.

## Scope
- [ ] Persist an independent mute/unmute state on every Audio Layer; mute one layer without affecting other audio layers.
- [ ] Support multitrack audio, trim, volume, fades, sync, automation, and ducking.
- [ ] Define and implement an initial effects/transitions set.
- [ ] Support timed text and distinct title/text lanes.
- [ ] Treat Three.js/procedural content as a first-class timeline layer with duration, script/scene identity, parameters, and Inspector support.
- [ ] Pin script/module versions in saved Shot Versions and isolate runtime errors.
- [ ] Require explicit user authorization and an appropriate security boundary before custom code executes.
- [ ] Distinguish timeline representation, preview support, and final composition support; never imply Three.js output is rendered when it is not.

## Acceptance criteria
- Each Audio Layer has independent persistent mute state and its own preview/playback behavior.
- A Three.js layer can be represented and edited as a typed module; saved Versions pin the exact script/module version.
- Unauthorized imported/custom code does not execute.
- Runtime errors are isolated to the procedural layer and are surfaced clearly.
- Automated model/operation tests and production build pass before task status is updated.

## Related files
- [Task detail page](./audio-and-procedural-modules.html)
- [Completion report](../reports/audio-and-procedural-modules-report.md)
- [Task dashboard](../task.html)
