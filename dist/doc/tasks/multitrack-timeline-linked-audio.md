# DYS-011 — Hierarchical audio lanes, linked source audio, and mute

**Status:** Done · **Progress:** 100% · **Milestone:** M3 — Timeline model and Version workflow  
**Updated:** 2026-10-18

## Scope — implemented
- [x] Validate video/audio clips, source-audio links, and stable IDs.
- [x] Show linked source audio as an indented child lane; unlink without changing timing.
- [x] Move/trim linked clips together; split/duplicate while preserving source ranges, mix, and fades.
- [x] Move, trim, split, and delete independent audio after unlinking.
- [x] Per-clip and per-Audio-Layer mute controls.
- [x] Delete linked video and child audio together; deleting linked audio alone preserves video.
- [x] Removing a video layer removes linked child audio while preserving detached audio.
- [x] Undo/Redo and project JSON export/import coverage.

## Validation
PR #57 CI [#39160785330](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39160785330) passed 129 tests across 15 files, TypeScript and production build at test SHA `e9b4246ce551adff5816f91487e33958277e0e8e`. Browser smoke tests were not run.

## Remaining limitations
Audio automation, ducking and advanced effects remain tracked under DYS-008. WebM support does not imply production-grade MP4 export.
