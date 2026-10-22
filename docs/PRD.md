# Dionysus Product Requirements Document

**Version:** 0.2  
**Status:** Target requirements for the unified Composition / production workflow update

Architecture contract: [Unified Composition Model](./architecture/UNIFIED_COMPOSITION_MODEL.md)

## Product vision
Dionysus is a local-first planning and composition editor for AI-assisted video projects. It organizes story intent, timeline clips, nested versions, assets, reference provenance, and AI-executable plans. Built-in generative models are not required.

## Confirmed 2026-10-19 — Timeline-first product and workspace

Timeline Editor is the first complete authoring workspace. The Editor itself includes an upper-left source/tool browser for Media, Audio, Text, Effects and Transitions; an upper-right preview/canvas; and a multitrack timeline below. Users must be able to open and edit a timeline without first creating a Storyboard or configuring References.

On mobile, the Editor's bottom action strip is contextual: it exposes operations for the selected clip/layer or for the timeline when nothing is selected. Global module switching (Storyboard, Timeline Editor, full Assets management, References and future Production workflows) stays in the project/workspace header or menu. Do not use the mobile Editor's bottom action strip as permanent four-module navigation.

The rebuild is a workspace/state-boundary redesign, not a data wipe. Preserve schema-1.0 project import, tested domain logic and version/provenance data through a canonical Editor command boundary. Storyboard and Reference planning tools are integrated after the core Editor/source contract is stable. The detailed layout contract is in [Timeline Editor Workspace Architecture](./architecture/TIMELINE_EDITOR_WORKSPACE.md); execution order is in [Timeline-First Editor Rebuild Plan](./TIMELINE_EDITOR_REBUILD_PLAN.md).

## Confirmed decisions
- Storyboard order is narrative planning, not timeline time. Building/updating Timeline is explicit; Storyboard and existing placements can then be edited independently.
- A Shot is a narrative production unit whose versions are concrete generated shot-video outputs. The current Slot-based Shot composition is legacy schema to migrate, not the target.
- Slot duration is fixed by default; users may explicitly choose auto-extend or ripple behavior.
- Slots have multiple Versions; regeneration creates a new Version by default.
- Data supports recursive nested compositions; first-version UI limits nesting depth.
- Master Timeline is the Project root Composition. Root and nested Clip Asset Versions use one Editor; a Shot Version is a generated video output, not a nested editing timeline.
- Master Timeline shows multiple visible, ordered layers below the preview: video/compositing, text/title, audio, and procedural Three.js. A generic “Media track” is not part of the user-facing Timeline; Media is an asset-library concept.
- A Timeline Placement may reference a concrete Shot Version or pinned Clip Asset Version. New Shot output versions do not silently replace versions already pinned in placements.
- Video layers can expand to show attached source audio as a child lane. Unlinking turns that audio into an independent Audio Layer, and each Audio Layer has independent persistent mute state.
- Prompts belong to Shot/story intent, Production Tasks/templates, and individual Generation Runs; each run preserves the effective prompt and input-reference snapshot.
- Script versions are pinned by saved Versions.
- Reference groups and Character/Entity Profiles provide reusable defaults; each Shot can inherit, exclude, replace, or add references.
- Each generation stores a snapshot of its actual prompt and references when available.
- Undo/redo history should persist across save/reopen.
- Audio target includes multitrack mixing and advanced effects.
- Preview targets 4K with adaptive degradation where necessary.
- Browser MP4 export is a future goal; first-release inclusion is undecided.
- Project folder and ZIP portability are required goals.
- Core workflow should not require a custom backend.

## Functional requirements
### Project management
Create, open, save, import, and export projects. Preserve structure, relative asset references, schema version, and timestamps. Warn about missing media and unsupported data.

### Storyboard
Create, order, and edit Shots. Store title, intent, target duration, status, profile references, and placeholder state. Storyboard can generate an initial Timeline; subsequent edits are independent. Re-generation must not silently overwrite manual Timeline changes.

### Master Composition, Timeline Placements, and Versions

The Project Master Timeline is the root Composition: ordered tracks and placements referencing concrete Shot Versions, Media Assets, text/procedural content or pinned Clip Asset Versions. A placement owns timeline start/duration, source in/out, transform and placement-level audio state; it does not mutate its source. Root and nested Compositions use the same editing mechanics. Add Track offers Video, Audio and Text only.

Saving the Master Composition as a Clip Asset creates an independent, structure-preserving snapshot with tracks, placements, ordering, source ranges, canvas settings and pinned versions. It is not an MP4 render or flattened layer list. Existing placements stay pinned when source versions change.

