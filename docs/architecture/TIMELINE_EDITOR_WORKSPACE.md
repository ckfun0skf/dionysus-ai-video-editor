# Timeline Editor Workspace Architecture

**Status:** Owner-confirmed product direction; implementation contract · **Updated:** 2026-10-19  
**Roadmap:** [Timeline-First Editor Rebuild Plan](../TIMELINE_EDITOR_REBUILD_PLAN.md)

## Purpose

See the [responsive wireframe prototype](../../public/doc/design/timeline-editor-wireframes.html), [UML/state-flow diagrams](TIMELINE_EDITOR_UML.md), and [design pack checklist](TIMELINE_EDITOR_UX_DESIGN_PACK.md). DYS-020 is the design gate before production UI work; this remains the normative workspace contract.

Define the workspace layout and interaction model for rebuilding Dionysus's Timeline Editor as the first complete creative workspace. It describes the UI architecture and its boundary with the canonical Composition/editing engine; it does not replace the domain model in [Unified Composition Model](./UNIFIED_COMPOSITION_MODEL.md).

## 1. Information architecture

### Product-level navigation

Dionysus is a broader AI-video creation system, not only a timeline. Its eventual top-level areas include:

- **Timeline Editor** — the first complete workspace; directly usable without Storyboard or Reference setup.
- **Storyboard** — narrative planning, Shot intent, ordering, generation targets and deliberate assembly into a timeline.
- **Assets** — full asset administration, metadata, reuse, reverse-use inspection and safe relinking/deletion.
- **References** — reusable reference groups/profiles, role-based selection and per-generation snapshots.
- **Production** — task readiness, generation attempts and output/provenance where supported.

The top-level switcher can live in the app/project header, collapsible desktop navigation or a mobile workspace menu. Its exact visual treatment may evolve, but switching product areas must not consume the Editor's element-action toolbar or lose unsaved edits. Navigation state and editor selection state are different concerns.

### Editor-local source and tool navigation

Inside Timeline Editor, an always-available source/tool panel provides at least:

- **Media:** imported/generated image and video sources, Shot Versions and reusable Clip Versions, with source-version clarity.
- **Audio:** audio sources and audio insertion.
- **Text:** timed text/title insertion.
- **Effects:** implemented effects applicable to a selected placement/composition.
- **Transitions:** implemented transitions between compatible placements.

The panel is a working source browser, not a full substitute for the later Asset administration area. Adding a source creates a timeline placement; it does not create a new top-level track by itself. The Editor remains useful with the project's currently available sources. A tab must be disabled or clearly marked unavailable rather than acting as a fake button if its functionality does not yet exist.

## 2. Desktop layout contract

The layout is organized around three regions:

```text
┌──────────────────────────── Project / Editor Header ──────────────────────┐
│ Workspace switcher · project title · save/status · settings               │
├─────────────────────────────────┬─────────────────────────────────────────┤
│ Source / Tools                   │ Preview / Canvas                        │
│ Media · Audio · Text             │ Composite result · playback · timecode  │
│ Effects · Transitions            │ Optional docked Inspector when selected │
│ Search · filters · source cards  │ Canvas ratio/resolution/transform       │
├─────────────────────────────────┴─────────────────────────────────────────┤
│ Editor actions: Undo/Redo · Add · Snap · Zoom/Fit · settings              │
├───────────────────────┬───────────────────────────────────────────────────┤
│ Track headers         │ Timeline ruler / playhead / placement lanes       │
│ Video / Audio / Text  │ move · trim · split · reorder · linked audio      │
└───────────────────────┴───────────────────────────────────────────────────┘
```

Rules:
1. The preview and timeline are present in the same workspace; preview is not a separate editor page.
2. The source/tool browser occupies the upper-left region. The preview/canvas occupies the upper-right. The multitrack timeline spans the lower region.
3. The Inspector is contextual and collapsible. On wide screens it may dock alongside the preview; if that would starve the canvas or timeline, use a drawer. Do not force a permanently open properties column at all desktop sizes.
4. The track-name column must retain enough width for readable labels and align with the time ruler. Timeline horizontal scrolling should not drag the whole page.
5. Panel resizing/collapse must not reset playhead, selection, timeline zoom, scroll position or unsaved changes.
6. A project/composition settings command is distinct from a selected-clip settings command.

## 3. Mobile workspace contract

Mobile is a touch-first presentation of the same Editor, not a desktop screenshot shrunk to phone width.

- The header provides Back/workspace switcher and project status; app modules remain reachable here.
- Preview/canvas, playback/timecode and the timeline remain in one workspace.
- The timeline is an isolated horizontal scroll area. Short swipes pan; explicit long-press/drag semantics move a placement. Scrubbing, trim handles and drop targets have generous touch hit areas.
- A contextual action strip at the bottom displays actions for the active selection. Examples vary by source: a video placement can show split/trim/duplicate/properties, an audio placement can show mute/volume/trim, and a text placement can show edit/format/duration.
- With no selected placement, this area exposes timeline-level actions such as Add, track controls, zoom/fit and Undo/Redo as space permits.
- Media/Effects browsing and dense property editing open in a sheet or dedicated panel, then return to the same editor state.
- **Do not use a permanent Storyboard / Timeline / Assets / References row as the Editor's bottom toolbar.** That global-navigation pattern conflicts with the contextual editing model. Keep module navigation separate in the header/menu.
- Safe-area insets, viewport resizing and keyboard appearance must not cover the main action strip or timeline selection.

