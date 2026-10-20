# Timeline-first execution backlog

Updated: 2026-10-19

## Product direction

**Timeline is the immediate priority.** Do not start full Storyboard, References, full Asset administration, or Production Task UI until the Timeline and mobile gates pass. The Editor must work without configuring Storyboard or Reference Profiles.

Desktop target: source browser (Media/Audio/Text/Effects/Transitions) upper-left, Preview/Canvas upper-right, multitrack Timeline below, contextual Inspector. All views use one canonical Composition state; no mock-only shell or second mutable source of truth.

## Domain invariants

- Shot = narrative/production identity; Shot Version = generated shot-video output with provenance.
- Master Timeline = root Composition; reusable Clip Asset Version = nested Composition.
- Root and nested compositions share schema, edit commands and placement semantics.
- Save-as-Clip preserves editable composition tree, tracks, placements/order, source in/out, transforms, mix state, nested relationships, pinned versions and provenance. It is not a flattened MP4 or layer list.
- Storyboard is a production plan, not a live alias for Timeline timing. Applying a plan is explicit and non-destructive.
- Asset Library/Reference Profiles and Production Tasks/Generation Runs are separate from editing.
- schemaVersion 1.0 migration must preserve alternatives, selected IDs, provenance, ranges, audio links, pins, order and nested relationships. Never silently mutate pinned versions or overwrite user edits.
- Ordinary effects can attach to Clips. Dedicated cross-clip Effect/Adjustment Layer is optional advanced work, not a default empty track. Three.js/procedural placements remain distinct.
- No browser smoke tests. Never claim CI, deployment, rendering or runtime behavior without current evidence.

## Milestone sequence and exit gates

| Stage | Focus | Exit gate |
|---|---|---|
| E0 | Live-state audit | Record main SHA, open PR heads/base/checks, Issues #53/#54/#56, Pages workflow/deployed SHA, code inventory and test commands. |
| E1 | Workspace contract | Wireframe/UML/architecture agree; track/source semantics and open decisions documented; task JSON/detail links validate. |
| E2 | Composition and migration | Deterministic non-destructive schema-1 migration; shared root/nested commands; linked audio, pins, source ranges and legacy fixtures pass. |
| E3 | Functional Desktop Editor | Browse → insert → select → preview → move/trim → Undo/Redo → save/reopen works on one page. |
| E4 | Editing parity and Save-as-Clip | Canvas dimensions/aspect ratio and transforms persist; linked/unlinked audio works; snapshot is independent and structurally editable. |
| E5 | Mobile Editor | Selection-contextual actions, isolated Timeline scroll, no page overflow, state survives panels/rotation; manual acceptance after verified deploy. |
| E6 | Planning modules (deferred) | Storyboard assembly is explicit/non-destructive; References and full Asset admin respect reverse dependencies and pins. |
| E7 | Production/release | Production DAG/Generation Runs, recovery, portable bundles, conflict-aware plan import/export and tested output claims. |

## Task pickup specifications

Each task in `public/doc/tasks.json` now carries: execution stage, priority, dependencies, description, deliverables, out-of-scope boundaries, test strategy, acceptance criteria, next action and handoff notes. Use those fields together with the existing detailed task page.

### DYS-001 — Buildable baseline
Inventory current app, project import/export, persistence and fixtures before refactoring. Keep the Vite/React/TypeScript baseline buildable and preserve regression coverage. A blank but buildable shell is not a usable Timeline.

### DYS-002 — Schema validation/migration
Implement typed validation and deterministic, non-mutating migration. Preserve alternatives, selection, provenance, ranges, linked audio, pins, ordering and nesting. Diagnose missing/dangling/cyclic references; never silently drop data. Test valid/invalid legacy matrices, repeated migration, immutability and round-trip.

### DYS-003 — Task registry
Keep JSON, roadmap, task pages, dependencies, acceptance, evidence and handoff aligned. Validate unique IDs, JSON syntax, milestone order and every detail link. Docs-only progress is not implementation evidence.

### DYS-004 — Full Asset/Reference administration (E6)
After Timeline/mobile gates, implement search/filter, import/relink, metadata, reverse-use, safe replace/delete, Reference Profiles and Edit Timeline. Editor-local source browsing/insertion is E3 and must not wait for this.

### DYS-005 — Shared edit commands
One command boundary for insert, move/snap, conflict handling, trim, split, duplicate, delete, linked audio, version pins and Undo/Redo. Root and nested compositions must share behavior. Test source-time invariants, conflicts, linked audio, history, pins and save/reopen.

