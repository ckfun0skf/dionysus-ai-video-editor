# Timeline Editor UML — PlantUML Sources

These are the normative, editable PlantUML diagrams for the Timeline Editor architecture. Each `.puml` file can be opened directly or copied into the [PlantUML Playground](https://www.plantuml.com/plantuml/uml/).

## Diagrams

1. [Workspace boundaries and component relationships](plantuml/timeline-editor-workspace.puml) — source browser, preview/canvas, timeline, contextual inspector, command core and planning modules.
2. [Canonical domain model](plantuml/timeline-editor-domain-model.puml) — Project, CompositionDocument, Track, CompositionPlacement, pinned SourceRef, Clip/Shot versions and EditCommand.
3. [Edit / validation / render / Undo sequence](plantuml/timeline-editor-edit-sequence.puml) — typed command flow, validation, atomic updates, history and rendering.
4. [Mobile selection state](plantuml/timeline-editor-mobile-state.puml) — contextual action states for clip, track and empty selection.

## Invariants

- A versioned placement pins a concrete source/version; creating a new Shot Version must not silently repoint existing placements.
- Master Timeline and nested Clip compositions use the same Composition and edit-command contract.
- Canonical Composition state is the single writable source of truth. Legacy arrays are temporary compatibility projections during migration.
- Persistent composition data is separate from transient editor view state (selection, active source category, zoom and inspector visibility).
- Storyboard and References are planning modules, not contextual mobile edit actions.
- UI gestures dispatch typed commands; commands validate and apply transactions atomically. Undo/Redo uses inverse commands.

If implementation cannot satisfy a diagram, update the relevant `.puml` source and workspace contract in the same PR as the approved architectural change.