Initial acceptance viewport matrix (to be verified manually after deployment): 360×800, 390×844, 430×932 portrait; a narrow landscape phone; 768×1024 tablet portrait; and representative desktop widths around 1280 and 1440. These are test targets, not claims of existing validation.

## 4. Selection and contextual controls

There are three editor selection scopes:
1. **No placement selected:** composition-level actions (add source, add track, canvas settings, zoom, Undo/Redo).
2. **Placement selected:** source/version identity, position/duration, source in/out, transform/fit, audio/mix or text settings as applicable, split/duplicate/delete and relevant effects.
3. **Track selected:** track-level settings such as ordering, background/transparency where defined, mute or track operations. Track settings must not be confused with the composition canvas or a single placement.

The visible toolbar is derived from selection + source kind + available commands. Commands also validate their own preconditions, so hiding a button is not the only guard. Confirmation is required for destructive or cascading asset actions. Selection is separate from the source's active generated version: an existing placement remains pinned unless the user explicitly changes it.

## 5. Source browser and asset semantics

- Browse/search/filter sources without leaving the Editor.
- A source item may represent a Media Asset, a concrete Shot Version or a pinned Clip Asset Version. Its identity and version status are visible.
- “Add/Insert” creates a Placement on a compatible track after a clear conflict/ripple/trim decision if necessary. It must not silently overwrite existing placements.
- “Edit timeline” for a Clip opens the same Editor with a nested-composition context; “use/insert” places the chosen pinned Clip Version in the parent.
- Changes to Asset metadata do not mutate already pinned placements. Replacing a missing file is explicit and preserves identity/provenance.
- Effects and transitions are operations/settings on supported content, not automatically new top-level track kinds. The standard track kinds remain Video, Audio and Text; source/content type is a separate concept.

## 6. Component boundaries (proposed names)

Keep components small and context-driven. Names can change during implementation but boundaries should remain:

- `TimelineEditorWorkspace`: composition context, responsive layout and panel arrangement.
- `WorkspaceHeader`: project/workspace navigation and save state; no clip-specific tool logic.
- `SourceBrowserPanel`: Media/Audio/Text/Effects/Transitions categories, search/filter and source selection.
- `PreviewCanvasPanel`: composite output, playback, timecode and canvas controls.
- `TimelinePanel`: ruler, playhead, track headers, lane viewport and placement rendering.
- `TimelinePlacementView`: visual selected/dragging/trim states for a placement.
- `SelectionToolbar`: commands available for the current selection, adapting to touch layout.
- `InspectorPanel`: properties grouped by project/composition, track or placement scope.
- `EditorSession` / command service: selected composition, selection, transactions, edit operations and history.
- `ProjectCompatibilityAdapter`: reads legacy projects and writes compatible exports during migration; it is not a second authoritative editor state.

Avoid moving all existing UI code into one new monolith. The current `App.tsx` may temporarily mount the new workspace, but it should delegate behavior to the named boundaries. Do not make independent mutable copies of the same timeline state in the shell, Inspector and timeline panel.

## 7. State flow and persistence

```text
Project JSON (legacy/current)
       │
       ▼
Validate + deterministic migration
       │
       ▼
Canonical Project / Composition documents ◄── source Asset & version registry
       │
       ▼
Editor command transaction ──► validated state change ──► Undo/Redo history
       │                                                 │
       ├──► Preview / Timeline / Inspector views         │
       └──► Persistence + compatible export ◄────────────┘
```

The canonical Composition model and editor operations are defined in `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`. This workspace document defines presentation and navigation, not a competing data schema. All UI entry points invoke the same commands; Preview, Timeline and Inspector render one accepted document state.

Persistence requirements:
- Schema-1.0 imports remain valid while migration is under development.
- Round-tripping preserves IDs, alternatives, prompts, references/provenance, selected versions, source ranges, linked audio, nested composition pins and track ordering.
- Saving a Clip Asset from the Master Timeline produces an independently editable structural snapshot.
- Undo/Redo reverses a logical transaction and restores all dependent state, including linked audio.
- Missing or unsupported sources are visible and repairable. Data is never silently dropped.

## 8. Accessibility, responsiveness and visual behavior

- Selected, active, muted, disabled and pressed states are visually obvious and semantically exposed.
- Interactive controls have visible affordances and appropriate accessible labels.
- Track labels remain legible while panning; resizing a lane must not displace the timeline ruler.
- Page-level horizontal overflow is prohibited; horizontal movement stays in the timeline/source browser that owns it.
- Desktop prioritizes dense editing and controllable panel widths. Mobile prioritizes direct manipulation, contextual actions and progressive disclosure.
- Respect reduced motion and keyboard access where supported. Keyboard shortcuts must not trigger while typing in text inputs.

## 9. Design acceptance checklist

- [ ] Source browser and preview/canvas are above the multitrack timeline in one workspace.
- [ ] Media/Audio/Text/Effects/Transitions can be opened without leaving Timeline Editor.
- [ ] A source can be inserted without silently overwriting existing content.
- [ ] Selecting different placement kinds changes contextual tools correctly.
- [ ] Inspector can be shown/hidden without losing selection or timeline position.
- [ ] Project navigation does not reuse the mobile selected-element toolbar.
- [ ] Mobile preview and timeline remain together; contextual bottom controls stay reachable.
- [ ] Master and nested Clip Version contexts use the same selection/command semantics.
- [ ] UI has no independent copy of canonical edit state.
- [ ] Acceptance covers accessibility state, touch targets, no page overflow, project reopen, undo/reopen and version pins.

See the main execution plan for milestone ordering, current PR disposition, test policy and agent handoff rules.
