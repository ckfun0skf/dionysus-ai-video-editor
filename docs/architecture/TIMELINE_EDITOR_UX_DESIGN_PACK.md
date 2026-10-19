# Timeline Editor UX Design Pack

Status: Design baseline; owner review required before DYS-017 UI implementation.

## Purpose
Create a durable visual and architectural reference for new agents. The HTML prototype is low-fidelity and does not represent production behavior.

## Artifacts
- [Responsive wireframe prototype](../../public/doc/design/timeline-editor-wireframes.html)
- [UML and state flows](TIMELINE_EDITOR_UML.md)
- [Workspace contract](TIMELINE_EDITOR_WORKSPACE.md)
- [Rebuild plan](../TIMELINE_EDITOR_REBUILD_PLAN.md)

## Design decisions
- Dedicated Timeline Editor workspace, not a mobile four-item bottom navigation.
- Desktop: source/tool browser upper-left, Preview/Canvas upper-right, multitrack Timeline below.
- Mobile: Preview/Canvas and Timeline are the editing surface; module navigation is separate from the contextual action bar.
- Editor-local source categories: Media, Audio, Text, Effects, Transitions.
- Storyboard and References are planning modules integrated later, not contextual edit controls.
- Master and nested Clip compositions share the same editing command contract.
- Versioned sources remain pinned per placement unless the user explicitly requests an update.
- UI gestures dispatch typed commands; persisted composition state and transient view state have distinct ownership.

## Review checklist
- [ ] Desktop Preview and Timeline visible together at laptop widths.
- [ ] Source category changes do not lose composition/selection.
- [ ] Inspector is contextual rather than permanently consuming canvas space.
- [ ] Timeline models multiple tracks, linked/independent audio, trim, move, split and mute.
- [ ] Mobile action bar changes for clip, video track, audio track and empty selection.
- [ ] Keyboard/touch alternatives exist for drag-only actions.
- [ ] Owner reviews major layout/interaction decisions before DYS-017.
- [ ] Prototype is never treated as proof of implemented behavior.
- [ ] No browser smoke tests are required.

Exact visual theme, icons, inspector field details and provider-specific generation UI remain open. Update these artifacts whenever an owner-approved behavior changes.
