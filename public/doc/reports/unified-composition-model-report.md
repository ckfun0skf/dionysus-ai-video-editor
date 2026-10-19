# DYS-014 Report — Unified Composition Model

**Status:** Architecture contract documented; runtime migration not implemented.

This planning slice records target ownership for Shot output versions, Media Assets, Compositions, Clip Asset Versions, Timeline Placements, Production Tasks and Generation Runs.

## Decisions recorded

- Master and nested Clip Asset timelines use one Editor and placement engine.
- Add Track is Video, Audio or Text at all composition depths.
- Saving a Project composition as a Clip Asset preserves track/placement structure and concrete version pins rather than flattening layers.
- Saved snapshots are independently editable; existing placements remain pinned.
- The current schema requires explicit non-destructive migration. Runtime behavior is not claimed to be migrated.

## Verification

Documentation and task tracking only in this slice. No runtime code changed and no automated tests/build were run for this planning PR. Implementation acceptance requires migration, round-trip, snapshot independence, nested rendering, interaction, Undo/Redo, type-check and production-build coverage.
