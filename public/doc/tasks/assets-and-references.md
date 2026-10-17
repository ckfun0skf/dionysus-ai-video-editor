# DYS-004 — Asset library and reference profiles

**Status:** In progress  
**Progress estimate:** 65%  
**Last updated:** 2026-10-17

## Summary
Build CRUD workspaces for asset metadata and reusable reference profiles, including reference roles and shot-level reference overrides.

## Scope
- [x] Create and edit asset metadata (name, type, notes, source filename).
- [x] Delete unused assets and prevent deletion when an asset is referenced.
- [x] Create, edit, and delete character/entity reference profiles.
- [x] Add, change role, and remove references within a profile.
- [x] Assign reference profiles to individual shots without mutating the profile.
- [x] Exclude or replace a profile reference on a specific shot without changing the global profile.
- [ ] Persist imported media bytes, relinking, and generate real previews; current file import records metadata and source filename only.
- [ ] Capture and review the exact reference snapshot used by each generation.
- [ ] Add automated UI tests and perform browser smoke testing.

## Implemented / verified
- Asset metadata form and editable asset cards.
- File selection recognizes common video, image, audio, script, and other types; the UI warns that source bytes are not copied into the project.
- Reference profiles support name/entity-type editing, deletion, and per-reference role management.
- Shots can assign profiles and override individual references with “Use profile”, “Exclude”, or “Replace” behavior.
- Removing a profile assignment also removes overrides for references no longer assigned to the shot.
- Project validation checks that profile references, shot profile assignments, layer assets, generation snapshot assets, and reference overrides point to existing records.
- Automated validation tests cover broken profile asset references, missing shot profiles, and broken override references.

## Remaining work
- Actual binary media storage/relinking and thumbnails.
- Generation snapshot capture and review workflow.
- Automated UI tests and browser smoke test.

## Evidence and links
- [Task detail page](./assets-and-references.html)
- [Completion report](../reports/assets-and-references-report.md)
- [Task dashboard](../task.html)
- [Pull request #1](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/1)
