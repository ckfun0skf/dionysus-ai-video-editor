# DYS-014 — Unified Composition Model and structure-preserving snapshots

**Status:** In progress · **Progress estimate:** 25% · **Updated:** 2026-10-19

## Goal

Use one Composition document contract and one Editor for the Project Master Timeline and nested Clip Asset Versions. Saving a completed Project timeline as a Clip Asset must preserve its editable structure.

## Implemented slice (not yet integrated)

- Added typed canonical Composition, Track, Placement and source-reference definitions in `src/compositionModel.ts`.
- Added `migrateLegacyProjectToComposition()` in `src/compositionMigration.ts`. It projects the root timeline and each Clip Asset Version, keeps the original schema-1.0 project as a defensive copy, preserves legacy placement fields, and reports duplicate materialized Storyboard placements, missing sources and unsupported track kinds.
- Added `src/compositionMigration.test.ts` for stable IDs/order, source ranges, linked audio, Shot Slot and Clip Version pins, nested layer conversion, duplicate detection, missing-source warnings, deterministic output and source immutability.
- Not complete: app persistence/import/export and the live Master/Clip editors still use schema 1.0. CI must be checked on the exact PR head before accepting the code slice.

## Target contract

- The Project root is a Composition; a Clip Asset is a reusable, versioned Composition.
- A Shot is narrative/production identity with concrete generated shot-video alternatives, not a nested edit timeline.
- Every placement refers to a typed source and pins a concrete version where applicable.
- Root and nested compositions share editor components and placement mechanics.
- Add Track has Video, Audio and Text at all composition depths.
- Save-as-Clip preserves tracks, placements, ordering, timing/source ranges, nested relationships, canvas settings and pinned versions.
- Snapshots are independently editable at the top-level version; media can be shared by stable Asset ID inside one Project.
- The existing schema requires deterministic, versioned, non-destructive migration.

## Implementation slices

- [x] Document target ownership, editor parity, snapshot semantics and migration safeguards.
- [ ] Define typed Composition documents, source references, placements and version pinning.
- [ ] Add deterministic migration from schema 1.0 Shot Slots, nested layers and `storyboard-*` placements.
- [ ] Move root and nested editors to shared composition context and placement operations.
- [ ] Implement structure-preserving save/open/edit of Project-to-Clip snapshots.
- [ ] Prove source/snapshot independence and new-Version editing.
- [ ] Test migration, JSON round-trip, nested render, editing parity and Undo/Redo.

## Acceptance

- Root and nested Clip Versions use the same track/placement schema and shared editing mechanics.
- Saved Clip Assets retain the complete editable composition and concrete source-version pins.
- A saved Clip can be placed elsewhere, opened, expanded and edited without mutating its source Project.
- Missing/ambiguous references are reported; data is never silently dropped or double-counted.
- Migration/round-trip/nested-render/editing tests, type-check and production build pass.

## Dependencies

DYS-002 migration/validation; DYS-005 shared timeline editing; DYS-013 existing Clip Asset slice.

See [Unified Composition Model](https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/architecture/UNIFIED_COMPOSITION_MODEL.md), [Issue #53](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/53), [Issue #54](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/54), and [Issue #59](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/59).
