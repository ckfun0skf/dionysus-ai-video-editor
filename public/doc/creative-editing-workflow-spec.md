# Dionysus Creative Editing Workflow — Product/UI Specification

**Status:** Updated requirements baseline, 2026-10-18  
**Purpose:** Durable UI and interaction contract for the timeline workspace. A requirement is not considered implemented merely because its data model or a placeholder exists.

## Product model

Dionysus is a shot-based creative editor for AI-assisted video. The core unit on the **Master Timeline** is a Shot, not an arbitrary imported media file. A Shot is a compositional module: its active Version may be a single video, a still image, or a nested composition containing multiple video/image/audio/text/Three.js modules.

The Master Timeline arranges Shots in the final sequence. Each Shot may carry an explicit absolute `masterStart`; legacy projects without it retain a sequential-layout fallback. Opening a Shot Version in its own timeline tab edits that Version's internals without silently changing the Shot's master start time or duration. Storyboard/References remain a separate planning workspace, never a media track.

## 1. Timeline workspace layout and tracks

- Keep the composition preview at the top and the visible, time-proportional track lanes below it, in the general layout shown by the supplied prototype.
- The timeline ruler, playhead, preview time, clip selection, and playback position share one timebase within the currently active timeline tab.
- The left track-header column labels tracks and exposes track-level controls. The actual lanes display the clips/modules placed on them.
- Do **not** expose a generic **Media track**. “Media” is an asset-library concept, not an editing-layer type. Assets remain accessible through the Assets workspace and selectors/menus when assigning a source.
- The Master Timeline supports multiple ordered layers, including video/compositing layers, text/title layers, audio layers, and a procedural Three.js layer. Each supported layer appears as a distinct lane/group under the preview.
- Each video layer is a visual compositing frame/container; its clip displays a real thumbnail when available. A clear placeholder is used if there is no thumbnail. Do not claim a black/blank placeholder is a rendered frame.
- Track/layer creation, ordering, visibility/mute state, and editing controls must belong to the relevant track header, not to a generic media bucket.
- Direct manipulation should support selection, moving, and trimming where implemented. Numeric timing/source controls remain available as an accessible alternative.

## 2. Master Timeline and nested timeline tabs

- The default tab is **Master Timeline**. It arranges Shots at project-level start positions and durations.
- Each Shot Version has an **Edit** action. Activating it opens that specific Version's timeline in a new tab inside the Timeline workspace; it must not navigate away to a separate editor page or replace the Master Timeline tab.
- Tabs are identified by Shot and Version, for example “Shot 03 · Version 2”. Users can switch between the Master Timeline and any open nested Version timeline without losing their place.
- Opening another Version may open another tab. Tabs have a close action; closing a tab must not delete its Version. Unsaved project edits must not be discarded silently.
- A nested timeline edits only its selected Version's internal modules/layers. Its own time ruler and playhead use that Version's internal timebase.
- The Master Timeline uses the Shot's declared duration and absolute master position, not raw source-media duration. Master Shot placement/duration, Clip Slot duration, Version duration, and source in/out are distinct concepts. Internal trims or module arrangements do not silently ripple or resize the master Shot; changing a Shot's duration does not automatically resize its Versions. Drag placement snaps to the project frame rate. The current model allows direct repositioning; a dedicated ripple/reorder mode and overlap policy remain to be designed.
- Nested compositions are recursive in the data model but the UI enforces a reasonable maximum depth and prevents cycles.

## 3. Shot thumbnail and Version dropdown

- Every Shot block on the Master Timeline shows a thumbnail of its currently selected Version (or a clear placeholder when unavailable), along with a readable Shot label.
- A dropdown/chevron on the Shot thumbnail opens the Shot's Version menu, with each Version represented by a thumbnail/placeholder, version name/number, type (video, still/image, or composition when known), and useful status/metadata.
- Selecting a Version changes that Shot's active Version only. It preserves all alternative Versions, is undoable, and survives project save/export/import.
- The menu includes **+ Add Version**. It creates a new Version without overwriting or deleting existing Versions. The user can start it as a video/source-based Version, a still/image Version, or a composite/nested Version, subject to available asset and authoring flows.
- Each Version row has an **Edit** action. Edit opens a new tab for that exact Version's internal timeline (see section 2).
- Version selection and Version editing are separate actions: selecting changes the Shot's active output; editing opens its internal structure.
- When no thumbnail exists, display a neutral placeholder and a clear unavailable state; never fabricate a thumbnail or imply a video/image is available when it is not.

