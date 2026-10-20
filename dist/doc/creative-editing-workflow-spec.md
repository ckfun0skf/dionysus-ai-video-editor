# Dionysus Creative Editing Workflow Specification

**Status:** Target architecture/UI contract · **Updated:** 2026-10-18  
**Architecture:** [Unified Composition Model](https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/architecture/UNIFIED_COMPOSITION_MODEL.md)

A feature is not implemented merely because a type or visual placeholder exists.

## 1. Product model

- **Storyboard Shot:** narrative/production identity, planned duration, generation requirements/references and generated alternatives.
- **Shot Version:** concrete generated shot-video output or visible pending/failed state.
- **Media Asset:** imported/generated source media and metadata.
- **Composition:** editable ordered Tracks and Timeline Placements.
- **Clip Asset:** reusable, versioned Composition.
- **Project Master Timeline:** the root Composition.
- **Production Task / Generation Run:** desired output and each actual attempt with immutable provenance.

Storyboard order is not timeline time. A Shot is not a special Timeline item with its own editing path. Root and nested Clip Asset Versions use the same Composition Editor.

## 2. Shared Composition Editor

Master and nested Composition timelines share preview/playhead, ruler, track headers/lanes, source/version picker, clip blocks, Inspector, drag/drop destination preview, snapping, overlap policy, resize preview, adjacent trim and Undo/Redo. Editor context (Project root or concrete Clip Asset Version) can change title/settings/save commands but not placement mechanics.

## 3. Tracks and content types

Add Track at every composition depth offers only **Video Track**, **Audio Track** and **Text Track**. Video tracks accept generated Shot Versions, video/image assets, nested Clip Asset Versions and authorized Code/procedural visuals. Audio sources use Audio tracks; timed text uses Text tracks. Image, Code, Shot and Clip are source/content types, not extra top-level Track kinds. Track background/transparency must affect rendered output, not merely lane styling.

## 4. Timeline Placement behavior

Every Placement has a stable source reference, pinned version where applicable, parent track, start/duration, source in/out, transform/fit and placement-level audio properties.

- Dragging uses one destination/snap calculation regardless of source.
- Compatible cross-Video-Track movement is supported; invalid targets are visibly rejected.
- Snap guides reflect the position actually committed on drop.
- Same-track overlap checks include every compatible placement, including Storyboard-generated items.
- Resize preview shows prospective overlap/trim. If adjacent content is trimmed, resize and trim commit as one Undoable command.
- No code path differentiates a Master Shot from an ordinary Placement for snapping/overlap/resize.
- Unlinking source audio preserves current timing and makes it independently editable.
- Undo/Redo restores all affected placements and source-audio relationships.

## 5. Storyboard and Timeline assembly

Storyboard nodes represent narrative order/connections, not timeline positions. Shot cards show story intent, target duration, requirements/references, chosen output, versions and production state.

"Build Timeline from Storyboard" explicitly creates ordinary placements from chosen Shot Versions and story order. Later Storyboard edits do not silently move/trim placements; Timeline edits do not rewrite story intent, order, target generation duration or past Generation Runs. Updates preview a diff and preserve manual edits by default. Build/update is undoable.

## 6. Versions and nested Clip Assets

A Shot Version identifies a concrete generated video and run provenance. Every Placement pins a concrete Shot or Clip version where applicable. New generations do not silently replace sources already used.

Clip Asset Versions store a Composition document (tracks plus placements), not only a flat layer array. Nested Clip Versions pin concrete versions; cycles are prevented and UI depth is bounded. Opening a Clip Asset opens its internals in the same Editor. Editing a saved snapshot creates a new Clip Version without mutating its source Project or prior versions.

## 7. Structure-preserving Project snapshot

Save-as-Clip creates an independent Clip Asset Version preserving track definitions/order/kinds/background, every placement and its timing/source ranges/transforms/audio properties, concrete Shot/Clip pins, nested relationships and canvas settings.

It is not an MP4 render, flat layer list or live link. Media bytes can be shared inside the same Project; portable export must include or report dependencies. Missing sources must produce a recoverable error, not silent content loss.

## 8. Assets and Reference Sets

Asset Library provides searchable/filterable cards, Settings, Edit Timeline for Clip Assets, confirmed Delete and dependency-impact preview. Reverse usage lists references from Shot Versions, Production Tasks, Reference Sets, Compositions and Placements. Reference Sets group role-labelled assets; Shot/Task use can inherit, exclude or replace a reference without mutating shared defaults. Delete/replace previews dependants and deterministically repairs/removes references. Media storage, missing-source/relink and thumbnail states are explicit. Each Generation Run preserves the effective prompt and exact input references.

## 9. Production Guide

Production Guide is task-driven rather than a list of Shots with a Ready checkbox. Each task explains expected output, effective prompt, prerequisites, exact assets/references to attach, where to put the result, and how to finish/retry/import it.

Tasks form a validated dependency DAG and show ready, blocked, completed, failed or manual-import-required states. Copy Prompt and manual import work before providers are configured. Provider adapters can execute the same task later; retries never overwrite old runs/results.

## 10. Settings scopes

- **Project output:** resolution, aspect ratio, frame rate, export.
- **Composition canvas:** width/height, background/transparency and internal duration.
- **Track:** kind/order and track-wide settings.
- **Placement:** start/duration, source range, transform/fit, volume/fades and local overrides.
- **Shot generation target:** planned duration, prompt and generation constraints.

Placement trim does not change source intrinsic duration or Shot target duration. Parent canvas and Project output may differ; fit/crop rules must be explicit.

## 11. Migration and regression

Current data includes root `timelineClips[]`, `Shot.slots[]`, nested `ClipVersion.layers[]`, and materialized `storyboard-*` clips. Migration must be deterministic, versioned and non-destructive, preserve valid IDs/history/audio/source ranges, and surface ambiguity/missing sources.

Tests cover migration/round-trip, alternatives/provenance, no duplicate storyboard placements, track ordering/audio links/mix, snapshot independence, nested render, root/nested interaction parity, snap/overlap preview/adjacent trim and one-step Undo/Redo. Do not add automated browser smoke tests unless explicitly requested; CI does not replace live user acceptance.
