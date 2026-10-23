## Latest checkpoint — 2026-10-22 (canonical root snapshots and nested version metadata)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) remains open and unmerged. Issue #110 tracks architecture; Issue #100 remains open for owner UI acceptance.
- Latest validated code head: `7ab812eda28faa62ae7d4746f458d3ea79c5f5d8`. Exact-head CI [39876633058](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39876633058) passed 26 test files / 296 tests, TypeScript/build, and npm audit 0 vulnerabilities. This documentation sync creates a newer head; verify exact-head CI afterward.
- Editor state/history/import/recovery use a paired `EditorSessionSnapshot`. Autosave writes canonical v2 only; schema-1.0 `dionysus.project.v1` remains a read-only fallback.
- Nested Clip/Shot Slot Inspector edits, track mute, duration, and description synchronize canonical Composition metadata with compatibility projections through dedicated helpers. The selected storyboard Version description editor uses that same command helper.
- Initial Clip Asset Version A, New Blank Versions, and the empty storyboard-slot fallback materialize independent canonical Composition documents, including empty placements and correct canvas dimensions. New blank and duplicated Versions synchronize their visible descriptions with canonical Composition metadata.
- Legacy-only Clip Version duplication canonicalizes the source before remapping tracks, placements, and linked-audio references.
- Save-as-Clip Asset uses the authoritative Editor-session root Composition. Its nested Composition and flattened renderer projection are derived from the same root, preventing stale legacy Project data from silently replacing canonical-only edits. Regression coverage confirms a canonical placement moved to 9s is saved/rendered at 9s while the source legacy project remains at 5s.
- Nested render layers use canonical nested Composition where present, including linked-audio children with source/range/mute/volume/fade and owner-track mute. Master preview, audio playback preparation, procedural/script preview, and export start from canonical root Composition through a memoized adapter to the legacy `CompositionLayer[]` renderer.
- Editable master/nested Timeline UI remains compatibility-projected; renderer output still uses `CompositionLayer[]`. Some non-root/pinned snapshot paths remain to audit. This is not canonical-only rendering/UI.
- No local checkout tests/build, browser smoke tests, or manual UI acceptance are claimed. Do not merge without explicit owner approval.
- Next: verify exact-head CI after this docs sync, then audit remaining non-root edit/pinned snapshot paths and plan a tested nested editable UI migration off compatibility layer projections.

---

## Latest checkpoint — 2026-10-22 (E1 edit, undo/redo and persistence boundaries)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) is Ready for review, open and unmerged.
- One `EditorSessionSnapshot` pairs the schema-1.0 Project compatibility projection with the canonical root Composition. Shared history, React state and `editorSessionRef` keep the pair together.
- `src/editorSession.ts` owns the main edit transaction through `transitionEditorSession()`: capture pre-edit paired history, apply the Project updater, stamp a revision, reconcile/project the pair, return session + history together. It also owns `restoreEditorSessionHistory()`, so Undo/Redo restore Composition and compatibility Project as one revision.
- `src/editorSessionPersistence.ts` centralizes autosave and key names. It writes the v2 canonical Composition envelope first, then the matching v1 compatibility projection at the same timestamp. If the v1 mirror write fails after v2 succeeds, the new canonical envelope remains available for recovery. This is still dual-key compatibility storage, not a single-key migration.
- Regression coverage: `src/editorSession.test.ts` covers canonical geometry, edit transaction immutability, and edit → Undo → Redo pair restoration; `src/editorSessionPersistence.test.ts` covers canonical-first order, same-revision projection and failed mirror recovery.
- Exact code-head CI passed for `f288bc97afb3c6ae097482534cef2b2f50b4408b`, [run 39862822226](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39862822226): 26 test files / 281 tests, TypeScript/build passed, npm audit 0 vulnerabilities. This docs/task refresh creates a new SHA; re-check exact-head CI on that synchronized head.
- Still incomplete: Project remains a compatibility projection; storage still uses v1/v2 keys; non-root editing and render/playback paths still use legacy projections in places. Do not call E1/E2/E3 complete based on this slice.
- No local checkout was available for local tests/build. No browser smoke tests or manual UI acceptance claimed. Do not merge without explicit owner approval; Issue #100 remains open.
- Next: verify docs-synchronized exact-head CI, then continue routing remaining state mutations/import through the session boundary and design a safe single authoritative persistence/recovery path.

---

## Latest checkpoint — 2026-10-22 (E1 transaction + persistence boundaries)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) is Ready for review, open and unmerged.
- One `EditorSessionSnapshot` pairs the schema-1.0 Project compatibility projection with the canonical root Composition. Shared history, React state and `editorSessionRef` keep the pair together.
- `src/editorSession.ts` now owns reconciliation and `transitionEditorSession()`: it records the pre-edit paired snapshot, runs the Project updater, stamps a revision, reconciles/projects the pair, and returns session plus history together. `App.tsx` applies the result rather than rebuilding the transaction inline.
- `src/editorSessionPersistence.ts` centralizes autosave and key names. It writes the v2 canonical Composition envelope first, then the matching v1 compatibility projection at the same timestamp. If the v1 mirror write fails after v2 succeeds, the new canonical envelope remains available for recovery. This remains dual-key compatibility storage, not a single-key migration.
- Regression coverage: `src/editorSession.test.ts` tests canonical geometry preservation and paired transaction/history behavior; `src/editorSessionPersistence.test.ts` tests canonical-first order, same-revision projection, and failed mirror recovery.
- Exact code-head CI passed for `784b2ca83e7861ef85667341911459c3a599a494`, [run 39862266483](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39862266483): 26 test files / 280 tests, TypeScript/build passed, npm audit 0 vulnerabilities. This handoff/task sync creates a new SHA; re-check exact-head CI on that synchronized head.
- Still incomplete: Project remains a compatibility projection; storage still uses v1/v2 keys; non-root editing and render/playback paths still use legacy projections in places. Do not call E1/E2/E3 complete based on this slice.
- No local checkout was available for local tests/build. No browser smoke tests or manual UI acceptance claimed. Do not merge without explicit owner approval; Issue #100 remains open.
- Next: verify docs-synchronized exact-head CI, then move remaining command families into the session boundary and continue canonical persistence/recovery consolidation.

---

## Latest checkpoint — 2026-10-22 (E1 session transition boundary)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) is Ready for review, open and unmerged.
- The Editor now uses a paired `EditorSessionSnapshot` containing the schema-1.0 Project compatibility projection and canonical root Composition; history records/restores the pair, React state is a single pair, and callback reads use one `editorSessionRef`.
- Added `src/editorSession.ts`: `reconcileEditorSessionComposition()` now lives outside the UI component, and `commitEditorSessionChange()` produces the next paired session for normal changes. Existing canonical placement geometry/source/link ownership is preserved against metadata-only legacy reconciliation. `src/editorSession.test.ts` covers this behavior and explicit canonical root commits.
- Exact code-head CI passed for `d32ea856511b0fa13821577d5786048fa6983b37`, [run 39860987542](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39860987542): 25 test files / 277 tests, TypeScript/build passed, npm audit 0 vulnerabilities. This handoff/task refresh creates a newer SHA; confirm exact-head CI again before treating the docs-synchronized head as verified.
- Remaining: `DionysusProject` remains a compatibility projection; browser persistence still uses v1/v2 keys; non-root domain edits and renderer/playback continue to use legacy projections in places. This does not finish canonical-only persistence or rendering.
- No local checkout was available for local tests/build. No browser smoke tests or manual UI acceptance claimed. Do not merge without explicit owner approval; Issue #100 stays open.
- Next: verify final-head CI, then continue moving command ownership into the Editor session and consolidating persistence/recovery.

---

## Latest checkpoint — 2026-10-22 (E1 atomic session state and ref)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) is Ready for review, open and unmerged.
- The Editor now uses one `EditorSessionSnapshot` React state containing the schema-1.0 Project compatibility projection and canonical root Composition. Normal edits, Undo, Redo and project import commit the pair in one state update.
- A single `editorSessionRef` now backs timeline callbacks and command reads. Its `project` and `composition` members are replaced together; no partial writes to either member remain in `src/App.tsx`.
- `editorSessionHistory.ts` stores the paired snapshot, with 800 ms same-group coalescing, redo invalidation on new edits, bounded history, and import reset; tests are in `src/editorSessionHistory.test.ts`.
- Exact code-head CI passed for `6ccacdd359f3c508aeeae93c8e87b5b1c381f66b`, [run 39860285572](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39860285572): 24 test files / 274 tests, TypeScript/build passed, npm audit 0 vulnerabilities. This handoff/task refresh creates a new branch SHA, so re-check exact-head CI on the final synchronized head.
- Still transitional: current Project is a compatibility projection; two browser storage keys remain; persistence/recovery and render/playback are not canonical-only; non-root Shot/Slot paths still need migration. Do not mark E1/E2/E3 complete based on this slice.
- No local checkout was available for local tests/build. No browser smoke tests or manual UI acceptance claimed. Do not merge without explicit owner approval; Issue #100 stays open.
- Next: verify final-head CI after this docs sync, then continue consolidating command/session ownership and implement the single authoritative persistence/recovery path.

---

## Latest checkpoint — 2026-10-22 (E1 atomic Editor session)