### DYS-006 — Preview/Canvas
Embed beside source browser and above Timeline. Synchronize playhead, selection, transforms, source ranges, audio and nested Clip preview. Persist canvas settings/layer geometry and visibly report missing/unsupported media. Do not claim unsupported codec/export support.

### DYS-007 — Recovery/bundles (E7)
After schema/history stabilize, define atomic recovery and portable project/media bundle manifest. Grouped edits recover atomically; bundles round-trip and report/relink missing dependencies. Not a first-Timeline blocker.

### DYS-008 — Audio/procedural baseline
Preserve Three.js/procedural identity, explicit execution permission, pinned script version and placement. Support minimum mute/volume/fade/sync needed for parity. Advanced ducking and dedicated Effect Layer are deferred; do not create an empty Effect track by default.

### DYS-009 — Plan import/export/output claims (E7)
Reconcile imported plans without overwriting manual edits, surface conflicts, and advertise only formats verified by tests. Experimental WebM must not be described as production MP4.

### DYS-010 — CI/deployment evidence
Check exact PR head SHA and logs. After merge, check main CI and Pages independently. No browser smoke tests. Handoff must distinguish PR CI, main CI and deployed Pages SHA; a green PR build alone does not prove deployment.

### DYS-011 — Linked audio regression
Protect linked move/trim/split, unlink, independent audio edit/mute, range/fade, grouped operations and persistence. Test linked and unlinked cases plus Undo/Redo and reopen.

### DYS-012 — Touch primitives
Maintain touch targets, scrubbing/trimming/zooming and isolated Timeline scroll; align ruler and labels. No permanent four-module Editor bottom bar or parallel mobile data model. DYS-018 owns final contextual UI.

### DYS-013 — Nested Clip regression
Protect reusable Clip versions, nested editor, pins, rendering and cycle prevention. Add root/nested parity tests. Existing baseline tests do not prove structural Save-as-Clip is done.

### DYS-014 — Canonical Composition/snapshots
One schema for master and nested Clip timelines; shared commands; independent editable Project-to-Clip snapshots preserving tracks, placements, ranges, transforms, mix, pins, nesting and provenance. A projection helper, envelope or flattened render is insufficient. Re-query PR #88/#89 and rebase or supersede stale work.

### DYS-015 — Production Task DAG/Generation Runs (E7)
Model outputs, prompts, inputs, dependencies/blockers and immutable run snapshots; preserve retry history and effective settings. Diagnose DAG cycles/dangling inputs. Manual prompt-copy/import must work without provider APIs.

### DYS-016 — Roadmap/handoff
Keep current-state checkpoint, decisions, gates, detail links and pickup prompt aligned. Re-query live GitHub/CI/Pages before acting; never rely on stale notes.

### DYS-017 — Functional Desktop workspace
Real source browser, same-page Preview/Canvas, multitrack Timeline and contextual Inspector backed by canonical commands. First vertical slice: browse → insert → select → preview → move/trim → Undo/Redo → save/reopen. No mock-only shell, duplicate state, or Storyboard prerequisite.

### DYS-018 — Mobile contextual Editor
Adapt shared commands to phone/tablet. Use selection-driven bottom actions, source/property sheets, separate navigation and safe areas. No page overflow; state survives panel changes/rotation. Manual acceptance only after verified deployment.

### DYS-019 — Storyboard/References integration (E6)
Explicit assembly preview/apply; keep planning edits separate from manually edited Timeline; support scoped reference overrides and safe reverse use. Timeline remains usable without planning setup. Applying a plan must not silently change manual timing.

### DYS-020 — Wireframe/UML gate
Maintain low-fi HTML prototype and UML sources for workspace, domain, edit sequence and mobile state. Keep architecture/handoff aligned. PR #91 merged the artifacts; this is not production UI. PlantUML rendering/syntax is not verified unless explicitly run.

## Agent pickup protocol

1. Re-query main SHA, open PR state/head/base, Issues #53/#54/#56, exact-head CI and latest Pages deployment.
2. Inspect actual code and tests; report concrete paths and current behavior.
3. Choose one bounded implementation slice; code/tests first, then update docs in the same coherent PR.
4. Never push directly to main. Use a feature branch and Draft PR unless owner directs otherwise.
5. Do not add browser smoke tests. Use automated tests/type/build and verified CI; owner performs visual acceptance after deploy.
6. Group related work to reduce duplicate CI runs and notification noise.
7. Never claim fixed, merged, deployed, rendered or tested without matching evidence; record exact SHA.
8. Handoff must list changed files, implemented behavior, tests/results, unresolved issues, PR/commit and next bounded action.


## Live-state audit checkpoint — 2026-10-20

