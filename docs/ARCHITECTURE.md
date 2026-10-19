# Dionysus Architecture

**Target contract:** [Unified Composition Model](./architecture/UNIFIED_COMPOSITION_MODEL.md). The current source model is not yet fully migrated.

## Principles

1. Local-first and static-hostable; no custom backend required for core authoring.
2. Separate narrative planning, generated media, editable Compositions, Timeline Placements and generation provenance.
3. One Composition contract and one Editor for Project root and nested Clip Asset versions.
4. Pin concrete source versions; never silently replace a pinned source.
5. Preserve structure in save-as-Clip; do not flatten tracks, placements or nested references.
6. Migrate schemas explicitly and non-destructively.
7. Keep AI-provider logic behind adapters; manual copy-prompt/import remains useful before API integration.
8. Never silently overwrite manual edits, historical versions or generation records.

## Domain boundaries

- **Project:** settings, Storyboard, Media Assets, Clip Assets, Reference Sets, Production Tasks, Generation Runs and root Master Composition.
- **Storyboard Shot:** narrative/production identity and generated video alternatives, not a nested editing timeline.
- **Shot Version:** concrete generated video result or visible pending/failed state with run provenance.
- **Media Asset:** identity/metadata for imported or generated source files.
- **Reference Set:** reusable role-labelled sources with per-use overrides and immutable generation snapshots.
- **Composition:** ordered Tracks and Timeline Placements.
- **Clip Asset:** reusable versioned Composition.
- **Placement:** source/version use in a parent Composition with track, time, trim, transform and mix state.
- **Production Task/Generation Run:** intended generation work and an auditable attempt.

## Shared Editor

Master and nested Compositions share preview, ruler/playhead, track headers, lanes, source picker, Inspector, drag/drop, snapping, overlap, resize/trim and Undo/Redo. Editor context changes actions/settings, not mechanics.

Add Track at every level is Video, Audio or Text. Image, video, Shot, Code/procedural and Clip are source/content kinds. Track background/transparency must affect rendered output where applicable.

## Structure-preserving snapshot

Saving the root Composition as a Clip Asset creates an independent editable Version preserving tracks, placements, order, timing/source ranges, transforms, pinned Shot/Clip versions, nested relationships and canvas settings. It is not an MP4 render, flattened layer list or live link. Media bytes may be shared inside a Project; portable packages must include or report dependencies.

## Production graph

Production Tasks specify output, prompt/template, inputs, dependencies and status. Generation Runs store effective prompt, provider settings, input snapshots, result and error details. Dependencies form a validated DAG. The manual-first workflow must work without APIs.

## Persistence and migration

Current code remains on schema `1.0` with `Shot.slots[]`, nested `ClipVersion.layers[]`, root `timelineClips[]`, and materialized `storyboard-*` placements. Migration must preserve IDs, versions, provenance, source ranges, audio state and nested references, avoid duplicated Storyboard placements, and report ambiguity. Do not default to the new schema until migration/round-trip tests pass.

## Current implementation boundary

Storyboard, Assets/References, project JSON import/export, nested Clip Assets, browser composition rendering and timeline features exist. Unified root/nested schema, dependency-aware Production Tasks and structure-preserving Project-to-Clip snapshots remain target work.

## Validation

Use unit/integration tests for placement, pinning, dependencies, provenance, migration and snapshots; run `npm test` and `npm run build`. No automated browser smoke tests unless explicitly requested. Verify CI on exact PR head and Pages separately when in scope.