A Shot Version identifies a concrete generated video result or an explicit pending/failed state and preserves prompt/run provenance. It is not an arbitrary nested editing timeline. A Clip Asset Version contains a Composition: ordered tracks and placements that may reference Shot Versions, Media Assets, text, authorized procedural content and pinned nested Clip Asset Versions. Cycles are prohibited. Editing/saving creates a new Clip Version; it must not mutate the source Project or historical versions.

### Assets and Reference Provenance
Assets are reusable and distinct from their usage configuration. Reference Groups are reusable collections. Character/Entity Profiles provide default references by role. Shot-level overrides support inherit, exclude, replace, and add without mutating Profiles. A Generation Record preserves the actual references and prompt used at generation time; later profile changes cannot rewrite old records. Record model/version/parameters only when available. Missing assets must be detectable and relinkable.

Reference roles include identity, face, body, outfit, pose, composition, lighting, environment, style, and other. A Shot may use several profiles simultaneously.

### Prompt management
Maintain Shot intent, Version description, and individual generation prompts. Prompt edits do not alter old generation records. Execution plans preserve all prompt levels.

### Layers, audio, text, effects
Master and Version timelines support ordered video/compositing frames, image/video content, timed text, audio layers, and procedural JavaScript/Three.js modules. Video source audio is shown as an expandable child lane while linked; Unlink detaches it as an independent Audio Layer without changing current timing. Each Audio Layer has independent persistent mute/unmute. Linked/unlinked relationships and mute state must survive Undo/Redo and project JSON round-trips. Audio direction includes multitrack mixing, trim, volume, fades, sync, automation, ducking, and advanced effects; exact first-release effect list is TBD. Three.js is a first-class procedural layer with script identity/version pinning, explicit execution authorization, and isolated errors.

### Preview
Provide Master Timeline, Shot, Slot, and Version preview. Aim for final-composite fidelity, audio synchronization, placeholders for missing assets, and 4K capability where hardware/browser permit. Adaptive quality is acceptable and limitations should be visible.

### Procedural modules
Allow custom JavaScript/Three.js modules as timeline layers. Pin script versions in saved Versions. Isolate errors and distinguish ordinary effects from higher-permission user-authorized code. Browser security boundaries still apply.

### History
Provide Undo/Redo and distinguish edit history, Version history, and Generation history. Preserve history across reopen as far as practical. Avoid duplicating large media files for each edit. Retention and capacity policy is TBD.

### Portability
Support project folders, ZIP bundles, integrity validation, missing-media relinking, schema migration, and optional inclusion of history, versions, fonts, and dependencies. Exact bundle presets are TBD.

### AI Execution Plan
Export a versioned structured plan containing Shots, slots, timings, versions, layers, prompts, reference requirements, generation tasks, dependencies, and placeholders. Support validating and reconciling an edited plan imported from external AI tools.

### Browser MP4 export
Future target. Must define fidelity, codecs, progress, cancellation, error recovery, frame rate, and memory constraints. First-release inclusion is undecided.

## Non-functional requirements
- Static-hosting compatible; no custom backend required for core workflow.
- Local-first editing and persistence.
- Data integrity and recoverability.
- Portable project packages.
- Extensible schema and AI-readable interchange format.
- Secure handling of custom code.
- Adaptive rendering and measurable performance targets.
- Supported browser matrix and fallback behavior to be defined.

## Known conflicts / risks
1. Storyboard re-generation vs manually edited Timeline: require previewed diffs and explicit merge policy.
2. Recursive nesting vs performance: cap UI depth and prohibit cycles.
3. Advanced audio vs browser performance: define which effects preview live and which may be processed separately.
4. 4K preview vs device limits: adaptive quality and explicit performance targets.
5. Browser file access and MP4 encoding vary by browser; evaluate independently without assuming a backend.
6. Custom scripts vs security: permissions, isolation, and error handling required.
7. Persistent history vs large media: history metadata/diffs must not duplicate media unnecessarily.
8. Shared Assets vs immutable Version state: separate asset identity from usage settings and generation snapshots.

## Open decisions
- Policy for regenerating Timeline from an edited Storyboard.
- Maximum UI nesting depth.
- Default aspect ratio, resolution, frame rate, and time precision; mixed frame rates.
- Whether first release includes any final MP4 export.
- Profile update behavior for existing Shots and reference override preview.
- History retention/capacity policy.
- Whether project bundles include all historical versions and media by default.
- Advanced audio effects list; built-in transitions/effects.
- Reference weights and model-specific limitations.
- Fonts, external resources, and dependency packaging.
- AI plan format and merge semantics.
- Exact script permissions and sandbox implementation boundaries.
- Performance acceptance criteria and target project scale.
- Autosave/recovery behavior and timeline editing shortcuts.