- Current `main`: `01adc5f2e2f637474ba733b14a5e1f874805e68a`.
- Task replan PR #92 is merged. Its follow-up commit `acf30000624a1a194d168629c8afaa1d4e2a9d38` has a successful exact-head CI run [39330374647](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39330374647); Pages workflow [39330494449](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39330494449) succeeded for the current main SHA. The dashboard and Timeline task page link to the published backlog mirror.
- Task registry audit: all 20 task IDs are unique, milestone sequence is E0–E7, dependencies contain no cycles, and all dependency IDs resolve.
- Issues #53 and #54 are closed; each current issue record points to the earlier PR #63 deployment evidence. Do not add browser smoke tests; the owner performs visual acceptance after deployment.
- Issue #56 remains open and is explicitly tracked under DYS-004/DYS-019 in deferred E6 scope. Required acceptance includes asset-picker cards, context-menu Settings/Edit Timeline/Delete, dependent-use warning, reverse-use/reference management and per-asset frame size.
- Draft PR #88 head `6b74e057132e1db238667cc6576b74e9b2202471` passed exact-head CI [39268343769](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39268343769) but only adds the pure snapshot helper; it does not change the Save-as-Clip UI.
- Draft PR #89 head `6044273c2528de1c4f4b6437114884f79f774377` passed 206 tests but failed `tsc -b && vite build` in [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800). The mapper imports an unused type and incorrectly narrows the discriminated `CompositionSourceReference` union. Do not merge it as-is; keep both PRs in review until a clean, tested integration is ready.
- The public Pages reader could not independently fetch the live HTML in this audit, so a successful deploy workflow is deployment evidence, not a claim that the rendered UI was visually accepted.

## E2 implementation checkpoint — Shared Composition commands

**Merged baseline (`main`):** `5f8dbea57cc72a8b4a909db3b082ea0c54894529`, PR [#93](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/93). Exact-head CI [39398098386](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39398098386) passed 210 tests across 22 test files and passed TypeScript/production build. The CI's dependency audit step is non-blocking, so this is not a claim that the audit was vulnerability-free. Post-merge main CI run [39400972426](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39400972426) and Pages deployment [39400972424](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39400972424) both completed successfully for this exact `main` SHA. This verifies workflow/deployment completion, not visual owner acceptance.

PR #93 adds immutable `CompositionDocument` commands and a compatibility adapter:
- Root Timeline add/move/trim/split/duplicate/delete/unlink operations in `src/timelineOperations.ts` use shared commands.
- Nested Clip Version movement in `src/clipVersionTracks.ts` uses `moveCompositionPlacementToTrack()`.
- The command layer validates IDs, tracks, timing, source ranges, linked-placement references/cycles, and preserves legacy placement metadata. The tests exercise immutability, linked audio/source ranges, splitting, duplication, deletion, unlinking and invalid references.

**Current follow-up PR:** [#94](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/94), branch `feat/nested-composition-command-integration`. It routes nested layer insertion through `insertCompositionPlacement()`, adds `deleteClipVersionLayer()` through `deleteCompositionPlacement()`, and dispatches the nested Editor's Remove layer action through that shared adapter. Unit tests cover insertion metadata/immutability/duplicate IDs and deletion of a root plus linked descendants while preserving independent placements. Code/test head `5c3d3aedda2316e5ac2adf2b46740d857d04e56a` passed exact-head CI [39402243280](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39402243280): 212 tests across 22 files, TypeScript/build succeeded, npm audit summary reported 0 vulnerabilities. A docs-only refresh on this branch still needs CI on its updated head before merge; this follow-up is not deployed. Do not mark DYS-005 complete from this slice.

Remaining gates:
- Route project-aware click-to-place/insertion/conflict resolution into the shared command boundary without weakening ripple/trim/auto-extend, snap or overlap protections.
- Route nested resize plus source-range and adjacent-trim updates through the canonical command contract; preserve frame rounding and linked audio.
- Add root/nested parity tests covering interaction, linked audio, history and Undo/Redo atomicity. Existing React state/history wrappers still govern grouped edits.
- DYS-014 canonical-authoritative persistence and structure-preserving Save-as-Clip remain unfinished. PR #88 is helper-only; PR #89 is a Draft with failed TypeScript/build and must not be merged as-is.
- Keep Storyboard, References and full Asset administration deferred until Timeline/mobile acceptance gates pass.

## Recommended next step

PR #94 is open as a Draft. Re-run/verify CI on its latest head after this documentation refresh (tests, TypeScript, production build, and audit output) before marking ready. If green, merge as one coherent PR and verify the main push CI and Pages deployment against the resulting main SHA. Then ask the owner to visually verify the deployed site. Next implementation slice: nested resize/source-range/adjacent-trim and project-aware insertion/conflict dispatch. No browser smoke tests.
