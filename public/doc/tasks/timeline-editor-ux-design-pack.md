# DYS-020 — Timeline Editor wireframes, UI prototype and UML

**Status:** In progress · **Depends on:** DYS-016 · **Design gate before:** DYS-017

## Goal
Give future agents a shared visual and architectural reference that does not depend on chat history.

## Deliverables
- [x] Responsive low-fidelity desktop/mobile HTML wireframe.
- [x] Clickable source-category and mobile selection-action examples.
- [x] UML component boundary and canonical Composition model.
- [x] Edit-command, validation, renderer and Undo/Redo sequence.
- [x] Mobile selection/contextual toolbar state diagram.
- [ ] Owner review of major layout and interaction decisions.

## Acceptance criteria
- Desktop shows source browser upper-left, Preview/Canvas upper-right, multitrack Timeline below.
- Mobile controls depend on selected entity; module navigation remains separate.
- Media, Audio, Text, Effects and Transitions are Editor-local categories.
- Storyboard and References are later planning modules, not contextual controls.
- Master and nested Clip editing share the same Composition/edit-command contract.
- Diagrams explain state ownership, source pinning, validation, history and rendering.
- Editable artifacts are checked into Git; static prototype is not claimed as production behavior.
- No browser smoke tests are required.

## Files
- docs/architecture/TIMELINE_EDITOR_UX_DESIGN_PACK.md
- docs/architecture/TIMELINE_EDITOR_UML.md
- public/doc/design/timeline-editor-wireframes.html