## Initial milestone
The initial milestone established the local-first shell, Storyboard editing, local persistence, project JSON import/export, and AI plan export. The supplied Timeline prototype now reprioritizes visible typed layers, Master/Version timeline tabs, per-Shot Version dropdown actions, hierarchical linked audio, per-layer mute, and a first-class Three.js layer as core editor requirements. Advanced audio effects, portable media bundles, and reliable final MP4 rendering remain staged follow-up work.


## Architecture transition addendum (2026-10-18)

The target contract supersedes incompatible earlier Shot-Slot-centric requirements. The current schema remains legacy and must be migrated safely, not changed with a blind field rename.

- Production Tasks are first-class dependency-aware records; Generation Runs are immutable per-attempt provenance.
- Storyboard order is separate from timeline positions. Build/update previews a diff and preserves manual edits by default.
- Settings scopes are distinct: Project output, Composition canvas, Track, Placement and Shot generation target.
- Migration preserves IDs, alternatives, generation/reference history, source ranges, linked audio and storyboard-generated placements; ambiguous cases are surfaced.
- Requirements in #53/#54, #56, #58 and #59 remain valid. See [Unified Composition Model](./architecture/UNIFIED_COMPOSITION_MODEL.md).


## Mobile editing experience

Dionysus must support a responsive phone workflow, not merely scale down the desktop editor. Use CapCut as a usability reference for information hierarchy and touch ergonomics, while retaining Dionysus's multi-track, reusable-composition and AI-production capabilities.

- On phones, keep the preview above the timeline and make playback/selection controls touch-friendly.
- Keep application-module navigation reachable from the project/workspace header or menu; do not use the Editor's bottom action strip as persistent Storyboard / Timeline / Assets / References navigation. Respect device safe-area insets.
- Keep horizontal timeline scrolling inside the timeline surface rather than allowing the whole page to overflow. Track labels should remain identifiable while the timeline is panned.
- Reveal context-specific editing controls when content is selected; dense property editing should use a focused panel or sheet instead of permanently consuming preview width.
- Desktop and mobile edit the same project and version data. Responsive presentation must not fork the project schema or silently change edit semantics.
- Treat mobile browser support as the first delivery target. A separate native application is not implied by this requirement.
- DYS-012 remains in progress until touch selection/scrubbing/version controls, narrow portrait/landscape layouts, and no-page-overflow behavior are validated. Automated browser smoke tests are not part of this project workflow; do not add or run them unless the owner explicitly asks.


## Linked source audio contract

**Owner-confirmed product decision (2026-10-22):** Linked source audio is a child placement owned by its Video Layer / video placement relationship, not a standalone Audio Track. Do not automatically create an empty Audio Track when inserting a video.

- When a video placement is inserted, create a linked audio child only when the source actually contains audio. Keep its timing/source range synchronized with the parent video through ordinary move, trim, split, duplicate and delete operations.
- Multiple video clips may coexist on one Video Layer. Each clip's linked audio is independently addressable and can be muted (and eventually have per-clip volume); the Video Layer also provides a parent-level mute for all linked source audio in that layer.
- Linked audio is not directly draggable to another track and has no ordinary Unlink/Relink toggle. This avoids ambiguous ownership and accidental track creation/deletion.
- **Extract Audio** creates an independent Audio placement on a real Audio Track and transfers ownership so the same source audio does not play twice. **Duplicate Audio** is a separate explicit operation that preserves the linked original and creates an independent copy; warn/avoid accidental doubled playback.
- Independent Audio Tracks are created intentionally by the user or by Extract Audio, not as a side effect of inserting a video.
- Removing a Video Layer/clip must follow explicit delete semantics for its linked child; removing an unrelated Audio Track must never delete linked source audio. Undo/Redo, save/reopen and project JSON round-trip preserve links, mute state, source ranges and extracted/duplicated relationships.
- Acceptance tests cover videos with audio and without audio, multiple clips in one Video Layer, per-clip mute, parent-layer mute, extract, duplicate, split/trim/move/delete, and round-trip/Undo/Redo.

This contract supersedes earlier PRD wording that described Unlink as converting linked audio into an independent Audio Layer. The current implementation may not yet satisfy this target; do not claim implementation complete until code and tests match it.
