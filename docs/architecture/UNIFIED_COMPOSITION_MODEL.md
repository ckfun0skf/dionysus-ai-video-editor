# Unified Composition Model and Production Workflow

**Status:** Architecture baseline for implementation · **Date:** 2026-10-18

## Executive summary

Dionysus should use one Composition model for the Project Master Timeline and nested Clip Assets. A completed Project timeline must be savable as a reusable Clip Asset that preserves its editable structure and can be opened and expanded with the same Editor.

Storyboard is the narrative/production plan. Production Tasks describe dependent generation work. Media Assets store outputs. Compositions arrange content. Timeline Placements locate sources in time.

## Editor workspace integration

The canonical Composition model is consumed by the new Timeline-first Editor workspace. UI layout and navigation are specified separately in [Timeline Editor Workspace Architecture](./TIMELINE_EDITOR_WORKSPACE.md). The UI must dispatch all edits through the shared command/state boundary: the workspace is not allowed to maintain parallel authoritative timeline arrays. Desktop places the Media/Audio/Text/Effects/Transitions browser upper-left, Preview/Canvas upper-right and multitrack timeline below. Mobile puts contextual element operations at the bottom and keeps global module navigation in the project/workspace menu.

## Product decisions

- **Shot:** narrative production identity with versions representing concrete generated shot-video outputs. A Shot is not a nested editing timeline.
- **Media Asset:** identity of an imported/generated source file plus metadata/provenance.
- **Composition:** editable ordered Tracks and Timeline Placements.
- **Clip Asset:** reusable, versioned Composition.
- **Master Timeline:** Project root Composition.
- **Shared Editor:** root and nested versions use the same UI components and placement/drag/drop/resize/snap/overlap/Undo operations. Context actions/settings can differ; editing mechanics must not.
- **Track kinds:** Video, Audio and Text at every composition depth. Image, video, Shot, Code/procedural and Clip identify content/source types, not top-level Track kinds.
- **Pinned versions:** new generations never silently replace sources already pinned in existing placements.
- **Manual-first production:** copy-prompt/import works before API integration; providers use adapters later.

## Domain model

### Project and root Composition

The Project owns settings, Storyboard, Media Assets, Clip Assets, Reference Sets, Production Tasks, Generation Runs and its root Master Composition. Root and nested Compositions use the same tracks/placements contract.

### Shot and Shot Version

A Shot stores narrative identity, target duration, prompt/camera/style instructions, required inputs/references, status and generated alternatives. A Shot Version represents one concrete generated video result (or visible pending/failed state) with output Asset and provenance where available. Selecting a newer version affects future assembly choices, not historical runs or existing pinned placements. Legacy Shot Slots and nested layers are migration concerns, not a second long-term composition model.

### Media Assets and Reference Sets

Assets represent actual files and their metadata. Reference Sets group assets by roles such as character identity/face/outfit, environment, prop, composition, lighting and style. Per-Shot/Task use may exclude or replace references without mutating shared defaults. Each Generation Run stores an immutable snapshot of the effective prompt and exact references used.

### Composition and Placement

A Composition contains ordered tracks and placements. A Placement records source identity/version, parent track, timeline start/duration, source in/out, transform/fit and placement-level audio settings. It does not mutate its source identity.

Visual Shot/video/image/Clip/procedural content uses Video Tracks; audio uses Audio Tracks; timed text uses Text Tracks. Track background/transparency must affect rendered output where applicable, not only lane styling. Nested Clip versions pin concrete versions and cycles are prohibited.

## One Editor for root and nested Compositions

The same Editor owns preview, ruler/playhead, track headers/lanes, clip blocks, source/version picker, Inspector, drag/drop preview, snapping, overlap policy, resize preview, adjacent-item trimming and Undo/Redo. It receives a composition context (Project root or a specific Clip Asset Version). Context may change title, save/version actions, output settings or read-only state, but never swaps in another placement implementation.

## Structure-preserving Project-to-Clip snapshot

Save-as-Clip creates a new independent Composition Version preserving:
- track definitions, kinds, order, background/transparency and relevant canvas properties;
- all placements, timing, source ranges, transforms, source references, mute/mix/fades and ordering;
- pinned Shot Versions and nested Clip Asset Versions;
- composition canvas/duration and stable relationships/ID mappings.

This is a structured snapshot, not an MP4 render, flattened layer list or live link to the source Project. Media bytes may be shared by Asset ID inside one Project; portable bundles must include or report dependencies. Editing the saved Clip creates a new Version and does not rewrite older versions or placements.

## Production Tasks and Generation Runs

A Production Task records goal/output kind, prompt/template, required inputs/assets/references, dependencies, status and intended Shot/Composition. A Generation Run records one attempt's effective prompt, provider/model/settings/seed where available, input-reference snapshot, timestamps, output and errors. Tasks form a validated directed acyclic graph. The Production Guide explains ready/blocked/completed/failed/manual-import-required states. Retries create new runs and preserve prior results.

## Settings scopes

- **Project output:** final resolution, ratio, frame rate and export settings.
- **Composition canvas:** dimensions, background/transparency and internal duration.
- **Track:** kind/order and track-wide settings.
- **Placement:** start/duration, source in/out, transform/fit, volume/fades and local overrides.
- **Shot generation target:** planned duration, prompt and constraints.

A placement trim does not change source intrinsic duration or Shot target duration.

## Schema migration

The current `schemaVersion: "1.0"` model uses root `timelineClips[]`, `Shot.slots[]`, `ClipVersion.layers[]` and materialized `storyboard-*` clips. This requires a deterministic non-destructive migration, not a blind rename.

Migration must preserve IDs, alternatives, prompts, generation/reference history, source ranges, audio links/mix, track order and nested references; reconcile storyboard-generated placements without duplicates; surface ambiguous/missing records; and pass JSON round-trip, snapshot independence, nested rendering, editing parity and Undo/Redo tests. Never overwrite the user's only project copy.

## Issue/task alignment

- #53: root/nested UI and interaction parity through shared components and operations.
- #54: common drop preview, snapping, overlap, resize/trim and Undo regardless of item origin.
- #56 / DYS-004: asset browser, reverse usage, safe deletion/replacement, dimensions and durable import/relinking.
- #58: independent navigation UX.
- #59: Project/Composition/Track/Placement settings scope, zoom and rendered backgrounds.
- DYS-002: migration/validation; DYS-005 and DYS-013: shared composition model; DYS-006/008/009/011: preview, audio, procedural, plan and export work on the shared model.

## Delivery slices

1. Lock target model and migration contract (this PR).
2. Define typed Composition/source/placement model and migration fixtures.
3. Move root and nested editor to a shared context plus compatibility adapter.
4. Implement structure-preserving save/open/edit of Project-to-Clip snapshots.
5. Implement manual-first Production Task DAG and Generation Run provenance.
6. Align Asset/Reference management and settings scopes.
7. Validate rendering, audio, procedural, Undo/Redo, portability and export.

## Acceptance

Root and nested compositions share a document schema and editing mechanics. Save-as-Clip retains structure and pinned versions. Saved Clips can be placed elsewhere, opened and expanded without mutating the source Project. Tasks/runs remain auditable. Migration/round-trip and regression tests, TypeScript and production build must pass. Do not add browser smoke tests unless explicitly requested.