## 4. Linked source audio, independent audio layers, and mute

- When a video source has audio and the user chooses to include it, source audio is represented as a **child audio lane/group under that video layer**, visibly indented and linked to its parent video clip. It is not shown as a generic peer “Media track.”
- Linked source audio initially follows the parent video clip's start and duration. Moving/trimming the linked group keeps both in sync.
- The linked audio row has an explicit **Unlink** action. Unlinking detaches the audio from the video without changing either clip's current position or duration; the audio becomes an independent Audio Layer and can be moved, trimmed, muted, or deleted independently.
- Deleting independent audio must not delete its source video. Deleting a video may remove its still-linked child audio after clearly defined group semantics; it must not remove already-unlinked audio.
- Every Audio Layer has its own persistent **Mute/Unmute** control in the track header. Muting one layer must not mute other audio layers. Mute state applies to preview/playback and, when available, final composition output.
- Unlink state, audio placement, mute state, and source relationships must survive Undo/Redo and project JSON round-trips.
- Later audio features may add volume, fades, gain automation, and effects, but per-layer mute and reliable linked/unlinked behavior are baseline requirements.

## 5. Three.js / procedural layer

- Three.js/procedural content is a first-class timeline layer alongside video, image, text, and audio. It is not hidden in Assets and must not be represented as an ordinary video file unless the output was actually rendered to one.
- A procedural layer has a visible lane block with duration and a clear script/module identity. Selecting it exposes the script/scene version and parameters in the Inspector.
- Saved Shot Versions pin the script/module version they use. Editing a module creates an explicit new saved script/version or an intentionally confirmed update rather than silently changing historical Versions.
- Runtime errors are isolated to that module and surfaced in its lane/Inspector. Imported or AI-provided code must never execute silently: execution requires explicit user authorization and an appropriate security boundary.
- The current Three.js preview component is not evidence that the timeline renderer or final export composites Three.js output. Do not expose a control as functional until its preview/render path is connected and verified.

## 6. Video layer frame and compositing

- A video layer is an output frame/container in the final composition; its clips provide the content positioned within that frame.
- Frame properties include normalized position (x/y), width/height, fit mode (contain/cover/fill), background color, border color/width, shape, and corner radius.
- These properties support picture-in-picture and layered compositions. The data model should permit future animation/keyframes without blocking the current static transform controls.
- Clearly distinguish layer frame geometry from source-media crop and source in/out trim.
- Preview and final render must eventually share the same compositing semantics.

## 7. Prompt/model provenance and Version creation

- Asset metadata may include prompt, provider/model, generation parameters, seed/reference assets when available, and source/version lineage.
- Selecting a Shot, Version, or module exposes relevant prompt/model provenance in the Inspector.
- Prompt and generation settings can be copied/reused for a future regeneration flow.
- Direct in-app generation is a future integration unless a real provider is configured. Until connected, show a clear “generation not connected” state rather than a fake action.
- Asset records distinguish metadata from stored media bytes; missing media/relink state must be visible.
- Creating a new Version must preserve previous Versions and their immutable generation/reference snapshots. Shared assets can be reused without mutating historical Version configuration.

## 8. Storyboard / Reference workspace and reconciliation

- Storyboard/References is a separate planning workspace, not another Timeline track.
- It supports story/scene/shot planning, reference images/profiles, shot order, descriptions, and intended visual continuity.
- A storyboard can generate a new Timeline plan or propose updates to an existing Timeline.
- Reconciliation previews changes and preserves manual Timeline edits unless the user explicitly accepts them.
- Each storyboard-to-timeline operation is undoable and recorded in project history. Reference and prompt snapshots are preserved for prior generation records.

## 9. Data model and persistence invariants

