# DYS-004 — Asset library and reference profiles

**Status:** In progress  
**Progress estimate:** 45%  
**Last updated:** 2026-10-17

## Summary
Build CRUD workspaces for asset metadata and reusable reference profiles, including reference roles and shot-level profile assignment.

## Scope
- [x] Create and edit asset metadata (name, type, notes, source filename).
- [x] Delete unused assets and prevent deletion when an asset is referenced.
- [x] Create, edit, and delete character/entity reference profiles.
- [x] Add, change role, and remove references within a profile.
- [x] Assign reference profiles to individual shots without mutating the profile.
- [ ] Persist imported media bytes and generate real previews; current import registers metadata and source filename only.
- [ ] Implement shot-level reference exclusions/replacements and generation snapshots in the editing workflow.
- [ ] Add automated tests for asset/profile CRUD and reference integrity.

## Implemented / verified
- Asset metadata form and editable asset cards.
- File selection recognizes common video, image, audio, script, and other types; it explicitly warns that the source file is not copied into the project.
- Reference profiles support name/entity-type editing, deletion, and per-reference role management.
- Shots can include/exclude profile assignments.
- Existing project JSON model already includes assets, profiles, reference roles, and shot profile assignments.

## Remaining work
- Actual binary media storage/relinking and thumbnails.
- Per-shot reference overrides for excluding/replacing a specific reference.
- Automated interaction tests and browser smoke test.

## Evidence and links
- [Task detail page](./assets-and-references.html)
- [Completion report](../reports/assets-and-references-report.md)
- [Task dashboard](../task.html)
- [Pull request #1](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/1)
