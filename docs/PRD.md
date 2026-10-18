# Dionysus Product Requirements Document

**Version:** 0.2  
**Status:** Requirements baseline; implementation in progress

## Product vision
Dionysus is a local-first planning and composition editor for AI-assisted video projects. It organizes story intent, timeline clips, nested versions, assets, reference provenance, and AI-executable plans. Built-in generative models are not required.

## Confirmed decisions
- Storyboard can generate an initial Timeline; both can then be edited independently.
- A Shot can contain multiple Clip Slots; Assets can be reused across Shots.
- Slot duration is fixed by default; users may explicitly choose auto-extend or ripple behavior.
- Slots have multiple Versions; regeneration creates a new Version by default.
- Data supports recursive nested compositions; first-version UI limits nesting depth.
- Master Timeline is the default Timeline tab; each Shot Version can open in its own additional internal-timeline tab without closing or replacing Master Timeline.
- Master Timeline shows multiple visible, ordered layers below the preview: video/compositing, text/title, audio, and procedural Three.js. A generic “Media track” is not part of the user-facing Timeline; Media is an asset-library concept.
- A Shot is one block on the Master Timeline and uses its selected Version's thumbnail/output. Its Version menu can select an existing Version, add a new Version, or open a Version's nested timeline for editing.
- Video layers can expand to show attached source audio as a child lane. Unlinking turns that audio into an independent Audio Layer, and each Audio Layer has independent persistent mute state.
- Prompts have Shot intent, Version description, and per-asset generation prompt levels.
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

### Master Timeline and Clip Slots
The Master Timeline arranges Shot blocks with explicit master start and duration. Each block shows a thumbnail or honest placeholder, a Shot label, and a Version dropdown. The dropdown lists available Versions, includes + Add Version, and provides an Edit action per Version. Selecting a Version changes only the active output; editing opens that Version's nested timeline in another tab. Support tracks, timing, overlapping layers, clip slots, and source trim. Fixed-duration is the default; auto-extend/ripple must be explicit operations with a preview of impact. Editing Version internals must not silently change the Master Shot duration or downstream positions. Do not show a generic Media track.

### Versions and nested composition
Each Shot/Slot can have multiple Versions. A Version may be a single video, a still image, or a nested composition. A Version owns internal timing, ordered layers/modules, child compositions, scripts, prompts, and generation records. Its Edit action opens an internal timeline tab while preserving the Master Timeline tab. The data model supports recursion, while the UI enforces a reasonable depth and prevents cycles. Regeneration/Add Version creates a new Version by default. Saved Versions pin their Script versions.

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


## Clarified domain model: Shots, Clips, and Versions (2026-10-18)

These definitions supersede any older wording that treats a Shot as a container of Clip Slots or conflates a Shot with a Clip.

- **Shot:** A named video-shot identity. A Shot has multiple **Shot Versions**, each of which identifies a specific video file/output (for example, `video_version1.mp4` and `video_version2.mp4`). A Shot itself is not a container made of Clips.
- **Shot Version:** One concrete alternative for a Shot, normally a video asset. A Shot Version may be referenced by many Clip Versions. Adding a Shot Version never silently changes existing references.
- **Clip:** An independently editable composition managed by the Timeline Editor. A Clip can be empty when created and may contain references to Shots/Shot Versions, Code assets/modules, other Clips/Clip Versions, and supported audio/image/text content.
- **Clip Version:** A saved alternative of a Clip's composition. It owns its internal timeline, module placement/timing, and explicit referenced Shot Versions and child Clip Versions. Duplicating a Clip Version is the explicit way to preserve an existing arrangement before experimenting.
- **Layer:** An ordered track in a Timeline. A Layer contains multiple Clips. A Video Layer contains video/composition Clips; Code is content within a Clip and is not a standalone top-level track type. Effects are configured on the relevant Clip/Layer, not represented as a generic Effects Layer.
- **Asset:** A reusable library entry. Assets include video/Shot source files, image, audio, Code, and Clip compositions. A Master Timeline may be saved as a reusable Clip Asset.

### Version and reference rules

1. Shot Versions and Clip Versions are separate version histories.
2. A Clip Version explicitly pins the Shot Version and child Clip Version it references; it must not silently follow a later “current version” change.
3. Creating a new Shot Version does not automatically create new versions of every referencing Clip. Existing Clip Versions remain unchanged.
4. From a Shot's Asset detail, users can inspect all Clip Versions that reference it, see the selected Shot Version for each reference, change references individually, or batch-change selected/all references to a chosen Shot Version.
5. Users may explicitly create new Clip Versions for selected references when they want to compare a new Shot Version in context. This operation duplicates the chosen Clip Version and changes only the new copy's Shot Version reference.
6. Changing a Shot Version reference in one Clip Version must not mutate other Clip Versions.
7. Empty Clips are valid. Creating a Clip does not require a video or Code module.
8. Recursive Clip composition is supported, but a Clip must never contain itself directly or indirectly. Before presenting a child-Clip choice, filter out any Clip that would create a cycle; validate again on every add/change/import operation. For example, if A contains B and B contains C, C cannot contain A.
9. Shared asset identity is distinct from version-specific usage. Referencing a Shot/Clip does not duplicate its media bytes.
10. Preserve compatibility with existing project data through explicit schema migrations; do not silently discard legacy content.

### Asset creation and timeline UX

- The Assets page has one primary `+` menu with **Clip**, **Code**, **Audio**, and **Image** choices.
- Creating a Clip asks for basic metadata (title/name, canvas size, duration) and may save it empty. Its contents are managed in the Timeline Editor.
- Creating Code opens the existing Code Playground workflow.
- Creating Audio requires uploading an audio file.
- Images are reusable assets that Clips and Code can reference. The asset model must provide a stable ID and a supported way for Code to resolve/use an image; image assets should later be available to Reference profiles and Storyboard generation. Storyboard integration is intentionally staged for later.
- Adding a timeline Layer must not offer “Add linked video/audio clips” as a Layer type/action. Linked source audio is an operation associated with a video Clip, not a Layer-creation choice.
- Master Timeline and Clip Timeline use the same editor UI and core interactions. The Master Timeline can be saved as a reusable Clip Asset.
- Project settings expose aspect ratio, pixel dimensions/resolution, and frame rate with sensible presets and custom values.
- Preview transform controls for a selected visual Clip/Layer must be movable and resizable, and their bounds must correspond to the composition frame and actual content geometry.
- Timeline track headers must be wide enough for readable labels; the ruler, tick labels, playhead, and clip lanes must share aligned horizontal coordinates.

### Version UI acceptance

- Shot detail exposes all Shot Versions and a “Used by”/references view listing referencing Clip Versions and their pinned Shot Version.
- Provide individual reference changes and a batch change operation with a clear affected-reference count/confirmation.
- Provide an explicit action to create new Clip Versions from selected references; do not silently multiply versions.
- The Clip editor exposes Clip Versions, permits duplicate/edit/select, and keeps each version's internal timeline independent.