- Keep asset identity, timeline placement, track/layer identity, Shot identity, Version identity, and Version-internal module placement distinct.
- The model must express: Master Timeline Shot placement; Version-owned nested layers/modules; ordered layer/z-order; video parent + linked source audio relationship; independent audio layer mute state; active Version per Shot; and script/module version pinning.
- Every Shot, Version, Asset, Track/Layer, Clip/Module, and Script Version has a stable ID. Optional `Shot.masterStart` is validated as a non-negative finite number; when absent, existing projects retain legacy sequential placement.
- A Slot/Shot's selected Version ID must reference one of its own Versions. Child composition references must resolve and must not form cycles.
- Source duration, source in/out, module duration, Version duration, Shot duration, and Master Timeline position are distinct concepts.
- Project JSON round-trips must preserve Version alternatives, active-version selection, nested modules, layer ordering, links/mute states, procedural module identity, and asset references. Open tabs/playhead/selection may be UI state but must not corrupt project data.
- Missing media, missing thumbnails, and missing script versions are explicit recoverable states.

## 10. Suggested implementation phases

1. **Requirements and schema alignment:** update project model for Shot placement vs Version internals, hierarchical linked audio, mute, layer kind/order, and procedural module identity; add migration-compatible defaults.
2. **Master Timeline UX:** remove generic Media track; make tracks/layers and video/audio grouping visually clear; render Shot thumbnails/placeholders and selected-Version labels.
3. **Version dropdown workflow:** implement per-Shot list of available Versions, + Add Version, selecting the active Version, and per-Version Edit action.
4. **Timeline tabs and nested editing:** keep Master Timeline open as a tab; open a dedicated internal timeline tab for each edited Shot Version.
5. **Layer behavior:** expandable video layer with linked audio child; unlink to independent audio layer; per-audio-layer mute; preserve links and state through history and JSON.
6. **Three.js layer:** first-class lane/module data and Inspector, pinned script versions, explicit execution permission, isolated error state.
7. **Composition, playback, audio and export:** connect the visible model to actual preview/render behavior; document unsupported browser capabilities honestly.
8. **Storyboard reconciliation and portability:** preview/confirm changes, test schema migrations, and preserve Version/media provenance through portable project export.

## Acceptance criteria

- The default Timeline shows a Master Timeline tab and multiple visible track lanes under the preview; there is no generic Media track.
- A Shot block displays its active Version thumbnail/placeholder and name; its dropdown lists alternatives, has + Add Version, and includes Edit per Version.
- Edit opens a new nested timeline tab for that specific Version. The Master Timeline and other opened Version tabs remain accessible.
- Video layers expand to show linked audio. Unlinking creates an independent audio layer without moving/changing the audio or video. Each audio layer can be muted independently.
- A procedural Three.js layer can be represented and edited as its own lane/module with an explicit script-version identity; unsupported rendering is not faked.
- Changing a Shot's selected Version does not overwrite other Versions. Adding/editing a Version preserves history and has observable Undo/Redo behavior for project changes.
- Project JSON round-trip preserves all project-level relationships, including active Versions, nested modules, linked/unlinked audio, mute state, track/layer order, and script pins.
- Automated unit/integration tests cover core model operations; CI runs tests and build. Do not add or reintroduce automated browser smoke tests unless the user explicitly requests them. Manual browser acceptance is a separate user-facing activity, not an excuse to block implementation on unavailable browser tooling.
- Keep PRs scoped and isolated. Never push directly to main; never merge without explicit user instruction.

## Open implementation decisions (not blockers to start)

- Whether time is stored as seconds or rational frame ticks: preserve current seconds model while isolating conversions so frame-accurate editing can be introduced.
- Whether a nested timeline can exceed its declared Version duration: reject/clip overflow by default and require explicit extension.
- Whether track/layer order is a single list or typed ordered groups: preserve a stable ordering field and explicit parent-child relationships for attached audio.
- Whether a new Version starts from a blank composition, duplicate of an existing Version, or assigned asset: offer an explicit choice rather than silently duplicating content.
- Whether source audio is auto-attached at import or when a video clip is added: expose predictable user-visible behavior and keep the link optional.
- Exact effect list, volume/automation model, script permission model, render fidelity, frame rate policy, and performance targets remain future decisions.
