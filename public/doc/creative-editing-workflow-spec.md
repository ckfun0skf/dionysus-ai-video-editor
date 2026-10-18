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
- Direct manipulation supports selection, frame-snapped moving of Master Shots, ordinary Master Timeline clips, and nested Version modules; splitting is available at the midpoint or current playhead for Master Timeline clips. Numeric timing and source in/out controls remain available as an accessible alternative. Moving a video clip must preserve its linked source-audio timing. Unsupported media decoding keeps an honest placeholder and does not block source import.

## 2. Master Timeline and nested timeline tabs

- The default tab is **Master Timeline**. It arranges Shots at project-level start positions and durations.
- Each Shot Version has an **Edit** action. Activating it opens that specific Version's timeline in a new tab inside the Timeline workspace; it must not navigate away to a separate editor page or replace the Master Timeline tab.
- Tabs are identified by Shot and Version, for example “Shot 03 · Version 2”. Users can switch between the Master Timeline and any open nested Version timeline without losing their place.
- Opening another Version may open another tab. Tabs have a close action; closing a tab must not delete its Version. Unsaved project edits must not be discarded silently.
- A nested timeline edits only its selected Version's internal modules/layers. Its own time ruler and playhead use that Version's internal timebase. The Version duration is editable independently from Master Shot duration and Clip Slot duration; each module has its own start/duration controls, and layer ordering is explicit. Dragging a module moves its internal start with project-frame-rate snapping. This must not resize the Master Shot or any other Version.
- The Master Timeline uses the Shot's declared duration and absolute master position, not raw source-media duration. Master Shot placement/duration, Clip Slot duration, Version duration, and source in/out are distinct concepts. Internal trims or module arrangements do not silently ripple or resize the master Shot; changing a Shot's duration does not automatically resize its Versions. Drag placement snaps to the project frame rate. The Master Timeline defaults to free placement, including intentional overlap. Inspector warnings identify overlapping Shots. An explicit Ripple Reorder mode reorders the chronological sequence and packs Shots back-to-back, closing gaps without resizing Shot durations or Version internals.
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
- Per-Audio-Layer volume, Fade In, and Fade Out are supported in both Master and nested Version timelines and apply to live playback and WebM export using a shared gain envelope. More advanced gain automation, ducking, and effects remain future work; per-layer mute and reliable linked/unlinked behavior are baseline requirements.

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
- Source duration, source in/out, module duration, Version duration, Shot duration, and Master Timeline position are distinct concepts. Trimming a clip synchronizes sourceOut with the resulting duration when a source range is explicit, and fade-in/out values are clamped to valid clip bounds. Splitting a clip materializes implicit source ranges, preserves contiguous source offsets, keeps linked source audio aligned, and assigns fade-in to the first segment and fade-out to the last.
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


## 11. Canonical Shot, Clip, Asset, and Version semantics (2026-10-18)

This section is authoritative and supersedes earlier sentences in this document that describe a Shot as a composition container or imply that Shot and Clip are interchangeable.

### Domain definitions

- **Shot:** A video-shot identity with one or more concrete Shot Versions. Each Shot Version is a specific video file/output (e.g. `video_version1.mp4`, `video_version2.mp4`). The Shot is not a container made of Clips.
- **Shot Version:** A concrete alternative/output for the Shot. It can be referenced by multiple Clip Versions.
- **Clip:** An independently editable timeline composition. A Clip may be created empty and later contain Shot/Shot Version references, Code, child Clips, audio, images, text, or supported compositing modules.
- **Clip Version:** A saved alternative of a Clip's complete composition state, including its internal timeline and explicit references to Shot Versions and child Clip Versions.
- **Layer:** A timeline track containing multiple Clips. A Video Layer is made of video/composition Clips. Code belongs inside a Clip; do not add a standalone Code Layer. Effects are settings on the relevant Clip/Layer, not a standalone Effects Layer.
- **Asset:** A reusable item in the library. Asset identity is independent of its use inside any particular Clip Version.

### Reference and version behavior

1. Shot Version history and Clip Version history are independent.
2. Each Clip Version pins the exact Shot Version and child Clip Version it uses. A later Shot Version must not silently alter existing compositions.
3. Adding a Shot Version does not automatically create Clip Versions for every reference.
4. Shot details provide a “Used by”/references view listing all referencing Clip Versions and the Shot Version each one currently uses.
5. Users can change a single reference or batch-change selected/all references to a chosen Shot Version. Batch changes should preview/count affected references and be undoable.
6. Users may explicitly create new Clip Versions from selected references. This duplicates each selected Clip Version, updates the new copy to use the chosen Shot Version, and preserves the original. It must never silently overwrite existing Clip Versions.
7. Editing one Clip Version cannot mutate other Clip Versions, and changing one reference cannot change unrelated references.

### Nested Clip cycle prevention

Treat Clip references as a directed graph. A proposed parent-to-child reference is invalid if the child is the parent itself or if traversing descendants from the proposed child can reach the parent. Example: if Clip A contains Clip B and Clip B contains Clip C, Clip C cannot contain Clip A. Filter invalid children in selectors, but also validate every add/change operation, imported project, and migration. Unresolved IDs and invalid cycles must be reported and recovered safely rather than causing recursive preview/render loops.

### Asset creation workflow

- The Assets page has one primary `+` dropdown with exactly these initial choices: **Clip**, **Code**, **Audio**, **Image**.
- **Clip:** collect basic title/name, canvas size, and duration; allow saving an empty Clip. Contents are edited later in the Timeline Editor.
- **Code:** use the existing Code Playground creation/editing workflow.
- **Audio:** require upload of an audio file before saving the Audio Asset.
- **Image:** create a reusable image Asset with a stable ID and a supported reference mechanism for Code and Clip. Reference profiles and Storyboard-generated video should be able to use these images in a later phase; do not expand Storyboard integration into the initial asset-editor slice.
- Do not offer “Add linked video/audio clips” in the Add Layer menu. Linking source audio is a video Clip workflow action, not a Layer type.

### Shared Timeline Editor and project canvas

- Master Timeline and Clip Timeline use the same Timeline Editor component and interaction model, with context-specific scope and timebase.
- The Master Timeline can be saved as a reusable Clip Asset.
- Project settings expose aspect ratio, pixel width/height (resolution), and frame rate, with presets and custom values.
- Selecting a transformable visual Clip/Layer shows a bounding box with working move and resize handles. The default box must not be arbitrarily oversized; it must reflect composition geometry and the selected object's transform.
- The left track-header column must be wide enough for readable labels. Timeline ruler labels, tick positions, playhead, and clip lanes must share aligned horizontal coordinates and scale.
- Layer creation is for actual track types (e.g. Video, Audio, Text). It is not a shortcut for adding content inside a Layer.

### Version policy examples

- Shot #1 has Shot Version A (`video_version1.mp4`) and Shot Version B (`video_version2.mp4`).
- Clip #1 Version A can reference Shot #1 Version A plus Code Asset #1.
- Clip #1 Version B can reference Shot #1 Version B plus Code Asset #1.
- Adding Shot Version B does not auto-create Clip #1 Version B. The user can explicitly duplicate Clip #1 Version A into a new Clip Version, switch its Shot reference to Version B, and preserve both alternatives.
- Changing the Shot Version in Clip #1 Version A must not silently update Clip #1 Version B or Clip #2.
