# Dionysus Creative Editing Workflow — Product/UI Specification

**Status:** Proposed implementation baseline, 2026-10-17  
**Branch:** `feat/dys-011-multitrack-linked-audio`  
**Purpose:** Consolidate the user's six requirements into a coherent editor architecture before expanding implementation. This document records user requirements; it does not claim that the listed features already exist.

## Product model

Dionysus is a shot-based creative editor for AI-generated video. The core unit is a **Shot** on the master timeline. A shot is a compositional module, not necessarily one source file. It may contain one long source trimmed to the shot's duration, several subclips arranged/trimmed inside the shot, and/or procedural Three.js content. The master timeline displays the shot as one bounded block; opening the shot enters a nested editor for its internal modules.

## 1. Shot version selector

- A shot thumbnail has a version dropdown/chevron.
- Opening it shows available generated/source versions for that shot, with thumbnails and useful metadata.
- Selecting a version changes the shot's active source/version without losing the alternatives.
- Version selection must be undoable and saved in project JSON.
- If no real thumbnail exists yet, show a clear placeholder; do not imply source bytes or a generated preview exist when they do not.

## 2. Nested shot/module editing

- Master timeline: one shot = one block with explicit master start and duration.
- A shot can reference a single source clip longer than the shot; trim in/out points determine the visible segment.
- A shot can instead contain multiple submodules (video/image/audio/procedural modules) with their own timing, source references, trims, and relationships.
- Selecting “Edit shot” opens a nested timeline/editor for submodules. The interaction model should reuse the master timeline's clip editing patterns.
- Internal edits must not accidentally change master shot duration; any duration change must be explicit and show how it affects downstream timeline positions.
- Preserve the distinction between source duration, source in/out, module duration, shot duration, and master timeline duration.

## 3. Procedural / Three.js modules

- Three.js animation is a first-class procedural module type alongside imported media.
- A module stores script/scene version, parameters, duration, and permission/sandbox metadata.
- Script versions are pinned in saved project versions. Runtime errors are isolated to the module and surfaced clearly.
- Custom code execution must use explicit user authorization and a security boundary; never evaluate arbitrary imported code silently.
- The initial UI may provide a procedural-module placeholder/editor contract before the renderer is complete, but must not present unimplemented rendering as functional.

## 4. Video layers and compositing frame

- Timeline has ordered video/compositing layers and audio layers.
- Each video layer is a **frame/container** in the final composition; its clips provide content placed inside the frame.
- Frame properties include normalized position (x/y), width/height, fit mode (contain/cover/fill or equivalent), background color, border color/width, shape, and corner radius.
- These properties support picture-in-picture and layered compositions.
- Design the data model so frame properties can later be keyframed/animated (e.g. scale up or move left-to-right); animation UI/rendering may be a later phase.
- Clearly distinguish a layer's output frame geometry from the source media's own crop/trim.
- Preview and final render must eventually share the same compositing semantics.

## 5. AI asset provenance and regeneration

- When registering/importing an AI-generated clip as an asset, metadata can include prompt, model/provider, generation parameters, seed/reference assets when available, and source/version lineage.
- Selecting a shot/module exposes the active clip's prompt and model in an inspector.
- The UI should support copying/reusing prompt and generation settings for a future regeneration flow.
- Direct in-app generation is a future integration; until connected, show metadata and a clear “regeneration not connected” state rather than a fake action.
- Asset records must distinguish metadata from stored media bytes. Missing media/relink state must be visible.

## 6. Independent Reference and Storyboard workspace

- Reference/Storyboard is a separate planning workspace, not another timeline track.
- It supports story/scene/shot planning, reference images/profiles, shot order, descriptions, and intended visual continuity.
- A storyboard can generate a new timeline plan or update an existing timeline.
- Reconciliation must preview changes and preserve manual timeline edits unless the user explicitly accepts them.
- Each storyboard-to-timeline operation should be undoable and recorded in project history.
- Storyboard references should be snapshotted per generation/plan so later profile edits do not silently rewrite past provenance.

## Timeline UI direction

- Editor workspace: preview/composition stage, master timeline with visible track lanes, and a contextual inspector.
- Track lanes display clips as time-proportional blocks, with thumbnail/title, duration, selected state, link/version indicators, and trim handles where supported.
- Selecting a shot opens its version controls and metadata inspector. Entering the shot opens nested module timeline.
- Use direct manipulation for clip selection, moving, and trimming where feasible; keep numeric controls as an accessible alternative.
- On narrow screens, use horizontal timeline scrolling, compact track labels, and a collapsible inspector; preserve the same data model and capabilities.
- Storyboard/reference navigation is a distinct top-level workspace mode.

## Suggested implementation phases

1. **Spec + architecture alignment:** inspect existing schema and DYS-004/005/006/007/008/009 dependencies; identify migration-compatible data model changes.
2. **Visible master timeline:** replace metadata-only clip list with real lane geometry and selectable shot/clip blocks; retain tested linked-audio operations.
3. **Shot nesting + versions:** shot-level version selector, source in/out, nested submodule timeline.
4. **Layer frame/compositing model:** persistent frame geometry and fit/background/border/shape/radius properties; preview renderer integration tracked separately.
5. **Prompt/model provenance:** asset and version metadata inspector, import UX and regeneration-ready records.
6. **Storyboard workspace:** planning UI and safe plan-to-timeline reconciliation.
7. **Procedural modules:** secured Three.js module lifecycle, parameter UI, version pinning and runtime error isolation.
8. **Integration:** preview/playback, compositing, audio and export fidelity, with separate acceptance evidence.

## Acceptance principles

- Do not call metadata-only controls a full timeline editor.
- Every user-visible action must have observable state changes and Undo/Redo behavior where it changes the project.
- Round-trip project JSON must preserve shot/version/module/layer/reference/provenance relationships.
- No fake thumbnails, playback, rendering, AI generation, or export capabilities.
- Every phase must include automated tests and a real-browser walkthrough; keep PRs Draft until acceptance is complete.
- Preserve branch isolation: work on the feature branch/feature PR only; never push directly to `main` and never merge without explicit user instruction.

## Open implementation decisions (not blockers to start)

- Whether frame coordinates are normalized (0–1) or expressed as percentages: prefer normalized values internally.
- Whether a nested shot's internal timeline can exceed its declared duration: reject or clip overflow by default; require explicit duration extension.
- Whether storyboard updates overwrite or patch a timeline: default to previewed patch/reconciliation, never silent overwrite.
- Whether a clip's model is a free-form provider/model identifier: keep provider and model as strings plus optional structured parameters to avoid locking into one vendor.
