# DYS-014 — Unified Composition Model and structure-preserving snapshots

**Status:** In progress · **Progress estimate:** 68% · **Updated:** 2026-10-19

## Goal

Use one Composition document contract and one Editor for the Project Master Timeline and nested Clip Asset Versions. Saving a completed Project timeline as a Clip Asset must preserve its editable structure.

## Implemented transition slices

- Added typed canonical Composition, Track, Placement and source-reference definitions in `src/compositionModel.ts`.
- Added `migrateLegacyProjectToComposition()` in `src/compositionMigration.ts`. It projects the root timeline and each Clip Asset Version, keeps the original schema-1.0 project as a defensive copy, preserves legacy placement fields, and reports duplicate materialized Storyboard placements, missing sources and unsupported track kinds.
- Added `src/compositionMigration.test.ts` for stable IDs/order, source ranges, linked audio, Shot Slot and Clip Version pins, nested layer conversion, duplicate detection, missing-source warnings, deterministic output and source immutability.
- Added nested track normalization and track-aware add/move operations in `src/clipVersionTracks.ts`; nested timeline UI renders Video/Audio/Text track rows with multiple placements per track. Add layer creates a track; Add content adds a placement.
- Added `src/projectDocument.ts` versioned import/export boundary. New project files use the `dionysus-project-document` 2.0 envelope containing the authoritative schema-1.0 project and canonical Composition projection. Existing schema-1.0 files remain importable.
- Shared Master Shot/ordinary placement move, drop and resize logic is in `src/projectTimelinePlacement.ts`; cross-model resize trims are atomic.
- Consolidated head `2763f3b0a98823ef5d59a3760486adb302cc31d` passed CI [39218891285](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39218891285): tests, TypeScript and Vite build.
- Important limit: the envelope is a compatibility bridge, not canonical-only persistence. The live editor still treats the schema-1.0 payload as authoritative; Project-to-Clip structural snapshots remain unimplemented.

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
- [x] Define typed Composition documents, source references, placements and version pinning.
- [x] Add deterministic non-mutating projection from schema 1.0 Shot Slots, nested layers and `storyboard-*` placements.
- [ ] Move root and nested editors to shared composition context and placement operations.
- [ ] Implement structure-preserving save/open/edit of Project-to-Clip snapshots.
- [ ] Prove source/snapshot independence and new-Version editing.
- [ ] Complete canonical-only JSON round-trip, nested render, editing parity and Undo/Redo.

## Acceptance

- Root and nested Clip Versions use the same track/placement schema and shared editing mechanics.
- Saved Clip Assets retain the complete editable composition and concrete source-version pins.
- A saved Clip can be placed elsewhere, opened, expanded and edited without mutating its source Project.
- Missing/ambiguous references are reported; data is never silently dropped or double-counted.
- Migration/round-trip/nested-render/editing tests, type-check and production build pass.

## Dependencies

DYS-002 migration/validation; DYS-005 shared timeline editing; DYS-013 existing Clip Asset slice.

See [Unified Composition Model](https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/architecture/UNIFIED_COMPOSITION_MODEL.md), [Issue #53](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/53), [Issue #54](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/54), and [Issue #59](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/59).


## Migration alternatives, provenance and JSON round-trip — 2026-10-19

Current feature branch `feat/dys014-alternative-provenance-roundtrip` adds two focused regression tests:

- Migration projects every legacy Shot Slot Version as a distinct Composition projection, keeps the selected alternative marker, and preserves the generation prompt, reference snapshot, model/version, output asset, script version IDs and layer-level prompt/model metadata. It also asserts that projection does not mutate the source project.
- The document-boundary test serializes and imports a legacy schema-1.0 project and a versioned 2.0 compatibility envelope, asserting that alternate versions, selection and generation provenance survive both JSON round-trips.

The previous mobile feature is shipped as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`; exact-head CI [39259760793](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259760793), main CI [39259981315](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981315) and Pages deployment [39259981194](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981194) passed.

The migration test branch still requires exact-head CI. These tests strengthen the non-destructive transition boundary; they do **not** make Composition authoritative persistence or implement structure-preserving Save-as-Clip.


## Save-as-Clip integration — 2026-10-19

- The Master Timeline Save as Clip Asset action now calls `createCompositionSnapshot()` rather than flattening render layers.
- `ClipVersion.compositionDocument` stores the canonical Composition snapshot; compatibility tracks/layers are projected for the existing editor.
- Regression tests cover canonical track/placement structure, linked audio, source ranges, nested Clip version pins and snapshot independence.
- **Still incomplete:** edits in the legacy layer/track editor do not reconcile back into `compositionDocument`. Canonical-authoritative editing, persistence round-trip and Undo/Redo parity remain required.