- Branch: `feat/e1-editor-session-history`; [PR #111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111) is Ready for review and remains unmerged.
- `src/editorSessionHistory.ts` / `src/editorSessionHistory.test.ts` add one paired history entry for the schema-1.0 `DionysusProject` compatibility projection and canonical root `CompositionDocument`. Rapid same-group edits still coalesce (800 ms), new edits invalidate Redo, history is bounded, and import resets history.
- A second E1 slice in `src/App.tsx` replaced separate React state initializers for Project and root Composition with one `EditorSessionSnapshot` state. Normal edit, Undo, Redo and import paths now commit the `{ project, composition }` pair in one React state update; existing UI consumers read derived members.
- This does **not** yet make all state canonical-only: project/root refs, two browser persistence keys, non-root domain edits, legacy projections, and render/playback paths remain transitional.
- Exact-head CI passed on the second code head `3ce28e4dca4d26deebcc483851e70f64b8e561c8`, [run 39859937316](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39859937316): 24 test files / 274 tests, TypeScript/build passed, npm audit 0 vulnerabilities. The task/handoff refresh creates a new branch head; verify CI on that final synchronized SHA before relying on this checkpoint.
- No local checkout was available for local npm tests/build. No browser smoke tests or manual UI acceptance claimed. Do not merge without explicit owner approval; Issue #100 remains open.
- Next: verify exact-head CI after docs sync, then continue E1 by bringing commands/ref ownership inside the session boundary, followed by the single persistence/recovery path. Keep Issues and handoff current after each meaningful increment.

---


## Follow-up checkpoint — 2026-10-20 (canonical-first root mutation audit)

- Starting point: PR #96 Draft branch `feat/dys005-root-resize-composition-command`; code checkpoint before this documentation refresh: `7c8943960cebf5adecc149e83f80024b9351117c`. Do not merge or push to `main`; no browser smoke tests.
- Root insertion planning now uses live Composition placements/tracks for occupancy. Ready insert, ripple and trim are applied as one immutable canonical command; ripple shifts linked groups via their root placement and preserves source ranges. Compatibility fallback remains only for placements absent from the root / legacy Storyboard materializations and visual snap cases where the canonical candidate set cannot return a position; final drop overlap checks use root placements.
- Master Shot Ripple Reorder is a shared Composition command that reorders/compacts canonical Master Shot placements and moves the selected Shot to its target video track. Ordinary move/drop and resize continue to call shared Composition commands.
- Clip metadata/source changes, preview transforms, mute, unlink, move, trim, split, duplicate and delete now use canonical placement commands first. Linked timing edits use move/resize commands so linked members remain atomic. Media import inserts a new canonical placement in the same history transaction as its asset/compatibility record.
- Track removal now rejects deleting the final video track, requires a fallback video track for Master Shots, preserves a video parent when removing only its linked audio child track, and still removes the linked group when deleting the parent track. App catches command errors and displays a notice instead of allowing an uncaught removal exception.
- Validated v2 import/recovery restores the saved root Composition when its deterministic compatibility projection matches the project. A validated v2 project is not re-normalized through legacy track migration; schema-1.0 input still uses the non-destructive migration path. `readProjectDocument(value, true)` exposes the validated Composition snapshot to import callers while the default result shape stays compatible with existing consumers.
- `projectRootCompositionToLegacy` now projects canonical placement/track legacy metadata (including mix/mute/transform fields) while canonical timing, source ranges and link IDs remain authoritative. Domain reconciliation may update metadata or add/remove domain items but does not overwrite existing canonical geometry/source/link state from a stale legacy migration.
- Regression coverage added/expanded in `src/projectTimelinePlacement.test.ts`, `src/compositionCommands.test.ts`, `src/projectDocument.test.ts`, and `src/App.test.tsx`: canonical occupancy beats stale legacy timing; ripple/trim preserve linked source ranges; Master Shot ripple reorder; linked-child track removal and final-video-track guard; validated canonical import; App persistence plus Undo/Redo.
- CI for the code checkpoint is [run #39470526124](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39470526124) and its earlier attempt failed only the same-layer drag-preview test; a guarded legacy snap fallback was added afterward. Exact-head CI [run #39470526124] is not sufficient for the latest code SHA. Run/check CI on the final code/docs head before reporting validation complete.
- Remaining audit: review any direct root mutation not covered by canonical wrappers, plus compatibility-only Storyboard materialization and import/save/reopen edge cases. DYS-005/DYS-014 remain in progress until exact-final-head CI passes. No browser smoke tests.
## Follow-up checkpoint — 2026-10-20 (PR #96 canonical root Composition live state)

- Starting point: PR #96 head `ab79b17b175afe8611e7cadc582223944177d505`. PR remains Draft and unmerged; no main push or browser smoke tests.
- `src/App.tsx` now initializes a live `CompositionDocument` root state and paired Composition Undo/Redo snapshots alongside project-domain history. A persisted root envelope is restored only if it validates and its complete compatibility project matches the loaded recovery payload; stale/corrupt envelopes fall back to schema-1.0 migration.
- Root Master Timeline move and resize handlers call `moveCompositionPlacementToTrack` / `applyCompositionResizePreview` directly against the live root Composition, then project committed timing, source ranges and links back to schema-1.0 project fields.
- General domain edits reconcile current root Composition to the deterministic legacy target through Composition insert/delete/move/resize and track add/update/reorder/remove commands. This covers root insertion/deletion, linked groups and track mutations without replacing the live root snapshot wholesale. `projectRootCompositionToLegacy` preserves non-timeline domain data and keeps implicit sequential Shot starts stable by materializing positions when necessary.
- Versioned save/export accepts the canonical root snapshot. Read validation checks root placement timing, duration, track, source ranges and links against the schema-1.0 compatibility projection; nested Clip Version and legacy Shot Slot snapshots remain migrated and validated separately.
- Added a regression that performs a canonical Composition move, projects to schema-1.0, saves/reopens, and verifies exact root state across Undo/Redo. Existing App integration tests cover linked audio, resize/move, deletion and project import/export.
- Validation: exact-head CI #1404 passed on code/docs SHA `90949d515d30827502e61fd4e9b1de5235037382` (230 tests, TypeScript/production build, dependency audit 0 vulnerabilities). The task registry and handoff have since been refreshed, so rerun CI on the final documentation head before treating this checkpoint as fully verified. Earlier CI failures exposed stale-envelope initialization and compatibility-validation gaps; both are fixed.
- Remaining audit: confirm all direct root mutations route through canonical commands, test root track removal/reorder and source-range/link edge cases, verify exact final SHA CI. No browser smoke tests. Keep PR Draft; do not merge or push to `main`.

## Follow-up checkpoint — 2026-10-20 (PR #96 root Composition mutation audit)

- Starting code head: `63d52bf93461ed88ce30f9612f1a44386504fcda`. Root live-state remains a known architecture gap; this checkpoint does not claim it is complete.
- `src/projectTimelinePlacement.ts`: Master Shot move now runs the shared immutable `moveCompositionPlacementToTrack` command against a migrated root Composition, then projects the committed start/duration/track back to the schema-1.0 Shot and keeps materialized Storyboard placements aligned. A guarded legacy fallback remains for malformed/unrepresentable projects.
- Exact code-head CI `39459846610` passed on `ef702113c32d11b693794c6de2b7661ad5c91fca`; full validation must be rechecked on the final docs head.
- Critical remaining work: `App.tsx` still owns `DionysusProject` as live state and root helpers still re-migrate it into Composition for each command. The root Composition is not yet the canonical live/history state, and V2 persistence still verifies a projection generated from the legacy project. Next refactor must move root edits/history/persistence to a live `CompositionDocument` and derive deterministic schema-1.0 compatibility projections from it. Add stale-projection rejection/repair, migration, nested pins and true App save/reopen/Undo/Redo regressions.
- PR #96 stays Draft and unmerged; do not push to `main`; no browser smoke tests.

# Agent Handoff Guide

This file is the starting point for any agent continuing Dionysus. Keep project knowledge in Git; do not rely on chat history as the source of truth.

## Follow-up checkpoint — 2026-10-20 (PR #96 root recovery persistence)

- Starting point was PR head `58dcec116d20bfae703b42a3fa5dc80281a2af5c`; PR #96 remains open, Draft, and unmerged.
- `src/App.tsx` local recovery keeps the established `dionysus.project.v1` key as schema-1.0 project JSON and writes the versioned 2.0 envelope (root Composition projection plus the compatibility project) to a separate `dionysus.composition.v2` key. Startup prefers the envelope only when its project ID and `updatedAt` match the legacy snapshot, preventing stale envelope data from overriding a newer project. Existing schema-1.0 localStorage values remain accepted and normalized through migration.
- Added `src/projectDocument.test.ts` regression coverage for root placement timing across save/reopen and project Undo/Redo. The tests inspect the serialized root Composition placement as well as the reopened legacy project value.
- Important limitation: this is a transitional persistence improvement, **not** canonical root live-state completion. `change()` still edits `DionysusProject`; the root Composition envelope is regenerated from schema-1.0 state. Next work must make root Composition the live editable state and update the schema-1.0 payload as a deterministic compatibility projection, then cover root command mutations, migration, pins/nesting and history.
- Exact-head CI must be checked after the final code and documentation commits. Do not claim success until that SHA's CI is complete. No browser smoke tests; keep PR #96 Draft; do not merge or push to main.

## Follow-up checkpoint — 2026-10-20 (PR #96 canonical duplication audit)

- PR #96 is still open and Draft. CI run [39453725792](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39453725792) ran on merge SHA `dd2fcd4fda2d50524aa0aab59c27b2190536915b`: all 228 tests across 23 files passed and audit found zero vulnerabilities, but TypeScript/build failed on linked-reference assertion/helper metadata types. Those type issues were corrected on code SHA `9a956d582df2f98c3615e478493eae1ab8ed4005`. Exact-head CI [39454630282](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39454630282) passed on PR head `eb5ea66cbfaec51b3cf306e66efd7f3db7a1a6b2`: 228 tests / 23 files, TypeScript and production build passed, dependency audit zero vulnerabilities. The documentation-only commits after that run require a final head/CI check.
- Fixed `duplicateClipAssetVersion()` to call `duplicateClipVersionComposition()`. The helper remaps canonical placement and track IDs, track references, linked placement/audio references, and legacy compatibility projections without mutating the source version. Embedded child compositions, pinned versions and provenance remain copied as snapshots.
- Shot duplication and Slot duplication now use the same helper rather than regenerating only `layers[].id`.
- `updateCompositionLayer()` (legacy Shot Slot inspector) now routes through `updateClipVersionLayer()`, updating canonical placements and regenerating the compatibility projection instead of writing only `layers`.
- Added unit coverage for canonical duplication, linked video/audio references, source ranges, pinned nested child/provenance preservation, source immutability, and legacy-only versions. CI 39454630282 passed at `eb5ea66cbfaec51b3cf306e66efd7f3db7a1a6b2` (228 tests/23 files, TypeScript/build, audit 0 vulnerabilities). Recheck after the latest documentation commits.
- Known limitation remains: root Composition is still a projection rather than the live editor source of truth. Continue auditing every remaining direct Shot/Slot `layers` mutation, then prioritize canonical root persistence, save/reopen, and Undo/Redo coverage. No browser smoke tests; do not merge.

## Live checkpoint — 2026-10-20

- Latest confirmed `main` commit: `5f8dbea57cc72a8b4a909db3b082ea0c54894529` (`feat: add shared Composition editing commands`), squashed from PR #93. PR #93 exact-head CI [39398098386](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39398098386) passed 210 tests across 22 test files plus TypeScript and Vite production build. Post-merge main CI [39400972426](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39400972426) and Pages deployment [39400972424](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39400972424) also both completed successfully for `5f8dbea...`.
- PR #93 routes root Timeline operation adapters and nested Clip Version moves through immutable Composition commands. This is a code/engine slice, not completion of the Timeline UI or canonical persistence.
- Current working branch/PR #94: `feat/nested-composition-command-integration`; it routes nested insertion/deletion through Composition commands and updates the nested Editor Remove layer handler. Implementation/test head `5c3d3aedda2316e5ac2adf2b46740d857d04e56a` passed exact-head CI [39402243280](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39402243280): 212 tests across 22 files, TypeScript/build passed, audit summary 0 vulnerabilities. Documentation checkpoint SHA `56afcc51dd6819a91bcbeba752bdb1f0e244d0a3` passed exact-head CI [39402541055](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39402541055), with 212 tests/22 files, TypeScript/build and 0 npm audit vulnerabilities. Always verify the current PR head and associated checks before merge. The branch is not deployed yet.
- Draft PR #88 remains snapshot-helper-only and is not wired to the Save-as-Clip UI. Draft PR #89's exact-head CI [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) failed TypeScript/build; do not merge it as-is.
- `public/doc/tasks.json` was validated on the post-PR-92 main: 20 unique task IDs, all dependencies resolve, no dependency cycles, complete required execution fields, and milestone order `M1 → M3 → M4 → M2 → M5`.
- Main-push CI and Pages workflow/deploy are verified for `5f8dbea...` (runs 39400972426 and 39400972424, both successful). This is not a claim of visual acceptance; the owner can validate the site only after the latest change is merged and deployment succeeds.
- No browser smoke tests. Never push directly to `main`; use a feature branch and one coherent PR. Keep Storyboard, References, and full Asset administration deferred until Timeline/mobile gates pass.
## Current strategic direction — Timeline-first Editor rebuild (2026-10-19)

The owner confirmed that the product should rebuild the **Timeline Editor workspace first**. It includes an Editor-local source browser for Media/Audio/Text/Effects/Transitions, Preview/Canvas in the upper-right, and the multitrack Timeline below. Storyboard and References are later planning modules that connect to a usable Editor. On mobile, the bottom toolbar is contextual to the selected element; global module navigation belongs in the project/workspace header or menu. This supersedes older mobile notes that put Storyboard / Timeline / Assets / References in the Editor's permanent bottom bar.

Read [`docs/TIMELINE_EDITOR_REBUILD_PLAN.md`](TIMELINE_EDITOR_REBUILD_PLAN.md) and [`docs/architecture/TIMELINE_EDITOR_WORKSPACE.md`](architecture/TIMELINE_EDITOR_WORKSPACE.md) before modifying Timeline UI. Rebuild the workspace and state boundary, not all project code from zero. Keep schema-1.0 compatibility and only reuse existing code after checking its tests. The current plan and live exact-head checks outrank historical continuation notes below.

The latest verified main HEAD at the start of this planning slice was `a54526fc82345c8813a6f0b770056dfe6e25a526`. PR #88 and #89 were open Draft PRs; PR #89 run [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) failed TypeScript/build after tests passed. Recheck all live PRs, issues and CI before acting; do not merge that PR as-is. No browser smoke tests.

## Read first

- Before DYS-017 production UI work, read [the UX design pack](architecture/TIMELINE_EDITOR_UX_DESIGN_PACK.md), inspect [the HTML wireframe](../public/doc/design/timeline-editor-wireframes.html), and follow [the UML overview](architecture/TIMELINE_EDITOR_UML.md) and the standalone PlantUML sources in `docs/architecture/plantuml/` (open or paste `.puml` files in PlantUML Playground). The prototype is illustrative, not implemented behavior.

1. `docs/AGENT_PICKUP_PROMPT.md` — copyable instructions for a fresh ChatGPT chat/agent.
2. `docs/PROJECT_ROADMAP.md` — complete phased roadmap, dependencies, acceptance and current pickup checkpoint.
3. `docs/AGENT_HANDOFF.md` — mandatory workflow and handoff rules.
4. `README.md` — project purpose and development commands.
5. `docs/PRD.md` — confirmed requirements, unresolved decisions, and product scope.
6. `docs/ARCHITECTURE.md` and `docs/architecture/UNIFIED_COMPOSITION_MODEL.md` — current principles and target model.
7. `public/doc/tasks.json` and linked task Markdown/HTML/report artifacts — task-dashboard source of truth.
8. Current main HEAD, open issues/PRs/branches and exact-head CI. GitHub state outranks stale checkpoint notes.

## Repository workflow

- Repository: `ckfun0skf/dionysus-ai-video-editor`
- Active redesign PR at last checkpoint: [#63](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/63), branch `feat/unified-composition-model`. Verify its current head/state before use; do not assume this is still the active branch.
- Never push directly to `main`; work on a feature branch and use a pull request.
- Keep pull requests draft until the implementation has been validated.
- Use English for source code, comments, docs, issues, PRs, and commit messages.
- Update this guide and the relevant docs when implementation status or decisions change.
- Do not claim tests or builds passed unless they were actually run and the result is known.
- Preserve user-approved decisions. Record new decisions in the PRD and explain material trade-offs.
- Do not add or run automated browser smoke tests unless the user explicitly requests them. Use unit/integration tests, type-checking, production build, and deployment status as the default validation path.
- Keep all durable project knowledge in version control. Avoid instructions that exist only in chat.
- Preferred user communication language is Hong Kong Cantonese (`zh_hk`), while all code, docs, and git commits remain in professional English.

## Efficient Agent Workflow: Batch Work, Commits, and CI

This section is mandatory for every agent and every new chat. Optimize for validated, coherent feature slices—not the number of messages, commits, or CI runs.

### Before editing
1. Read this guide, the relevant PRD/architecture/spec, current task dashboard data, and the active PR/branch.
2. Confirm the current `main` SHA, feature branch head, PR state, and newest CI result. Do not assume a previous chat's status is still current.
3. Turn the request into a small, complete vertical slice with explicit acceptance checks. Inspect existing implementation before changing it; do not make speculative edits across unrelated files.

### Implementation and commit policy
- Work on a feature branch; never push directly to `main`.
- Make related code, tests, translations, task status, and documentation changes together in a coherent batch.
- **Do not create one commit per file or per tiny edit.** Avoid GitHub Contents API file-by-file updates when each update creates its own commit. Prefer a local working tree and one normal Git commit, or create a single Git tree/commit for a multi-file batch when using GitHub APIs.
- Default to one meaningful commit for a completed feature slice; use a small number of commits only when they represent genuinely separate, reviewable milestones (for example, foundational model/tests followed by the UI workflow). Do not rewrite shared branches; only rewrite your own feature branch when necessary and use a lease/expected-head check.
- Commit messages should describe the change, not the activity (for example, `feat: add reusable clip timeline workflow`).
- Before pushing, inspect the diff and run the cheapest relevant local checks available. If no local checkout/runtime is available, say so plainly and use CI as the verification source; never claim a local test was run when it was not.
- Do not create redundant PRs. Keep one active PR per coherent feature unless a clear dependency or release boundary requires otherwise.

### CI and deployment policy
The current CI workflow is intentionally configured to run for:
- `pull_request` targeting `main`
- `push` to `main`
- manual `workflow_dispatch`

Feature-branch pushes should not independently trigger a second full CI run. A PR may receive a PR validation run, and merging to `main` intentionally triggers post-merge validation. The workflow's concurrency group cancels stale runs for the same PR/ref when a newer run supersedes them.

- Do not manually rerun a still-running or already-passing check without a specific reason.
- After pushing, inspect the latest run for the **current exact head SHA**; verify test, type-check/build, and audit output. An older green run does not validate a newer commit.
- Wait for the latest required PR checks before merging. After merge, verify the main push CI and GitHub Pages deployment separately when the task includes release/deployment.
- Do not add automated browser smoke tests or browser automation unless the user explicitly asks; this project uses deterministic tests, type-checking, build, and deployment status as the default verification path.
- Keep CI changes narrow. Do not add redundant workflows or triggers to compensate for a stale or misunderstood run.

### Handoff and reporting
- Record durable decisions, changed files, commit/PR links, exact validated SHA, test/build/audit results, and any remaining risks in Git. Update `public/doc/tasks.json` and its task/spec/report artifacts for major feature blocks.
- Clearly distinguish automated checks, actual UI/browser verification, and deployed behavior. Never describe a PR branch as deployed before merge and a successful deployment.
- Report concise evidence and the next concrete action. If a tool/API limitation prevented a check, state that limitation instead of guessing.
- If a chat is getting long, update the Git handoff/status documents before switching chats. The next agent should be able to continue from Git alone without relying on the previous conversation.

## Product Mission & User Core Requirements

Dionysus supports the full AI-video production cycle: story planning, references/media preparation, generation, version selection, composition editing and reuse.

### Target model (supersedes earlier Shot-Slot assumptions)

- Storyboard Shot: narrative/production identity, target duration, generation instructions, required inputs/references and alternatives for concrete generated shot-video outputs; not a nested timeline.
- Shot Version: one generated shot-video output (or visible pending/failed state) with provenance.
- Media Asset: identity of imported/generated source media.
- Composition: ordered Tracks and Timeline Placements. Project Master Timeline is the root Composition; a Clip Asset is a reusable, versioned Composition.
- Placement: use of a typed source with a pinned version where applicable; owns track/time/source-range/transform/mix state only.
- One shared Editor/placement engine serves root and nested Compositions. Context-specific actions/settings may differ; mechanics must not.
- Add Track at every level offers Video, Audio and Text. Image, video, Shot, Code/procedural and Clip are content/source types.
- Save-as-Clip preserves tracks, placements, ordering, timing/source ranges, nested relationships and pinned versions. It is not a render, flat layer list or live link.
- Storyboard order is narrative planning, not timeline time. Build/update is explicit, previews a diff, and never silently rewrites manual edits.
- Production Tasks are dependency-aware requests; Generation Runs preserve each attempt's effective prompt/settings/reference snapshot. Copy-prompt/manual-import works before API integration.

### Current architecture transition

Main still uses legacy `schemaVersion: "1.0"` (`Shot.slots[]`, nested `ClipVersion.layers[]`, root `timelineClips[]` and materialized `storyboard-*` placements). The target is documented but not migrated. Do not claim current save-as-Clip preserves the whole Project structure until code and regression tests prove it.

## Task Tracking & Progress Monitoring

- Dashboard source: `public/doc/task.html` (served at `/doc/task.html`, with redirect from `/docs/task.html`).
- Task data: `public/doc/tasks.json`.
- The user uses `task.html` to monitor project progress across milestones. Always keep `public/doc/tasks.json` up to date when delivering major feature blocks.

## Safe Local Validation

```bash
npm install
npm test
npm run build
npm run dev
```

## Handoff Checklist for Next Agents

- [x] Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, and this file.
- [x] Maintain user communication in `zh_hk`, technical implementation in English.
- [x] Run `npm test` and `npm run build` before claiming completion.
- [x] Keep `public/doc/tasks.json` in sync for the user's progress monitoring dashboard.
- [x] Do not create redundant PRs or unneeded markdown sprawl; prioritize real features in the applet.





## Verified checkpoint — 2026-10-19

- Main HEAD: `288b5f349080c470a119c33174dfaa93c0e8c9f0`; main CI [39199996042](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39199996042) and Pages deployment check [39199996049](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39199996049) succeeded.
- Draft PR #63 branch head: `3826f84cd529ad2461a07f26ab83adf7a5a5b526`; exact-head CI [39221701720](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39221701720) passed tests and TypeScript/Vite build. No browser smoke tests were added or run.
- Latest code change hardens `readProjectDocument()`: schema-2.0 compatibility envelopes must identify the same project and expected root Composition, with regression tests for cross-project and root-ID mismatch. Schema-1.0 remains the authoritative editable payload.
- #53 and #54 remain open pending user acceptance. Save-as-Clip still flattens legacy composition layers; structure-preserving snapshots are not complete. The PR is not deployed.
- Next implementation slice: migrate root/nested editor state to canonical Composition documents, then replace flattened Save-as-Clip with an independent structure-preserving snapshot. Keep DYS-014 in progress until regression tests prove round-trip and snapshot independence.


## Current Pickup Checkpoint — 2026-10-18

- Roadmap and copyable prompt: `docs/PROJECT_ROADMAP.md` and `docs/AGENT_PICKUP_PROMPT.md`.
- Last verified main baseline: `288b5f349080c470a119c33174dfaa93c0e8c9f0`.
- Active Draft PR: [#63](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/63), branch `feat/unified-composition-model`; checkpoint head before this handoff update: `406d898ad5176cc2ed55441b3ed502c67db5f7a5`.
- Last verified CI for that checkpoint: [39207371506](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39207371506), success. Re-check CI after any newer commit.
- PR #63 now contains the first DYS-014 runtime slice as well as the architecture contract. The new adapter is not wired into project import/export or the live editor yet; no deployment or end-to-end migration is claimed.
- Current implementation slice: `src/compositionModel.ts`, `src/compositionMigration.ts`, and `src/compositionMigration.test.ts` define the canonical projection and initial regression fixtures. Check exact-head CI before relying on the slice. Next: integrate the projection into import/export behind a deterministic migration boundary, then unify editor operations.
- User acceptance of #53/#54 remains pending. No browser smoke tests.
- Open issues last checked: #53, #54, #56, #58 and #59. Re-query GitHub before starting work; never treat this list as live status.

## Current Architecture Transition — 2026-10-19

- Follow-up for #54: ordinary timeline clip drop/resize calculations now use the same occupancy set as Master Shots. Resizing an ordinary clip can trim an adjacent Master Shot in the same history transaction. Master Shot drag source is retained in a ref so preview/drop still work when the browser protects DataTransfer contents during dragover.
- Both Master and nested Clip Timeline Add layer menus now expose only Video, Audio and Text. The nested legacy editor's Image/Code/Clip choices have been moved into a separate Add content menu. This aligns the visible track choices, but the underlying root/nested editor data and operations still need full unification for #53.
- Added App-level regression coverage for protected Master Shot drag data, normal-clip-vs-Master-Shot drop collision, cross-model resize trimming/Undo, and the three allowed track types. Check exact-head CI before relying on this patch.


- DYS-014 implementation slice added to PR #63: typed canonical Composition/Track/Placement/source references plus a non-mutating schema-1.0 projection for the root timeline, every Clip Asset Version, and every legacy Shot Slot Version. Master Shots are first-class root placements; duplicate materialized `storyboard-*` placements are deduplicated.
- Initial migration tests cover track/placement IDs and order, source ranges, linked audio, Shot Slot and Clip Version pins, nested layer mapping, duplicate materialized Storyboard placement detection, missing-source warnings, determinism and source immutability.
- This is a projection adapter, not yet a replacement persistence schema; project import/export and live editors still use schema 1.0. CI status must be checked for the exact latest PR head.

## Current Architecture Transition — 2026-10-18

- Baseline at redesign start: `288b5f349080c470a119c33174dfaa93c0e8c9f0`. PR #61 CI and Pages deployment passed, but #53/#54 remain open following the user's latest acceptance feedback.
- Treat root/nested parity as a data/operation model issue, not CSS-only: Master Shots and ordinary placements still use different data paths.
- Target contract: `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`; implementation has not yet migrated.
- DYS-014 owns unified Composition and structure-preserving Project-to-Clip snapshots. DYS-015 owns Production Tasks and Generation Run provenance.
- Coordinate DYS-002, DYS-004, DYS-005 and the DYS-013 existing Clip Asset slice. Avoid expanding parallel Shot/Clip version models.
- #56 remains planned asset-management scope. #58 remains independent. #59 settings need Project/Composition/Track/Placement scopes.
- Do not add or run browser smoke tests unless explicitly requested.


## Latest Timeline Interaction Slice — 2026-10-19

- Code/test checkpoint: commit `a98655c9263bfa033575d6d6c01109bc5dfba94b`; exact-head CI [39227084457](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39227084457) passed tests, TypeScript and Vite build.
- Nested Clip/Version Timeline now uses `src/nestedTimelinePlacement.ts` and the same frame-aligned drop/resize calculations as the existing Master Timeline placement engine. Dragging shows a destination preview and snap guide, compatible cross-track moves are allowed, and same-track overlaps are rejected.
- Both nested clip edges now have resize handles. Resizing shows the grey dashed affected-overlap region, trims the adjacent nested layer when a valid one-frame remainder is possible, and commits the target/neighbor change in one project-history transaction. `src/nestedTimelinePlacement.test.ts` and `src/timelineResize.test.ts` cover placement/resize and short-neighbor edge cases.
- Nested track/ruler columns now follow the Master Timeline's responsive grid. This closes a visible/interaction parity gap, but it does **not** yet make schema-2 Composition the live authoritative editor state; the root and nested persistence models remain legacy schema 1.0, and Save-as-Clip still needs structure-preserving snapshots.
- PR #63 was merged to `main` as `9da2f2bfbf7e80abb73f5552a0d1447cff471c0b`. Main CI [39227655141](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39227655141) and GitHub Pages deployment [39227655137](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39227655137) both succeeded for that exact SHA; deployed URL: https://ckfun0skf.github.io/dionysus-ai-video-editor/.
- Issues #53/#54 were closed as fixed at the owner’s direction on 2026-10-19. The current follow-up is a separate Add Clip insertion-overlap bug: an asset must not be inserted directly at the playhead without an empty-position check. PR #65 merged this fix as `990158fc70cf0e6fe17a994237c1b0d65b7d60fb`; main CI [39233639480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39233639480) and Pages deploy [39233639536](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39233639536) passed for that exact SHA. Add Clip now uses click-to-place and prompts Ripple-later / Trim-new-clip when the gap is too short.



## Active Follow-up — Safe Click-to-Place Timeline Insertion (2026-10-19)

- Base main/deployed SHA: `32627ff1b9ee14622012ddbc9738597e1ffe76ad`; CI [39228253526](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39228253526) and Pages deploy [39228253519](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39228253519) passed.
- Working branch: `feat/click-to-place-timeline-clips`. Do not claim deployment until the code PR is merged and a Pages deployment for its resulting main SHA passes.
- Root timeline Add Clip no longer needs to add immediately at the playhead. After selecting an asset, the user clicks a blank point on a compatible track. Insertion planning is frame-aligned and checks occupancy across ordinary clips and Master Shots before any mutation.
- If the insertion would collide with a later clip, the planned dialog offers **Push later clips back** or **Trim the new clip to fit**. Ripple keeps linked audio and affected Shot/materialized Storyboard media synchronized; derived runtime expands to the new final end. Each resolution is applied as one project history change for one-step Undo.
- Regression scope: pure insertion planner tests cover free gaps, occupied points, trimming, ripple, linked audio, Master Shot/materialized media and automatic timeline expansion. App integration test selects an asset, clicks a timeline point that has too little room, then verifies the prompt and ripple result without overlap. No browser smoke tests.
- Product model answers to preserve: adding a Storyboard Shot creates a Shot Slot and empty Slot Version; it does **not** create a separate reusable `Asset.kind === "clip"`. Clip Assets support duplicating an existing version; the current UI has no separate empty-version command for an existing asset. Shot/Slot Version and reusable Clip Asset Version are still distinct legacy models; DYS-014 has not completed canonical Composition persistence or structure-preserving Save-as-Clip. Do not auto-create linked duplicate Clip Assets from Storyboard Shots without an explicit product decision.
- Next: verify exact-head CI; fix any test/build failures; open PR, merge only after passing CI; verify exact-sha Pages deployment. Then update this checkpoint and task dashboard before asking the owner to try it.


## Current main release and next Clip Version slice — 2026-10-19

- Latest functional code release SHA: `ee1f90c3304ce0f2be5cef294c387192d2aa8969`; main CI [39234313896](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313896) and Pages deployment [39234313840](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313840) passed. Public URL: https://ckfun0skf.github.io/dionysus-ai-video-editor/. Re-query live `main` on pickup; later documentation checkpoints may advance Git HEAD without changing these app features.
- PR #65 implements safe click-to-place insertion. On the target track, a blank-point click is frame-snapped and occupancy-checked. A short gap prompts Ripple later placements or Trim the new clip; linked audio and affected Shot/Storyboard items stay in sync. Runtime end is derived from the final placement, so it expands naturally. The operation remains one Undo unit.
- Issues #53/#54 were closed at the owner's direction; don't reopen them for this separate Add Clip bug.
- PR #66 shipped **New Blank Version** beside **Duplicate Version** for reusable Clip Assets. It retains the Clip Asset's duration and track layout (with fresh track IDs), starts with no layers, activates the new version, and leaves prior versions untouched. Feature code SHA `ee1f90c3304ce0f2be5cef294c387192d2aa8969` passed main CI [39234313896](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313896) and Pages deployment [39234313840](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313840).
- Data-model status remains explicit: a new Storyboard Shot creates a Slot/Version but does not create a separate `Asset.kind === "clip"`; Clip Asset Versions and Shot Slot Versions are still different legacy entities. DYS-014 still owns canonical Composition persistence and structure-preserving Save-as-Clip. Don't create one duplicate reusable Clip Asset for every Shot without a specific owner decision.
- No browser smoke tests are added or run.


## Mobile-first product requirement — 2026-10-19

The owner wants a future phone version with a CapCut-inspired interface. Treat this as a product requirement, not a one-off CSS tweak.

- First target: responsive mobile web, sharing the same project schema and editing operations as desktop; do not assume a separate native app.
- Phone hierarchy: preview first, timeline immediately below, large touch controls, contextual clip tools, and a persistent bottom navigation for Storyboard / Timeline / Assets / References.
- Horizontal timeline panning belongs inside the timeline viewport; avoid whole-page horizontal overflow. Respect safe-area insets and leave room for bottom navigation.
- Preserve advanced multi-track, linked audio, procedural layers, nested Clip Versions, and version pinning. Simplify presentation, not the underlying project capability.
- DYS-012 is the tracking task. The current responsive CSS slice is only a foundation; do not claim full mobile editing until selection, scrubbing, version switching, portrait/landscape layout and viewport checks are covered.
- Do not add or run browser smoke tests. CI tests/build and Pages deployment are required; manual acceptance remains separate and must not be claimed without evidence.


## Mobile editing progress — 2026-10-19

- PR #68 merged the responsive mobile layout foundation as main commit `3513d51f9a52599e0231d8cb4db884cc59e5d611`. Its exact-head PR CI passed at `aca468fb345b523361467ae8da66b42d1207904a` in run [39236495588](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39236495588). Main push CI and Pages deployment still require independent confirmation before the owner is asked to test.
- Active follow-up branch: `feat/mobile-timeline-touch-drag`. It adds a 260 ms long-press gesture for moving Master Timeline clips by touch, while short swipes pan the timeline horizontally or the page vertically. Desktop HTML drag-and-drop remains intact. A component regression test covers touch move placement.
- DYS-012 remains in progress. Nested Clip Version touch dragging, mobile Inspector/Version picker ergonomics and viewport acceptance remain outstanding. Do not claim the whole phone editor is complete; do not add or run browser smoke tests.


## Nested mobile timeline gestures — 2026-10-19

- PR #69 merged touch long-press movement for Master Timeline clips as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; exact-head CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed at `31ed8795ef883e556285eecd6ab7073bee094a87`.
- Active branch `feat/mobile-nested-timeline-touch` extends the same 260 ms long-press / short-swipe behavior to nested Clip Version layers. It uses the existing version placement engine and has a component regression test; exact-head CI is pending.
- Main push CI and Pages deployment have not yet been independently confirmed. Do not ask the owner to test until the latest Pages deployment is confirmed.


## Mobile contextual tools — 2026-10-19

- PR #70 merged nested Clip Version touch movement as main commit `fd51602f92640cf18ad426a418bb7c8d8cb39207`; exact-head CI run [39237693258](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237693258) passed at `1b1da31e6cec749f3888385ea5c201183c4facba`.
- Active branch `feat/mobile-contextual-editor-tools` adds a phone-only selected-clip toolbar (Split, Duplicate, Trim, Settings, Delete), a working Inspector toggle/close action, and larger nested Clip Asset version selector controls. Exact-head CI is pending.
- Main push CI and Pages deployment remain independently unconfirmed. Do not ask the owner to test until the latest Pages deployment is confirmed. No browser smoke tests.


## Mobile timeline zoom — 2026-10-19

- PR #71 merged contextual clip tools and mobile Inspector toggle as main commit `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`; exact-head CI run [39238524459](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238524459) passed at `19eda997ad20a8a38d6b1e63345f03bccf9eb09e`.
- Active branch `feat/mobile-timeline-zoom-controls` adds phone-only Zoom In / Zoom Out / Fit controls. The root and nested timeline scroll surfaces scale their track width together; zoom changes presentation only, not clip timing or project data. Includes an integration test.
- Main push CI and Pages deployment remain independently unconfirmed; do not ask the owner to test until deployment is confirmed. No browser smoke tests.


## Mobile trim ergonomics — 2026-10-19

- PR #72 merged phone-only Zoom In / Zoom Out / Fit controls as main commit `f57b5ad3ffe5b80bd586b513fc2fc1e201898cf8`; exact-head CI run [39238940480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238940480) passed at `2ce2e57f9a4360c6f438a56d721625cb54081947`.
- Active branch `feat/mobile-touch-trim-handles` expands mobile clip/Shot trim hit targets and adds a component test that resizes a Master Timeline clip with a touch pointer. Exact-head CI is pending.
- Main push CI and Pages deployment remain independently unconfirmed. Do not ask the owner to test until deployment is confirmed; no browser smoke tests.


## Mobile editing checkpoint — preview history controls (2026-10-19)

- Main includes PR #79 frame-accurate keyboard scrubbing at `0a5ace89e28fff5d1f46bc0e4330d56e91f9035e`.
- Active branch: `feat/mobile-preview-undo-redo`. It exposes Undo/Redo beside the mobile preview controls and adds an App test for duplicate → Undo → Redo.
- Keep DYS-012 in progress. Do not claim device/viewport acceptance, and do not add/run browser smoke tests. After PR CI passes, merge through PR, verify main CI and GitHub Pages deployment, then update this checkpoint with exact run IDs.


## Mobile editing checkpoint — audio mute (2026-10-19)

- PR #80 merged mobile preview Undo/Redo at `85646e4a70cdde113bee728b4ed1cd781a022f0a`; exact-head CI run `39248435319` passed.
- Active branch: `feat/mobile-audio-clip-mute`. It adds a Mute/Unmute action for selected audio clips on the phone toolbar and an App integration test for persisted state.
- Keep DYS-012 in progress. After exact-head CI passes, merge through PR and verify main CI/Pages deployment. No browser smoke tests; do not claim viewport acceptance without evidence.


## Mobile editing checkpoint — visible audio mute state (2026-10-19)

- PR #80 merged preview Undo/Redo; exact-head CI `39248435319` passed.
- PR #81 merged selected-audio Mute/Unmute at `7ba96ec0eae8d6e3fb2196d7b9f492e293ff10e2`; exact-head CI `39249271916` passed.
- Active branch: `feat/mobile-audio-mute-state`. It makes muted audio visibly selected and tests `aria-pressed` state.
- Main push CI and Pages deployment remain unverified by the available Actions listing. Do not claim viewport/device acceptance; no browser smoke tests.


## Current owner feedback — Issue #83
The owner reports the mobile timeline UI is broken: some buttons look unstyled, layer controls overflow, and the screen is too busy compared with CapCut. Current follow-up branch `fix/mobile-timeline-layer-actions-v2` consolidates Master Timeline layer actions, styles touch controls, and reduces toolbar density. Keep this work on a PR, do not add/run browser smoke tests, and do not ask the owner to test until main CI and Pages deployment are confirmed.


## Fresh mobile pickup — 2026-10-19

Use [`docs/MOBILE_AGENT_PICKUP_PROMPT.md`](MOBILE_AGENT_PICKUP_PROMPT.md) and [`docs/MOBILE_AGENT_HANDOFF.md`](MOBILE_AGENT_HANDOFF.md) as the focused next-chat entry point. They supersede the stale mobile-specific branch notes earlier in this file; always verify live GitHub state before acting.

- Main baseline at this checkpoint: `a83f4a6836d7c4ee683b17a1ccdb5897e17364e2`.
- PR #84 merged the Issue #83 mobile layer action/style correction; exact-head CI [39252298875](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39252298875) passed.
- Issue #83 is closed by PR #84, but deployment and owner acceptance are not implied. Independently verify main push CI and GitHub Pages deployment before asking the owner to test.
- DYS-012 remains in progress. Do not add/run browser smoke tests. Next work is a coherent CapCut-inspired mobile usability/viewport pass, then resume DYS-014 canonical Composition persistence and structure-preserving Save-as-Clip.


## Mobile preview control release and DYS-014 pickup — 2026-10-19

- PR #86 merged the progressive-disclosure preview-control slice as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`.
- Exact-head feature CI [39259760793](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259760793), main push CI [39259981315](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981315), and GitHub Pages deployment [39259981194](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981194) all passed. This proves automated build/deployment, not device-level UX acceptance.
- On phones, history/playback/start/frame-step stay prominent; +0.5s, the playhead slider, overlay and optional image clear are progressively disclosed. No browser smoke tests were added or run.
- DYS-012 remains in progress pending owner evidence for phone portrait, landscape, tablet, touch interactions and page-level overflow.
- Next implementation branch: `feat/dys014-alternative-provenance-roundtrip`. The current slice adds migration tests for all Shot Slot alternatives and generation/reference/model/output provenance, plus JSON round-trip tests for schema-1.0 and the versioned 2.0 envelope. Exact-head CI is required before calling that test slice validated.
- After these checks, resume canonical-only Composition persistence and structure-preserving Project-to-Clip snapshots. Do not auto-create duplicate Clip Assets per Shot without an explicit owner decision.

## Current DYS-005 pickup — nested resize command slice (2026-10-20)

- Current main base: `8df0348d75965dd78cafe02bc1db9063bf9d323a`. Working branch: `feat/dys005-nested-resize-composition-command`; it is separate from the existing Draft PR #94 and must be opened as its own Draft PR unless a maintainer explicitly asks to stack it.
- `applyCompositionResizePreview()` in `src/compositionCommands.ts` accepts a primary resize plus adjacent trims, applies them as one immutable command, keeps `legacyData` synchronized, and expands each resize to its linked group so linked audio cannot drift from video timing or source range.
- `applyClipVersionResizePreview()` in `src/clipVersionTracks.ts` adapts the canonical result to the transitional nested Version layers. `src/nestedTimelinePlacement.ts` retains frame-snapped preview calculation only. The App still performs one `updateTimelineVersion()` history transaction for the release gesture.
- Focused local validation passed 18 tests across `src/compositionCommands.test.ts`, `src/nestedTimelinePlacement.test.ts`, and `src/clipVersionTracks.test.ts`; full local validation passed 214 tests across 22 files, TypeScript, and the Vite production build with Node 24. `npm audit` cannot run because this repository has no lockfile. Record exact-head PR CI before publishing. No browser smoke tests.
- Remaining DYS-005 gates: project-aware Master insertion/conflict dispatch through shared commands; end-to-end root/nested Undo grouping/history parity; canonical-only persistence; and DYS-014 structural Save-as-Clip. Keep Storyboard and References deferred. Do not request incremental visual checks; the owner wants one consolidated verification only after a usable Timeline milestone is merged and deployed.


## Latest pickup checkpoint — 2026-10-20

- Active work: Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), branch `feat/dys005-root-resize-composition-command`. Do not merge or deploy until the current PR head has exact-head CI and code review.
- The branch retains the DYS-005 nested resize/source-range/adjacent-trim implementation, excludes accidental `node_modules/` and `dist/` artifacts, and adds root resize via `applyCompositionResizePreview()` plus ordinary root insertion via `insertCompositionPlacement()`. Root resize projection updates linked descendants in the legacy project representation; duplicate insertion IDs are rejected. Compatibility fallback remains for materialized Storyboard placements and invalid legacy projections.
- Code/test SHA `a177d5c5e8109bb5481d9025b237cebbc6f0d1db` passed exact-head CI [39418281655](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39418281655): tests, TypeScript/production build, and the workflow's non-blocking dependency-audit step succeeded. Later documentation commits require a new exact-head CI check before merge.
- Task records updated in `public/doc/tasks.json`, `public/doc/tasks/timeline-and-versions.md`, `public/doc/tasks/timeline-and-versions.html`, and `docs/TIMELINE_FIRST_EXECUTION_BACKLOG.md`. DYS-005 remains in progress; DYS-014 structure-preserving Save-as-Clip is not complete.
- Next code slice: route root/nested move, split and duplicate through the shared Composition commands; add tests for root/nested parity and one-step Undo/Redo, then tackle canonical-only persistence and Save-as-Clip. Keep Storyboard/References redesign deferred until Timeline is usable.
- No browser smoke tests, no direct push to `main`, no merge without current exact-head CI. Owner requested one consolidated visual acceptance after a coherent Timeline milestone is merged and Pages deployment is verified.


## Current checkpoint — 2026-10-20 (root move integration)

- Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), branch `feat/dys005-root-resize-composition-command`, now routes valid root resize, ordinary root insertion and ordinary root clip moves through shared Composition commands. Linked descendants are synchronized back to the transitional project state, source ranges are preserved, and duplicate placement IDs are rejected.
- Code/test SHA `5cb79b8c5a2debd11008567630d0460bd5858737` passed exact-head CI [39419176885](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39419176885): tests, TypeScript/production build and the workflow's non-blocking dependency-audit step succeeded. Documentation changes require another exact-head CI check before merge.
- Remaining: root/nested split and duplicate parity, atomic Undo/Redo grouping, canonical-only persistence and DYS-014 structure-preserving Save-as-Clip. Compatibility fallback remains for materialized Storyboard placements and invalid legacy projections.
- Next: route root/nested split and duplicate through shared commands, add parity/history tests, then proceed to canonical persistence. No browser smoke tests, no direct main pushes, no merge without latest green CI.


## Current checkpoint — 2026-10-20 (atomic linked split history)

- Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), branch `feat/dys005-root-resize-composition-command`.
- Added a project-history regression for splitting a linked video/audio group. It asserts one undo snapshot contains the complete split, Undo restores the original pair, and Redo restores the complete four-placement result with source ranges and links intact.
- Exact-head CI [39421375204](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39421375204) passed at code/test SHA `b3ef901c8eaa3a193d4cbc47ac39a5d6274dbfe3`: 217 tests, TypeScript and production build passed. The workflow dependency audit is non-blocking and does not establish a standalone audit pass.
- Next code work: audit Timeline UI handlers for atomic history grouping, define a canonical Composition persistence boundary, and implement structure-preserving Save-as-Clip without flattening nested compositions. DYS-005/DYS-014 remain in progress.
- No browser smoke tests, no direct push to `main`, no merge without current exact-head CI and review. Owner wants one consolidated visual acceptance after a coherent Timeline milestone is deployed.


## Current checkpoint — 2026-10-20 (structure-preserving Save-as-Clip foundation)

- Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), branch `feat/dys005-root-resize-composition-command`.
- Replaced the Master Timeline Save-as-Clip implementation that only flattened renderer layers and regenerated every layer ID. The new `src/clipVersionSnapshot.ts` saves the migrated root Composition tree, tracks, placement order, source in/out, transform/mix legacy fields, exact nested Clip Asset version references, selected Shot Slot Version pins, generation records and script-version IDs.
- The snapshot recursively embeds the selected nested Clip Version Composition documents and selected legacy Shot Slot Version Composition documents. `CompositionDocument.provenance` records the source project/composition and snapshot time; `nestedCompositions` preserves child documents. The flattened `layers` array is deliberately retained as a compatibility/render projection.
- Regression tests cover source immutability, track/order and source-range preservation, transform/mix metadata, nested Clip Version pins, selected Shot Slot Version pins, generation provenance, embedded child composition structure, independence from later source-layer mutation, and JSON serialization/reload.
- Code/test SHA `30afa93ea6ff9f6086229b4fd7bd9daba6a02796` passed exact-head CI [39425783751](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39425783751): 219 tests across 23 files, TypeScript and production build passed. The workflow's dependency-audit step is non-blocking. Documentation commits after this code/test SHA require checking their own exact-head CI before merge.
- Important remaining limitation: the current nested editor still primarily edits the compatibility `layers` projection. The canonical tree is now persisted in snapshots, but full canonical-authoritative edit/open/save synchronization and UI round-trip parity are **not complete**. Do not mark DYS-014 complete or merge without reviewing this boundary.
- Next: define canonical placement-to-editor adapters that edit nested Composition documents without flattening shot/slot hierarchy; synchronize all edits back into the tree; add edit/save/reopen tests and prove source-version pin immutability. DYS-005/DYS-014 remain in progress.
- No browser smoke tests, no direct push to `main`, no merge without current exact-head CI and review. Owner wants one consolidated visual acceptance after a coherent Timeline milestone is deployed.


