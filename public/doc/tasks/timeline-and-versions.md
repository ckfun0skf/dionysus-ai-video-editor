# DYS-005 — Precise Timeline editing and Version management

**Status:** In progress  
**Progress estimate:** 25%  
**Last updated:** 2026-10-17

## Summary
Build a practical Timeline editor with clip selection and per-Clip Slot version management as the first milestone.

## Scope
- [x] Select a Clip Slot from the Timeline.
- [x] Show all versions for the selected slot, including a visual placeholder thumbnail, description, duration, and layer/generation counts.
- [x] Switch the selected version without changing other Clip Slots' selectedVersionId.
- [x] Create a new version while preserving prior versions; clone layer configuration with fresh layer IDs and start a fresh generation history.
- [x] Edit the selected version description.
- [ ] Accurate drag/drop timing, source trim, overlapping layers, and track operations.
- [ ] Real media thumbnails and previews.
- [ ] Internal Version timelines and nested composition depth/cycle protection.
- [ ] Explicit fixed-duration, auto-extend, and ripple operations.

## Implemented / verified
Version picker UI and state update functions are included in the feature branch. Automated CI and browser interaction checks are pending until the PR workflow runs.

## Remaining work
Timeline remains a planning UI: clip drag/drop, actual thumbnail extraction, media playback, and compositing are not implemented in this milestone.

## Evidence and links
- [Task detail page](./timeline-and-versions.html)
- [Completion report](../reports/timeline-and-versions-report.md)
- [Task dashboard](../task.html)

## Status rules
- **Implemented** means the listed implementation exists; it does not imply every release QA step is complete.
- **In progress** means implementation or validation is outstanding.
- **Planned** means implementation has not started or is not evidenced yet.
