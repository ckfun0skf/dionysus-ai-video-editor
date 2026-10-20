# DYS-016 — Timeline-first Editor rebuild plan and architecture

**Status:** In progress · **Progress:** 80% (documentation/decision slice; CI and merge remain pending)  
**Milestone:** M3 — Timeline model, Editor workspace and version workflow

## Goal

Provide a durable, owner-aligned decision record and an implementable milestone/task plan for rebuilding Timeline Editor as Dionysus's first complete creative workspace, with Media/Effects access embedded in the Editor and Storyboard/References added around it later.

## Confirmed direction

- Desktop Editor: source/assets/effects browser upper-left, preview/canvas upper-right, multitrack timeline below.
- Media, Audio, Text, Effects and Transitions are accessible from inside the Editor; the source browser is part of the core workspace.
- Mobile uses a contextual selected-element toolbar at the bottom. Global module navigation belongs in the project/workspace header or menu, not in the Editor's bottom tool bar.
- Storyboard and References are separate planning workflows integrated after the Editor and its source contract are stable.
- Rebuild the workspace and state boundary, not the project from an empty repository. Preserve proven utilities and schema-1.0 compatibility where tests and source review justify reuse.
- No automated browser smoke tests.

## Deliverables

- `docs/TIMELINE_EDITOR_REBUILD_PLAN.md`: phased execution plan, dependencies, PR reconciliation and handoff requirements.
- `docs/architecture/TIMELINE_EDITOR_WORKSPACE.md`: Desktop/Mobile layout, contextual controls, source browser and state-flow contract.
- Updated PRD, architecture, handoff prompts, task dashboard and existing mobile/unified-model task docs.
- Explicit first implementation slice and definitions of Ready/Done.

## Milestones represented by this plan

1. Reconcile live code/PR/issue/CI state and inventory what to keep, adapt, replace or defer.
2. Stabilize canonical Composition state, migration and editing command/Undo contract (DYS-014/DYS-005).
3. Implement a new functional Desktop workspace with an embedded source browser, preview/canvas, multitrack timeline and contextual Inspector.
4. Complete editing parity and structural snapshots; keep root and nested Clip editing on the same engine.
5. Adapt the same workspace to touch-first Mobile with contextual bottom controls and separate module navigation.
6. Integrate Storyboard planning/assembly, then full Reference Profiles/Asset Management.
7. Complete generation history, recovery, portability and truthful output/release validation.

## Acceptance criteria

- [ ] The design document states the same layout and navigation decisions as the PRD and architecture.
- [ ] A task has an explicit implementation order, dependencies, exit tests and rollback/data safety constraints.
- [ ] Existing task IDs and completed feature evidence remain traceable; new work has DYS-016 through DYS-019 entries and resolvable detail links.
- [ ] Open PRs and exact-head CI state are recorded without calling draft code shipped.
- [ ] Documentation JSON parses, dashboard links resolve, and exact-head CI passes.
- [ ] No UI implementation, browser smoke test, release or user acceptance is claimed by this planning-only slice.

## Current blockers and handoff

PR #89 remains Draft. Its exact-head run [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) passed tests but failed TypeScript/build due to an unused type import and accesses to incompatible branches of `CompositionSourceReference`. Re-inspect its current head before deciding whether to repair/rebase it or supersede the implementation. PR #88 is also Draft and is not on main.

This task is specifically a planning/documentation slice. After it merges, the first code slice is a bounded audit/reconciliation plus the canonical edit-state/command boundary and a functional Desktop workspace vertical slice—not a wholesale deletion of existing code.