## Current checkpoint — 2026-10-20 (canonical nested editing adapter)

- Active Draft PR: [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), branch `feat/dys005-root-resize-composition-command`; no merge.
- `src/clipVersionTracks.ts` now treats `ClipVersion.composition` as the authoritative document when present. `normalizeClipVersionTracks()` derives the compatibility `layers` and `tracks` projections from that canonical document instead of allowing stale legacy arrays to overwrite it.
- Nested insert, move, resize/adjacent trim and delete operations now operate on the canonical Composition document and write both the updated document and derived legacy projections. Newly created tracks are inserted into both the canonical track list and the projection.
- Added `updateClipVersionLayer()`; inspector changes to placement name, source, timing, transform and mix are written into canonical placements and legacy metadata together. Source references remain unchanged for transform-only edits, and Shot Slot, Clip Asset and Script source references are preserved when edited.
- Nested Clip Version duration controls now update the stored Composition duration too. Composition child documents and provenance are retained by immutable updates.
- Regression coverage includes canonical-over-stale-projection behavior, inspector-to-placement synchronization, nested snapshot/provenance preservation, source reference preservation, newly added canonical tracks, and the existing insert/move/resize/delete tests.
- Exact-head CI at code SHA `c82f305726afaacb424d9bf8e39c0fac37de5fc4` passed [workflow 39428872953](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39428872953): 222 tests across 23 files, TypeScript, production build and the configured dependency audit (0 reported vulnerabilities).
- Remaining: verify the complete Save-as-Clip → edit nested content → JSON save/reload → reopen workflow, explicit Undo/Redo for canonical nested edits, and immutable pin semantics across source-version changes. Also review the canonical migration/legacy shot-slot behavior before declaring DYS-014 complete. DYS-005 and DYS-014 remain in progress.
- No browser smoke tests were run or added. Do not push to `main`; do not merge without review and current exact-head CI. Visual acceptance remains a later consolidated owner review after a coherent Timeline milestone.


