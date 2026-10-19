# DYS-014 Report — Unified Composition Model

**Status:** Initial typed Composition and non-mutating legacy projection implemented; import/export and live editor integration remain outstanding.

This planning slice records target ownership for Shot output versions, Media Assets, Compositions, Clip Asset Versions, Timeline Placements, Production Tasks and Generation Runs.

## Decisions recorded

- Master and nested Clip Asset timelines use one Editor and placement engine.
- Add Track is Video, Audio or Text at all composition depths.
- Saving a Project composition as a Clip Asset preserves track/placement structure and concrete version pins rather than flattening layers.
- Saved snapshots are independently editable; existing placements remain pinned.
- The current schema requires explicit non-destructive migration. Runtime behavior is not claimed to be migrated.

## Runtime slice

- Added `src/compositionModel.ts` for canonical track, placement, source-reference and composition contracts.
- Added `src/compositionMigration.ts` to project schema-1.0 root timeline and Clip Asset Versions while retaining the original project as a defensive copy.
- Added `src/compositionMigration.test.ts` for IDs/order, source ranges, linked audio, version pins, nested layers, duplicate Storyboard placement handling, missing sources, deterministic output and immutability.
- The adapter is not yet the persisted schema and is not wired into the live editors.

## Verification

Automated test/build status is pending the exact latest PR-head CI run. Do not treat the projection adapter as production migration until CI passes and import/export/editor integration is complete. Implementation acceptance requires migration, round-trip, snapshot independence, nested rendering, interaction, Undo/Redo, type-check and production-build coverage.
