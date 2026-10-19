# DYS-017 — Timeline Editor workspace rebuild

**Status:** Planned · **Progress:** 0%  
**Milestone:** M3 — Timeline model, Editor workspace and version workflow  
**Depends on:** DYS-016 design contract; DYS-014 canonical data/migration; DYS-005 edit-operation contract

## Goal

Replace the current Timeline UI arrangement with a modular, functional Editor workspace whose main composition surface contains a source browser, preview/canvas and multitrack timeline.

## Scope

### Desktop workspace

- Upper-left source/tool browser with functional Media, Audio and Text access plus working Effects/Transitions that are actually supported.
- Upper-right composite Preview/Canvas with playback/timecode and distinct canvas/project settings.
- Multitrack Timeline in the lower workspace, with readable track names aligned with the ruler.
- Contextual Inspector that can be opened/closed without losing selected placement, playhead, zoom, scroll or edits.
- A project/workspace switcher separate from editing controls.

### Functional vertical slice

- Open a valid legacy/current project and retain the supported data.
- Browse an existing source; explicitly insert it into a compatible track.
- Select a placement and see selection state in timeline, preview and Inspector.
- Move and trim a placement through the canonical Editor command boundary.
- Undo/Redo a logical edit and verify that reopen/persistence retains the result.
- Preserve root-vs-nested composition context without separate operation implementations.
- Keep existing app usable until the new workspace is functionally tested and eligible for staged rollout.

## Implementation constraints

- Use small components such as `TimelineEditorWorkspace`, `SourceBrowserPanel`, `PreviewCanvasPanel`, `TimelinePanel`, `SelectionToolbar` and `InspectorPanel`; these are proposed boundaries, not claims that the files already exist.
- Do not copy the monolithic existing `App.tsx` into a second monolith.
- Do not build a second mutable timeline state for the new UI. Use one Editor session/command service with a compatibility adapter while migration is unfinished.
- Keep the project schema-1.0 import path operational. Do not turn the canonical projection into authoritative storage without round-trip proof.
- Source insertion must not silently overwrite existing placements. Resolve conflicts explicitly.
- Keep global Storyboard/Assets/References navigation out of the Editor's mobile contextual bottom bar.
- Do not add automated browser smoke tests.

## Acceptance criteria

- [ ] The Preview/Canvas and Timeline occupy the same page/workspace.
- [ ] The source browser can browse available project sources and insert a source into a compatible track.
- [ ] Media is a source-library concept, not a generic user-facing timeline track.
- [ ] Track types are Video, Audio and Text; content/source kinds are represented separately.
- [ ] Selection actions are contextual and disabled/unavailable actions cannot appear to work.
- [ ] Root and nested compositions share command semantics for move, resize/trim, snap, conflict policy and history.
- [ ] Undo/Redo, save/reopen, linked audio and source-version pins have deterministic tests.
- [ ] No page-level horizontal overflow at the supported Desktop/Tablet widths; the timeline scrolls within its own viewport.
- [ ] `npm test`, TypeScript check and production build pass on the exact PR head.
- [ ] Owner-visible manual acceptance happens only after main CI and Pages deployment succeed.

## Out of scope

Full Storyboard authoring, full Reference Profiles, provider API integration, and unverified MP4 export are separate tasks. A source browser is in scope; a complete Asset administration module is not required to ship the first Editor vertical slice.