## Current checkpoint — 2026-10-20 (Save-as-Clip edit/reopen regression)

- Added an integration regression for the end-to-end data contract: create a structure-preserving Master Timeline snapshot, edit a nested placement through the canonical adapter, serialize/reload the project JSON, reopen/normalize the saved Clip Version from its Composition document, and assert placement timing/transform/mix, source ranges, pinned child Composition and provenance remain intact.
- The regression also verifies the source Clip Asset Version remains unchanged after editing the snapshot.
- Exact-head CI at code/test SHA `7098229556fd466283a2e815de2ab44778089483` passed [workflow 39429740312](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39429740312): 223 tests across 23 files, TypeScript, production build and dependency audit (0 vulnerabilities).
- This proves the tested JSON round-trip for the covered snapshot/edit path, not every UI/history path. Canonical nested Undo/Redo, complete source pin immutability under all edit routes, and legacy migration/Shot Slot compatibility still require review. DYS-005/DYS-014 remain in progress.
- PR #96 remains a Draft and is not merged. The docs/task registry must be refreshed at the final tested head and its exact-head CI must pass before the PR is considered ready. No browser smoke tests.


## Follow-up fix — 2026-10-20 (preserve unchanged typed source refs)

The App inspector now passes only fields actually changed by the user into `updateClipVersionLayer()` instead of passing the entire reconstructed layer. This is important because transform-only edits must not be interpreted as source replacement; the adapter now preserves the exact canonical source reference for unrelated edits and only rebuilds the source reference when a source-related field changes. Duration edits still include the fade values after clamping.

