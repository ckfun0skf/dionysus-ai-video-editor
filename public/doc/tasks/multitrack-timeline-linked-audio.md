# DYS-011 — Multi-track Timeline and linked audio

**Status:** Planned  
**Milestone:** M3 — Timeline model and Version workflow

## Goal
Support multiple video tracks and audio that follows its source video by default, while allowing audio to be unlinked and edited independently.

## Scope
- Represent video and audio clips as explicit timeline items with track, start, duration, and source references.
- Link a video's audio to its source clip by default when source audio exists.
- Allow unlinking audio without changing the video's timing or media.
- Support moving, trimming, splitting, and deleting independent audio clips.
- Define overlap and track validation rules and preserve links through project import/export and undo/redo.

## Out of scope
- Full multitrack audio mixing and effects (tracked in DYS-008).
- Actual MP4 rendering (tracked in DYS-009).

## Acceptance criteria
- [ ] Project schema distinguishes video tracks, audio tracks, and clip relationships.
- [ ] Source audio is linked by default when applicable.
- [ ] Unlinking audio enables independent edits and does not move the video.
- [ ] Timeline edits preserve valid references and reject invalid ranges.
- [ ] Undo/redo and project JSON round-trip preserve track and link state.
- [ ] Tests cover linked movement, unlinking, independent trim/move, deletion, and malformed data.

## Verification evidence
Record the test names/results, a project JSON fixture showing linked and unlinked audio, and a browser walkthrough before changing status to complete.

## Dependencies
DYS-005 timeline/version model; DYS-007 history and project portability.
