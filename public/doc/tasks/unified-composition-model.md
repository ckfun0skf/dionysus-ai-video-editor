# DYS-014 — Unified Composition Model and structure-preserving snapshots

**Status:** In progress · **Progress estimate:** 76% · **Updated:** 2026-10-20

## Strategic UI direction (2026-10-19)

The owner selected a Timeline-first Editor workspace rebuild. The Composition model remains the shared state/operation contract; UI design is specified in [Timeline Editor Workspace Architecture](../../../docs/architecture/TIMELINE_EDITOR_WORKSPACE.md), with execution order in [Timeline-First Editor Rebuild Plan](../../../docs/TIMELINE_EDITOR_REBUILD_PLAN.md). Rebuild the workspace without making the canonical projection and legacy arrays competing sources of truth. PR #89 is a draft candidate whose observed exact-head TypeScript/build check failed; recheck before integrating it.

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


## Structure-preserving Save-as-Clip foundation — 2026-10-20

The Master Timeline Save-as-Clip action now delegates to `src/clipVersionSnapshot.ts`. A saved Clip Version contains:

- A canonical root Composition document with tracks, ordered placements, source references and source ranges.
- Recursively embedded Composition documents for exact nested Clip Asset Version references and the selected Shot Slot Versions, rather than relying only on the current flattened render layer list.
- `CompositionDocument.provenance` with source project/composition identity, source update time, snapshot creation time, and pinned asset/clip-version or shot/slot/version tuples.
- Original transform/mix/source metadata in placement legacy data, plus selected-version script IDs and generation records.
- A compatibility `layers` projection so the current preview/rendering path continues to work while editor migration proceeds.

Regression tests cover source immutability, track/order/source-range/transform/mix preservation, nested composition structure, pinned versions, provenance, JSON serialization/reload and isolation from subsequent mutation of the source nested version. Code/test SHA `30afa93ea6ff9f6086229b4fd7bd9daba6a02796` passed exact-head CI [39425783751](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39425783751): 219 tests across 23 files, TypeScript and production build.

**Not complete:** the current nested editor still primarily edits the compatibility `layers` list. The canonical tree is persisted in the snapshot but is not yet the sole editable source of truth across every nested edit path. Next work must add canonical placement/editor adapters, synchronize the render projection, and prove edit → save → reopen parity plus source-version pin immutability. Keep DYS-014 in progress; do not merge on the strength of snapshot serialization tests alone.


## Canonical nested editor synchronization — 2026-10-20

When a Clip Version already has a canonical Composition document, `normalizeClipVersionTracks()` now derives the compatibility layer and track lists from that document. Nested insert, move, resize/adjacent trim, delete, track creation, duration changes and inspector edits update the canonical document first and refresh the legacy projections. Transform-only edits preserve typed source references; intentional source changes update them. Nested composition children and provenance survive immutable placement updates.

Exact-head CI [39428872953](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39428872953) passed at code SHA `c82f305726afaacb424d9bf8e39c0fac37de5fc4`: 222 tests across 23 files, TypeScript, production build and dependency audit with 0 reported vulnerabilities.

**Still open:** a full Save-as-Clip → nested edit → JSON save/reload → reopen test; canonical Undo/Redo parity; immutable source-version pin behavior; and schema-1.0/legacy Shot Slot migration review. This adapter reduces the dual-write gap but does not by itself prove all app persistence/history paths are canonical-authoritative. Keep DYS-014 in progress.


## Save-as-Clip edit/reopen round-trip regression — 2026-10-20

A regression now exercises the path: create a structure-preserving Master Timeline snapshot, edit a nested placement through the canonical adapter, serialize/reload project JSON, then reopen the Clip Version from its canonical Composition document. It asserts the edited placement timing/transform/mix, source ranges, nested child Composition and version provenance remain intact, and the source Clip Asset Version is not mutated.

Exact-head CI [39429740312](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39429740312) passed at code/test SHA `7098229556fd466283a2e815de2ab44778089483`: 223 tests/23 files, TypeScript/build and dependency audit (0 vulnerabilities).

Still open: canonical nested Undo/Redo, broader pin immutability across every edit route, and deterministic migration/legacy Shot Slot compatibility review. Keep DYS-014 in progress.


## Source-reference preservation follow-up — 2026-10-20

The UI inspector now passes only the actual changed fields to the canonical nested adapter, not a fully reconstructed layer object. This prevents unrelated transform/mix/timing edits from accidentally reclassifying the canonical source reference. Source-related fields intentionally trigger source-reference reconstruction; duration edits also preserve fade clamping.

Exact-head CI [39430375517](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39430375517) passed at code SHA `47b700ea44937dbb8bfb6c35fbcf9efe690d4416`: 223 tests/23 files, TypeScript/build and dependency audit (0 vulnerabilities). Re-run exact-head CI after the final task-doc update.


## Canonical nested Timeline editing — 2026-10-20

`src/clipVersionTracks.ts` now treats an existing `ClipVersion.composition` as the editing source of truth. Normalization derives compatibility tracks/layers from the canonical document; nested add/delete/move/resize, track creation and inspector patches update canonical placements/tracks and refresh the projections. Inspector patches preserve typed Shot Slot/script source references on unrelated edits, and synchronize source ranges, transforms, mix/fades and legacy metadata.

Regression coverage includes stale compatibility projections, nested Composition/provenance preservation, source-reference preservation, track/placement synchronization, Save-as-Clip → edit → JSON save/reload → reopen, and source-version mutation isolation. Exact-head CI [39431744433](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39431744433) passed at `bbbbf18743a66de4ba66c14b9cde98bd9d490238`: 223 tests across 23 files, TypeScript/build and dependency audit 0 vulnerabilities.

Remaining: explicit nested Undo/Redo coverage, broader pinned-version/migration checks, and audit older Storyboard/Shot Slot handlers that directly mutate legacy `layers`. DYS-014 stays in progress. No browser smoke tests; documentation update requires a new exact-head CI run.