Exact-head CI at code SHA `47b700ea44937dbb8bfb6c35fbcf9efe690d4416` passed [workflow 39430375517](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39430375517): 223 tests/23 files, TypeScript/build and dependency audit (0 vulnerabilities). Full PR-head CI must be rechecked after documentation changes.


## Canonical nested Timeline editor checkpoint — 2026-10-20

- Current branch head before this documentation update: `bbbbf18743a66de4ba66c14b9cde98bd9d490238`. Draft PR [#96](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/96), `feat/dys005-root-resize-composition-command`.
- `src/clipVersionTracks.ts` now treats an existing `ClipVersion.composition` as authoritative when normalizing and editing nested timelines. The legacy `layers` and `tracks` are derived compatibility/render projections, rather than the source used to reconstruct canonical state on every edit.
- Nested add/delete/move/resize and track-add paths update the Composition document and then refresh compatibility projections. `updateClipVersionLayer()` synchronizes inspector edits (name, timing, source ranges, source reference, transforms, mix/fades and other legacy fields) into the canonical placement. Typed Shot Slot and script source references remain pinned during unrelated transform edits. New tracks are written to canonical tracks.
- Regression coverage now checks stale compatibility data loses to canonical data, placement timing/source ranges and transform/mix stay synchronized, nested composition/provenance survives edits, added tracks/placements update the canonical tree, typed shot/script references survive inspector changes, and prior source documents remain unchanged. Existing Save-as-Clip snapshot → edit → JSON save/reload → reopen and source-version isolation coverage remains in place.
- Exact-head CI [39431744433](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39431744433) passed on `bbbbf18743a66de4ba66c14b9cde98bd9d490238`: 223 tests across 23 files, TypeScript and production build passed; dependency audit reported 0 vulnerabilities. No browser smoke tests were added or run. This is code/CI evidence, not visual acceptance or deployment.
- Remaining: audit all nested editor command paths for canonical parity, add explicit nested Undo/Redo and broader pin/migration regression, and check legacy Storyboard/Shot Slot editing that still directly mutates `layers`. Timeline-first scope does not mean Storyboard is complete; keep DYS-005 and DYS-014 in progress. Exact-head CI must be rerun after this documentation commit. Do not merge without review.


## Canonical migration/subtree preservation checkpoint — 2026-10-20

- Code/test head `920ad9e5f3d0d290182b82e5e772ecbc1abe4694` passed exact-head CI [39445108693](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39445108693): 223 tests across 23 files, TypeScript and production build passed, dependency audit 0 vulnerabilities.
- Fixed `src/compositionMigration.ts`: when a Clip Version or legacy Shot Slot Version already has `composition`, migration now preserves that canonical document (including placement order, tracks, source ranges, transform/mix metadata, pinned nested children and provenance) rather than rebuilding it from compatibility `layers`. Version description, script version IDs and generation records are synchronized into canonical legacy metadata.
- Fixed `src/clipVersionSnapshot.ts`: snapshotting an existing canonical nested Composition now preserves its already embedded child subtree instead of replacing it with only children rediscovered from the current parent placements.
- Regression coverage verifies both Clip Asset and Shot Slot migration preserve canonical documents, plus Save-as-Clip retains a pre-embedded nested subtree even when it is not re-derived from parent placements.
- **Important remaining root-persistence gap:** `DionysusProject` schema 1.0 is still the live editor state. The versioned V2 export carries a canonical root Composition projection in `compositionModel`, but import validates it against a fresh migration from the legacy project and returns the legacy payload; root Composition is not yet the authoritative live edit state. Do not describe this as full canonical root persistence. Next architecture slice: root Composition-backed command state plus a deterministic compatibility projection, with edit/save/reopen and undo/redo tests.
- Nested Timeline commands are canonical-authoritative within Clip Versions, but audit legacy Storyboard/Shot Slot handlers that directly mutate `layers`. Keep DYS-005/DYS-014 in progress. No browser smoke tests; no merge without review and a fresh exact-head CI after the documentation update.


## Exact-head canonical-first mutation audit — 2026-10-20

- Verified branch head before this docs batch: `37ae7063f1e92018b75cb469ec198f9ba826cfee`. PR #96 is still Draft and unmerged.
- Root insertion plans and ripple/trim use canonical Composition occupancy; drag/drop conflict checks use the live root. Linked groups are shifted through shared Composition move commands and retain their source ranges. Master Shot ripple reorder is a shared canonical command.
- Remaining root clip operations are routed through canonical helpers: metadata/source edits, mute, unlink, move, trim/resize, split, duplicate, delete and media import. Reconciliation of legacy domain edits no longer overwrites existing canonical placement timing, track, source or link fields.
- Track removal rejects deleting the final video track, requires a fallback when Master Shots occupy the removed video track, removes a linked audio child without deleting its parent video, and deletes the linked group when its parent is removed.
- V2 import and local recovery validate and restore the stored root Composition when its deterministic compatibility projection matches. Schema-1.0 input continues through legacy migration. Tests cover canonical insertion/ripple/trim, source ranges and links, track-removal edge cases, Master Shot reorder, import and App persistence/Undo/Redo.
- Exact-head CI [#39470992130](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39470992130) passed on `37ae7063f1e92018b75cb469ec198f9ba826cfee`: 240 tests across 23 files, TypeScript and production build passed, dependency audit reported 0 vulnerabilities.
- This is a focused canonical-first audit checkpoint, not a claim that every Storyboard/Reference or nested domain editor has been redesigned around Composition. Keep DYS-005/DYS-014 in progress and review compatibility-only paths in the next slice. No browser smoke tests; never merge or push to `main`.


## Canonical resize/drop planner follow-up — 2026-10-20

- Root clip resize previews now derive the moving placement, source in-point, adjacent-placement timing and trim candidates from the live root `CompositionDocument`. Canonical drag/drop also uses the root placement's duration and root extent rather than stale legacy duration/timeline bounds.
- Compatibility projection now clears legacy `clipVersionId` and `scriptVersionId` values when the canonical typed source no longer carries them, and re-emits only the selector appropriate to a canonical Clip or Script source.
- Added stale-projection regressions for resize/adjacent trim planning and drag/drop duration, a source-selector projection regression, and an App-level resize → linked audio → Undo/Redo → saved Composition envelope → reopen regression.
- Exact-head CI [#39483256604](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39483256604) passed on `004302b6e0c4baca91681d9f6da0b200e1e45ad7`: 243 tests across 23 files, TypeScript and production build passed, npm audit reported 0 vulnerabilities.
- Remaining gaps: some Storyboard materializations are compatibility-only and are not canonical placements; Shot/Slot and other domain editors still mutate schema-1.0 project data before reconciliation; broader root track-reorder and malformed-snapshot recovery behavior need explicit end-to-end coverage. Keep DYS-005/DYS-014 `in_progress`. No browser smoke tests; PR #96 stays Draft and unmerged.

## Next-agent pickup — current PR #96 state

Start by fetching the live PR and verifying its branch head/CI; do not reuse the previous SHA or CI result without matching them. Continue auditing domain/storyboard mutations that still enter via schema-1.0 `DionysusProject`, and complete explicit canonical track-reorder, nested/pinned composition persistence and invalid-snapshot fallback coverage. Then inspect every pending change, keep related work in one coherent commit, and require a successful regular CI run on that exact final head. Never add/run browser smoke tests, never push to `main`, and never merge PR #96; leave it Draft while any required gate is open.


## Linked audio with independent source ranges — 2026-10-20

- Fixed canonical trim, resize and split so linked placements share timeline start/duration while retaining each placement's own source range. Linked audio can use a different source file/in-point; it must not inherit the video's sourceIn/sourceOut.
- Regression tests cover independent non-zero source offsets through trim, resize and split, including input immutability. The App-level split test now seeds linked audio with source range 7–12 seconds and asserts it becomes 7–9.5 and 9.5–12 seconds while video splits at 0–2.5 and 2.5–5 seconds.
- This follow-up still requires exact-head CI after the code/test/docs commit; the preceding CI above does not validate these new changes.
- Remaining architecture gaps are unchanged: compatibility-only Storyboard materializations, legacy-first Shot/Slot/domain editors, full track reorder/edit integration, and malformed root-snapshot recovery still need audit and regression coverage. DYS-005/DYS-014 remain in_progress; PR #96 remains Draft and unmerged. No browser smoke tests.

## Next-agent priority

Verify the current branch head and its CI first. If it passes, continue the root mutation audit from the remaining compatibility-only Storyboard and legacy-first domain handlers, track reorder, and malformed/nested/pinned snapshot persistence. Do not mark DYS-005 or DYS-014 complete or recommend merging until those paths have meaningful tests and the final exact head passes regular CI.


## Linked source fallback and canonical drag/drop audit — 2026-10-20

- Follow-up CI run [39484081761](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39484081761) exposed one compatibility regression: legacy linked audio with no explicit source range must inherit the video range instead of defaulting to 0. The command now inherits the root range only when the child has no explicit in/out; an explicitly sourced child retains its own offset through trim, resize and split.
- Root drag/drop and Master Shot drag/drop now normalize preview duration/start/track from the canonical root placement where present. The Master Shot overlap check uses canonical root occupancy and frame rate, not the potentially stale legacy project duration.
- Regression coverage retains distinct linked audio source offsets (including the App split from source range 7–12 seconds) and adds an explicit test that untrimmed legacy children inherit their root source range. The failed CI is preserved as a diagnostic record; this next source/test/docs head must run CI again.
- Known remaining gaps: canonical Composition is not yet authoritative across every Shot/Slot and Storyboard domain editor, Storyboard materializations remain compatibility-only, root track reorder needs end-to-end coverage, and malformed/nested/pinned root persistence/history requires further audit. DYS-005/DYS-014 remain in progress; keep PR #96 Draft and unmerged; no browser smoke tests.


## Canonical envelope restore and linked-source compatibility — 2026-10-20

- Corrected the v2 document boundary so createProjectDocument derives its schema-1.0 project projection from the validated root Composition; readProjectDocument validates root and nested/pinned snapshots, then reprojects compatibility placement fields from root instead of rejecting valid root timing/source/track/link edits because stored legacy fields are stale.
- App recovery now prefers a valid Composition envelope when project identity matches and its updatedAt revision is at least as new as the schema-1 recovery copy. A clearly newer or timestamp-ambiguous legacy recovery remains the fallback. The two storage reads are isolated so corrupt legacy JSON cannot prevent a valid v2 recovery.
- CI on 165708d2f5e5a1f7954d6ed370d4a9e625fa430e passed all 246 tests but failed TypeScript because getMasterShotPlacementItems became unused after canonical overlap checks. That helper has been removed. This source/test/docs follow-up requires exact-head CI.
- Added tests for deliberately stale projection geometry, invalid canonical placement legacy metadata, and retaining valid stored nested/pinned snapshots without reconstructing them from legacy fields.
- Still in progress: compatibility-only Storyboard materializations, legacy-first Shot/Slot/domain editors, broader root track reorder and track-settings integration, and malformed/nested/pinned snapshot/history coverage beyond these focused tests. DYS-005/DYS-014 remain in_progress; PR #96 stays Draft and unmerged. No browser smoke tests.


## Recovery-fixture correction — 2026-10-20

- CI run [39485463504](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39485463504) failed 32 App assertions because those tests manually replaced schema-1.0 local storage while retaining the prior v2 envelope at the same updatedAt. Legacy-only fixture writes now remove the v2 key; dedicated save/reopen tests continue to exercise both stores.
- Project-document assertions compare with the deterministic canonical compatibility projection included in the v2 export, instead of the raw pre-projection object. The raw schema-1.0 import path remains lossless.
- Exact-head CI for the correction is required. DYS-005/DYS-014 stay in_progress; PR #96 remains Draft and unmerged; no browser smoke tests.


## Canonical track settings — 2026-10-20

- Generic and Video layer settings now call the root Composition track command directly. Canonical fields include name, mute, background, transparency and opacity; track geometry/settings that have not been promoted yet remain in that track's legacyData so the schema-1.0 projection remains compatible.
- App regressions now check not only the schema-1.0 track object but the stored root Composition track for background transparency/opacity and X/Y/width/height transform values.
- The preceding exact-head CI run 39486016683 passed on 8bdafe463fea6b1bdb0ec082aab92c87b9bc7aba (249 tests/23 files, TS/build successful, npm audit found 0 vulnerabilities). This track-settings patch requires its own exact-head CI run.
- Remains in progress: Shot/Slot and other storyboard/domain editors still perform legacy-first mutations; Storyboard materializations remain compatibility-only, and wider root track reorder plus invalid/nested/pinned history cases require additional coverage. DYS-005/DYS-014 stay in_progress. Keep PR #96 Draft/unmerged; no browser smoke tests.

## Recursive nested/pinned snapshot validation — 2026-10-20

- Composition validation now recursively checks embedded nestedCompositions, rejects cyclic embedded document graphs, validates provenance kind/createdAt and pinned-version reference shape, and continues to check each nested document's local track/placement/link invariants.
- Replaced the prior top-level migration-snapshot check with tests that serialize and reopen an actual root containing a nested Composition with pinned-version provenance. Added rejection coverage for invalid nested timing, empty pinned version IDs and cyclic embedded snapshots.
- The immediately preceding head 85cf6043070a711c469f2ec5baa588ad538d1ce5 passed exact-head CI run 39486652985: 249 tests across 23 files, TypeScript/build passed, npm audit reported 0 vulnerabilities. The recursive-validation batch still requires CI on its own exact head.
- Still incomplete: full App-level editing/history transitions for nested/pinned compositions, legacy-first Shot/Slot and other domain editors, compatibility-only Storyboard materializations, track reorder/settings end-to-end coverage beyond the new track settings tests, and malformed import/recovery cases beyond the focused validation suite. Keep DYS-005/DYS-014 in_progress and PR #96 Draft/unmerged. No browser smoke tests.

## Nested invalid-fixture correction — 2026-10-20

- CI run 39487372239 on 1243fc047cbb7ede69b9bb476e5b653bf87f02f1 ran 251 tests: 250 passed, 1 failed. The failing negative test set nested document.duration to zero, but document duration is not currently defined as a strict positive invariant (empty roots can be duration zero); it did not corrupt a validated placement.
- Corrected the test to add a nested placement with duration zero, which directly tests that recursive validation enforces the existing positive-finite placement duration invariant. The separate malformed pinned-version and cycle tests passed in that run. Exact-head CI for the corrected test/docs commit is required.
- No task completion status changed; DYS-005/DYS-014 remain in_progress and PR #96 remains Draft/unmerged.

## Nested validation fixture follow-up — 2026-10-20

- Exact-head CI run 39487705640 on 1cb834f5b309e97f37f1f65c52bf4eb0e82f5bb2 failed in the new negative test before reaching the validator: the selected legacy Shot/Slot snapshot had zero tracks. This is a fixture-construction issue, not a validator result.
- Updated the test to start from the valid root Composition (which has tracks), embed it as a nested snapshot, and add a zero-duration nested placement. The assertion now specifically exercises recursive placement-duration validation. Current head needs a fresh exact-head CI run.
- DYS-005/DYS-014 remain in_progress. PR #96 remains Draft and unmerged. No browser smoke tests.

## Canonical on-canvas track transform — 2026-10-20

- Closed a remaining root mutation gap: the timeline preview's pointer-driven X/Y/width/height transform now calls the canonical track update command for root tracks. The legacy-only fallback is retained only for track IDs genuinely absent from the root.
- The existing App test for moving the selected track transform asserts both projected schema-1.0 values and saved root track legacyData, so it now exercises the true canonical path rather than allowing reconciliation to make the test pass afterwards.
- Previous exact-head CI run 39488133593 passed on 88992a63a56f14a44ec5e77e4d580cf8d36db781: 251 tests / 23 files, TypeScript and production build passed, and npm audit reported 0 vulnerabilities. This source/test/docs commit requires a fresh exact-head CI run.
- Remaining: Shot/Slot and Storyboard/domain editors are still legacy-first in several flows; some Storyboard materializations remain compatibility-only; complete track reorder/add/remove and UI-level nested/pinned edit history coverage are not yet proven. DYS-005/DYS-014 remain in_progress. PR #96 remains Draft and unmerged; no browser smoke tests.

## Latest increment — atomic project-import replacement boundary (2026-10-22)

- `createImportedEditorSessionTransition()` now returns the validated imported `{ session, history }` together. Project import cannot accidentally pair the new project with stale Undo/Redo entries from the previous project; `App.tsx` consumes this single result.
- Regression coverage starts with a non-empty previous-project undo history and asserts import returns the migrated paired session plus a fresh empty history. Existing canonical-root validation and legacy import behavior remain covered.
- Exact-head CI for the final synchronized commit must be recorded before treating this increment as verified. PR #111 stays open/unmerged; Issue #100 stays open for owner acceptance. No browser smoke tests or manual UI acceptance claimed.
- Next: inspect and route any remaining direct session mutations; then design single-authority recovery/persistence without dropping schema-1.0 compatibility. Project remains a compatibility projection, persistence remains dual-key, and non-root/render paths still need migration.


## Latest increment — tested startup recovery arbitration (2026-10-22)

- Moved `shouldPreferCompositionRecovery()` from the UI component into `src/editorSessionPersistence.ts`, next to the persistence boundary. It prefers the canonical envelope only when the project identity matches and both revisions are parseable, with canonical revision at least as new as the legacy mirror; if no valid legacy document exists, a valid canonical read may recover on its own.
- Added tests for newer/equal revisions, mismatched IDs/names, invalid timestamps, and absent documents. This extracts and locks down the existing policy; it does not yet remove dual-key storage or make recovery a single-document load.
- Exact-head CI must be checked after the synchronized commit. PR #111 remains open/unmerged; Issue #100 remains open. No browser smoke tests or manual UI acceptance claimed.
- Next: inspect whether recovery parses/selects/project data more than once during startup, then design a tested single-authority persistence migration that retains schema-1.0 imports.


## Latest increment — single-read startup recovery (2026-10-22)

- Refactored `createInitialEditorSession()` to read the v1 and v2 localStorage keys once per startup and retain the parsed recovery results. Project selection and canonical-root restoration now use the same parsed snapshot pair instead of re-reading/re-parsing the keys in a second block.
- The existing safety checks remain: recovery precedence is based on matching identity and comparable revisions; a canonical root is accepted only when its projected Project exactly matches the selected startup Project. Otherwise startup uses deterministic legacy migration.
- This reduces inconsistent cross-read recovery decisions but does not remove dual-key storage. Exact-head CI must be checked after docs synchronization. PR #111 stays open/unmerged; Issue #100 stays open. No browser smoke tests or manual UI acceptance claimed.


## Latest increment — canonical recovery no longer votes by timestamp (2026-10-22)

- Tightened `shouldPreferCompositionRecovery()`: when a valid v2 envelope and v1 mirror identify the same project, v2 wins regardless of timestamp ordering. The v2 envelope is written first and is the authoritative root snapshot; timestamps are revision metadata, not a contest between two mutable copies.
- If project ID/name differ, recovery still prefers the v1 candidate to avoid pairing one project's state with another project's canonical root. If v2 is absent/invalid, v1 remains the migration fallback.
- Regression tests now prove canonical precedence for older/equal/invalid timestamps with matching identity and legacy fallback for identity mismatch. This reduces timestamp-based competition but dual-key writes remain until the compatibility transition is completed. Exact-head CI required after docs sync.


## Latest increment — canonical-only autosave (2026-10-22)

- `persistEditorSession()` now writes only `dionysus.composition.v2`. The v1 `dionysus.project.v1` key is retained as a read-only migration/recovery fallback; it is no longer rewritten on every edit.
- Startup chooses one complete valid recovery document: a valid v2 envelope is authoritative, regardless of its project ID relative to a stale v1 mirror; v1 is used only when v2 is absent/invalid. The selected v2 Project and root Composition remain internally validated by `readProjectDocument()` and exact projection matching.
- Persistence tests now assert canonical-only writes, projection correctness, and that a failed canonical write leaves an existing legacy fallback untouched. This is a single active authority with a legacy fallback, not a deletion of old data. Exact-head CI is pending after docs sync.


## Validation correction — App tests follow canonical persistence (2026-10-22)

The first CI run after switching autosave to canonical-only failed because the App integration-test helper still read only the legacy localStorage key. The product behavior is intentionally v2-first; `src/App.test.tsx` now reads the v2 envelope's Project projection first and uses v1 only as fallback. The failing run is [39866352949](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39866352949); rerun exact-head CI after this test adaptation. No production test failure has been isolated yet beyond the stale test helper assumptions; verify the full suite before claiming success.


## Verified checkpoint — canonical-only persistence (2026-10-22)

- Final docs/test-synchronized head: `c1009ae456df33815388c5cd62917c7606d396ac`.
- Exact-head CI [run 39866541271](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39866541271) passed: 26 test files / 286 tests; TypeScript and production build passed; npm audit 0 vulnerabilities.
- `src/App.test.tsx` now reads the canonical v2 envelope first, matching the new persistence contract. The preceding run failed only because its helper still read v1; this was corrected and the full suite then passed.
- PR #111 remains open/unmerged. v2 is the only routinely written project key; v1 is retained read-only fallback. Non-root editing and render/playback legacy paths remain. No browser smoke tests or manual UI acceptance claimed.
