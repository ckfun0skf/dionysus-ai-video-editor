# DYS-014 Report — Unified Composition Model and structure-preserving snapshots

**Status:** In progress; transition slices implemented, canonical-only persistence and structural snapshots outstanding.  
**Updated:** 2026-10-19  
**Validated consolidated code head:** `2763f3b0a98823ef5d59a3760486adb302cc31d2`

## Implemented

- Typed Composition, Track, Placement and source-reference contracts plus a non-mutating projection of the legacy schema-1.0 project.
- Regression coverage for deterministic projection, ordering, source ranges, linked audio, pinned Shot/Clip versions, duplicate materialized Storyboard placements, missing sources and source immutability.
- Project-level shared placement operations for Master Shots and ordinary clips, including mixed-model drop occupancy and atomic cross-model resize trims.
- Nested Clip Timelines render Video/Audio/Text track rows with multiple placements per track; track-aware add and compatible move operations are tested.
- Versioned project import/export envelope (document version 2.0) stores the authoritative schema-1.0 project alongside the canonical Composition projection and continues to accept legacy schema-1.0 files.

## Validation

CI [#39218891285](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39218891285) passed tests, TypeScript check and Vite production build. No browser smoke tests were added or run.

## Remaining

- The canonical projection is not yet the authoritative editor/persistence model.
- Root and nested editors still use legacy project state paths; issues #53/#54 remain open until full parity and user acceptance.
- Project-to-Clip Save-as-Clip structural snapshots, cycle/dependency portability checks, and source/snapshot independence are not implemented.
- Next: design and test canonical-to-editable round trips; migrate editor state without silently rewriting user edits or pinned versions; then implement structure-preserving snapshots.


## Migration alternatives, provenance and JSON round-trip — 2026-10-19

Current feature branch `feat/dys014-alternative-provenance-roundtrip` adds two focused regression tests:

- Migration projects every legacy Shot Slot Version as a distinct Composition projection, keeps the selected alternative marker, and preserves the generation prompt, reference snapshot, model/version, output asset, script version IDs and layer-level prompt/model metadata. It also asserts that projection does not mutate the source project.
- The document-boundary test serializes and imports a legacy schema-1.0 project and a versioned 2.0 compatibility envelope, asserting that alternate versions, selection and generation provenance survive both JSON round-trips.

The previous mobile feature is shipped as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`; exact-head CI [39259760793](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259760793), main CI [39259981315](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981315) and Pages deployment [39259981194](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981194) passed.

The migration test branch still requires exact-head CI. These tests strengthen the non-destructive transition boundary; they do **not** make Composition authoritative persistence or implement structure-preserving Save-as-Clip.


## Canonical-first root mutation audit — 2026-10-20

- Root timeline insertion, conflict ripple/trim, move/drop and Master Shot Ripple Reorder now use live Composition placements as the source of timing and occupancy. Ripple moves linked groups together and preserves source ranges.
- Root clip metadata/source edits, preview transforms, mute/unlink, split/duplicate/delete, media import and track add/update/remove route through Composition commands first. The schema-1.0 project is derived compatibility data; domain reconciliation no longer overwrites existing canonical geometry/source/link fields from a stale migration.
- Track removal guards the last video track, requires a fallback for Master Shots, preserves video when removing only a linked audio child track, and catches invalid operations in the UI.
- Validated v2 import/recovery restores the saved canonical root when its compatibility projection matches; v2 tracks are not normalized a second time through the legacy migration path. Schema-1.0 imports remain supported.
- Tests cover stale legacy timing vs canonical occupancy, insertion/ripple/trim source-range preservation, Master Shot ripple reorder, track removal edge cases, canonical import, and App persistence/Undo/Redo.
- Exact-head CI must be checked on the final docs/code SHA. DYS-005/DYS-014 remain in progress pending green CI and remaining compatibility-only path review. No browser smoke tests; PR #96 remains Draft/unmerged.
