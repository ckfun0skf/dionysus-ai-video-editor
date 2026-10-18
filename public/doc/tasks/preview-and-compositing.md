# DYS-006 — Preview, playback, and media compositing

**Status:** In progress · **Progress:** 80% · **Updated:** 2026-10-18

## Implemented / verified
- [x] Integrated canvas preview in the Master Timeline and nested Shot-/Clip-Version tabs.
- [x] Separate playhead state for each Timeline tab; play, pause, seek, step, and overlay controls.
- [x] Render available image/video/text/Clip-composition layers in stored z-order with per-layer timing.
- [x] Support source in/out, contain/cover/fill, canvas transforms, backgrounds, opacity, borders, and supported animation settings.
- [x] Preview source audio with video-playhead synchronization and supported volume/fade/mute settings.
- [x] Canvas transform UI updates the selected layer/clip/track geometry in project state; unit tests cover normalized move/resize bounds.
- [x] Explicit thumbnail placeholders remain available when media decoding/thumbnail generation is not possible.

## Remaining work
- [ ] Raise preview quality beyond the current adaptive cap (interactive canvas is limited to 1280×720); a 4K-capable preview is not claimed.
- [ ] Complete durable media-byte import, relinking, and consistent thumbnail regeneration with DYS-004.
- [ ] Extend first/last-frame thumbnail behavior to every supported source/codec and improve missing-source recovery.
- [ ] Production-grade MP4 export remains in DYS-009; current WebM export is experimental.

## Validation
- PR #57 CI [#39160785330](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39160785330) previously passed 129 tests across 15 files, TypeScript, and production build before the added UI transform persistence test.
- Existing test coverage includes preview per-tab playhead, controls/canvas settings, composition ordering/nested Clip version selection, and normalized preview transforms.
- Automated browser smoke tests were not run.
