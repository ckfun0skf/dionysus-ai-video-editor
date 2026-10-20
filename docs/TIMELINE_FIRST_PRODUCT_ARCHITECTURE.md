# Timeline-First Product Architecture

**Status:** Direction recorded; detailed implementation choices pending owner confirmation  
**Updated:** 2026-10-20  
**Scope:** Product/module boundaries and future entry workflow. This document does not authorize building the landing page, authentication, or full Storyboard/Reference modules ahead of the Timeline Editor core.

## 1. Purpose

Dionysus should be built around a capable, independently usable Timeline Editor. Storyboard is a separate planning module whose main purpose is to make creating an initial timeline more intuitive and, later, to give AI-assisted workflows a structured way to turn a creative brief into a storyboard and then a timeline.

The immediate engineering priority is to make the Timeline Editor a real core workspace. Record the broader product idea now so future agents preserve the direction without prematurely implementing every module.

## 2. Core product model

### 2.1 Timeline Editor — core authoring module

The Timeline Editor must be independently useful without requiring a Storyboard or Reference setup. It owns the editing experience: source browsing, preview/canvas, tracks and placements, clip/shot versions, layers, transforms, audio relationships, edit commands, Undo/Redo, and project save/restore.

The editor should feel like a dedicated editing application, not a content page wrapped by the legacy website navigation. Its own workspace chrome should prioritize the preview and timeline, with editor-local source tools and contextual properties. App-level navigation may remain reachable, but must not compete with editing controls or permanently consume valuable timeline space.

The existing canonical Composition and editing-command work should be preserved and used as the single source of truth. This is a workspace refactor, not permission to discard validated domain logic or recreate mutable parallel timeline state.

### 2.2 Storyboard — separate planning module

Storyboard is a distinct module, not the main editor and not a prerequisite for editing. Its primary job is to help users plan shots visually and convert that plan into an initial Timeline Editor project/composition.

Expected relationship:
1. User arranges a storyboard or shot plan.
2. The user explicitly creates/applies an initial timeline from that plan.
3. The resulting timeline is independently editable.
4. Later storyboard changes must not silently overwrite manual timeline edits. Re-applying a plan should be an explicit, non-destructive operation with conflicts or changes surfaced.

Storyboard may use the same project assets and reference information as the editor, but its planning state should not become a hidden second source of truth for timeline timing.

### 2.3 Asset Library and References — shared supporting capabilities

The Editor needs an in-context source browser so it can be used on its own. That editor-local browser is not the same as a future full Asset Library administration module.

A future shared Asset Library should make reusable media available to Timeline, Storyboard, and References. A future References module may organize assets into reusable groups (for example, character, scene, costume, or visual-style groups) and assign groups or individual references to shots. Shot-specific include/exclude overrides may be needed, such as using a character reference while excluding a particular costume reference.

Reference usage/purpose and exclusions should be structured data, not only visual labels, so future generation workflows can understand which references apply to a shot. These modules are supporting capabilities; they must not block the first usable Timeline Editor.

## 3. AI-assisted creation direction

The longer-term desired flow is:

**Creative brief/prompt → AI-assisted Storyboard → explicit Timeline creation → independent Timeline editing.**

Current practical workflow may be manual: the user copies a prompt and pastes it into an external AI tool, then brings the resulting storyboard/plan back into Dionysus through a suitable structured or manual workflow. Do not imply that end-to-end AI orchestration, provider integration, or automatic import already exists.

The architecture should avoid making future AI assistance dependent on one provider. Keep plans, shot intent, source/reference assignments, and generated outputs structured enough that a user or AI agent can create a storyboard and translate it into a timeline later. Manual prompt-copy/import should remain a viable interim path.

## 4. Product entry flow (future; not an immediate implementation task)

A future public-facing entry flow may include:
- A landing page explaining Dionysus and showing what the tool does.
- Registration/sign-in, when account support is designed and implemented.
- A project entry point that lets the user either start with Storyboard or open/create a Timeline directly.
- Direct access to an existing project’s Timeline Editor.

Illustrative route names only, not a routing decision:
- `/` — product landing page
- `/projects/new` — choose a starting workflow
- `/editor/:projectId` — Timeline Editor
- `/projects/:projectId/storyboard` — Storyboard planning module

Routing should connect these surfaces, but routing alone does not define the Editor architecture. The Editor must remain a self-contained core workspace regardless of which entry route opened it. Do not build the landing page, authentication, or full routing flow as part of the immediate Timeline core slice.

## 5. Immediate implementation priority

Work in this order:

1. **Make the Timeline Editor shell genuinely editor-owned.** Remove the old website-level navigation/header from around the active editing workspace. Provide editor-native project/workspace controls without allowing app navigation to dominate the screen.
2. **Complete the core editing vertical slice.** Browse/select a source → insert it into a track → preview it → select/move/trim it → Undo/Redo → save and reopen with the result preserved.
3. **Finish core workspace behavior.** Preview/canvas, track layout, selected clip/layer inspector, versions, linked/unlinked audio where supported, and responsive desktop/mobile editing.
4. **Preserve the canonical data boundary.** Use Composition-backed commands and one authoritative editor session/state; protect project compatibility, pinned versions, source ranges, provenance, nested structure, and history with tests.
5. **Only then expand supporting planning workflows.** Integrate Asset Library/References and Storyboard through explicit contracts; keep full landing/auth/routing work separate until it is prioritized.

Do not call a visual-only CSS pass complete if the old page shell still defines the experience or the basic editing workflow is not usable.

## 6. Constraints for agents

- Feature branch + coherent PR; do not push directly to `main`.
- Keep the PR Draft until the relevant tests and owner-facing acceptance criteria are satisfied.
- Do not add or run automated browser smoke tests. Use deterministic tests, TypeScript, production build, and CI; the owner can perform manual visual acceptance after a verified deployment.
- Do not claim real AI generation, unsupported effects, or production export unless implemented and verified.
- Prefer a small number of coherent commits; avoid repeated audits and documentation-only claims of implementation progress.
- Treat route names, account/auth behavior, exact module-switcher behavior, and the final Storyboard-to-Timeline apply UX as open decisions for later confirmation.

## 7. Questions to confirm before implementing the broader workflow

These are deliberately deferred and must not block Timeline core work:
1. Should Storyboard be a project-level module or a planning mode within a project workspace?
2. What structured format should external-AI storyboard output use for import, and how much manual editing is required?
3. Should a generated storyboard create a new Timeline, or also support explicit updates to an existing Timeline with conflict review?
4. What are the minimum required Reference Group fields and per-shot include/exclude rules?
5. Which public routes and authentication model should be adopted when the landing page/account flow is prioritized?

## 8. Relationship to existing execution plan

Use this document for product/module boundaries and the longer-term creation flow. Use `docs/TIMELINE_EDITOR_REBUILD_PLAN.md` and `docs/TIMELINE_FIRST_EXECUTION_BACKLOG.md` for detailed Timeline implementation sequencing, tests, migration constraints, and acceptance gates. If details appear to conflict, preserve the confirmed immediate priority: build the Timeline Editor core first; Storyboard, References, landing page, and authentication must not become prerequisites.
