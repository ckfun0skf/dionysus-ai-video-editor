## Mandatory agent operating loop — 2026-10-22

This project uses a continuous, evidence-based workflow, not a one-time handoff assumption.

- Before changing code, inspect the live repository, main SHA, relevant open issues and PRs, changed files, and exact-head CI. Treat older handoff text as historical until re-verified.
- Work in coherent, testable increments. Prefer implementation and regression tests over planning-only changes.
- **After every meaningful increment, update the relevant existing GitHub Issue or add a comment immediately.** Record what changed, exact commit/PR/CI evidence when available, what remains, and the next concrete action. Do not defer all issue updates until the entire PR is complete.
- Update an issue body when its scope or acceptance checklist changes; use comments for progress checkpoints, decisions, validation, blockers and handoff. Reuse existing issues unless a genuinely distinct scope needs independent tracking.
- Keep the task dashboard, handoff and architecture docs consistent with code and actual GitHub state. A documentation checkbox is not implementation evidence.
- No browser smoke tests. Do not claim visual/manual acceptance from CI. Do not merge a PR without explicit owner approval. Keep Issue #100 open until the owner accepts the deployed Pages UI.
- When handing off, leave the exact current SHA, current CI state, outstanding work and next action in GitHub first; then provide a reusable prompt that does not assume the previous conversation is available.


## Reusable continuation prompt — use for any continuation, not only a new chat

You are continuing active development of Dionysus AI Video Editor. Do not assume the prior conversation has ended or that its last summary is current. Use the live repository and GitHub as the source of truth.

1. Inspect current `main`, open PRs/issues, changed files, and exact-head CI before editing; re-check any historical checkpoint.
2. Continue the highest-priority actionable work already tracked in the relevant issue/PR. Do not restart planning or ask for context that is already documented.
3. Implement one coherent, testable code increment with regression coverage where practical.
4. **Immediately after every meaningful increment, update the relevant GitHub issue body or add a comment** with the change, current SHA/PR, CI evidence or pending status, remaining work, and next action. Do not wait until the whole task is finished.
5. Keep handoff/task/architecture docs aligned with actual code and issue state. Prefer code plus tests over documentation-only progress.
6. Do not run browser smoke tests or claim manual UI acceptance. Do not merge without explicit owner approval; keep Issue #100 open until the owner accepts deployed Pages UI.
7. Before pausing, leave current exact SHA, CI status, blockers and next concrete action in GitHub and the handoff. This loop applies whether work continues in the same conversation or is picked up by another agent.


---

> **CURRENT DIRECTION (2026-10-19 — supersedes older checkpoint text below):** The owner has chosen a Timeline-first rebuild. Read [`docs/TIMELINE_EDITOR_REBUILD_PLAN.md`](TIMELINE_EDITOR_REBUILD_PLAN.md) and [`docs/architecture/TIMELINE_EDITOR_WORKSPACE.md`](architecture/TIMELINE_EDITOR_WORKSPACE.md) first. Timeline Editor is the first complete workspace and includes an upper-left Media/Audio/Text/Effects/Transitions source browser, upper-right Preview/Canvas, and lower multitrack Timeline. Later, Storyboard and References are planning modules around the Editor. On mobile, the Editor bottom bar is contextual to the selected element; module navigation lives in the project/workspace header or menu. Preserve tested logic and schema-1.0 project compatibility; rebuild the workspace/state boundary, not the whole codebase from zero. No automated browser smoke tests.

> **Live baseline observed while preparing this plan:** `main` was `a54526fc82345c8813a6f0b770056dfe6e25a526`. PR #88/#89 are open Draft PRs. PR #89 exact-head CI [39269841800](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39269841800) passed 206 tests but failed TypeScript/build. Re-check GitHub before acting; this is a historical observation, not a promise that the current state is unchanged.

# Reusable New-Chat Pickup Prompt — Dionysus

> **Fresh-chat/mobile continuation note (2026-10-19):** The mobile-focused handoff has moved to [`docs/MOBILE_AGENT_PICKUP_PROMPT.md`](MOBILE_AGENT_PICKUP_PROMPT.md) and [`docs/MOBILE_AGENT_HANDOFF.md`](MOBILE_AGENT_HANDOFF.md). Start there for the current CapCut-inspired mobile UX work, then verify live GitHub/CI/Pages state. The main pickup checkpoint elsewhere in this file is historical and must not override the mobile handoff.
>
> **Verified release and next branch:** PR #86 shipped the mobile preview control-density fix as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`; exact-head CI 39259760793, main CI 39259981315 and Pages deployment 39259981194 passed. Current development continues DYS-014 migration alternatives/provenance and JSON round-trip coverage on `feat/dys014-alternative-provenance-roundtrip`. Re-check live GitHub before relying on this checkpoint.
>
> **Live main verification:** `89f92a3168413151dd8acb58d4b3c034cf59ead3` passed main CI [39254646559](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39254646559) and Pages deployment [39254646733](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39254646733). Current mobile usability follow-up is `feat/mobile-preview-progressive-disclosure`; verify live PR/CI status before relying on this checkpoint.

Copy the prompt below into a new ChatGPT conversation whenever the current chat is long, interrupted, or another agent must take over.

---

You are taking over active development of **Dionysus AI Video Editor**. Treat the repository—not the previous chat—as the source of truth.

## Repository and non-negotiable rules

- Repository: https://github.com/ckfun0skf/dionysus-ai-video-editor
- Main preview site: https://ckfun0skf.github.io/dionysus-ai-video-editor/
- Task dashboard: https://ckfun0skf.github.io/dionysus-ai-video-editor/doc/task.html
- Start by reading `docs/AGENT_HANDOFF.md`, `docs/PROJECT_ROADMAP.md`, `docs/AGENT_PICKUP_PROMPT.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`, and `public/doc/tasks.json`.
- Inspect live GitHub main HEAD, all open PRs, relevant branches, latest exact-head CI, and all open Issues before changes. Documentation checkpoint IDs can go stale.
- Never push directly to `main`. Work on a feature branch and use one coherent PR. Do not merge a Draft PR just to publish documentation.
- Do not add or run browser smoke tests unless the user explicitly asks.
- Avoid one commit per file or tiny edit. Batch related code, tests, localization, task JSON, specs and reports into a coherent commit.
- Do not claim a feature, test, build, merge or deployment is complete without evidence for the exact SHA. Keep automated CI separate from actual UI verification and user acceptance.
- User prefers concise Hong Kong Cantonese conversation; code, comments, docs, issues, PRs and commit messages should be professional English.
- Do not stop at documentation-only updates if implementation is actionable. Documentation is required, but real code and regression tests are the goal.
- Do not ask the user to repeat requirements already documented. If no essential product decision is missing, proceed.

## Mobile product requirement

The owner wants a future mobile version with a CapCut-inspired editing interface. Target responsive mobile web first, sharing the desktop project schema and editing operations; do not assume a native app. On phones prioritize preview above timeline, touch-sized controls, contextual clip tools, horizontal scrolling inside the timeline, safe-area-aware persistent bottom navigation (Storyboard / Timeline / Assets / References), and no page-level horizontal overflow. DYS-012 is in progress; a CSS layout foundation is not full mobile editing. Do not add or run browser smoke tests.

## Product architecture direction

The accepted target direction is in `docs/architecture/UNIFIED_COMPOSITION_MODEL.md`:
- Storyboard is the narrative/production plan, not a live alias for timeline timing.
- A Shot is narrative production identity; each Shot Version is a concrete generated shot-video output with provenance.
- The Project Master Timeline is the root Composition. A Clip Asset Version is a reusable Composition.
- Root and nested compositions use the same document schema, Editor and placement operations. Drag/drop, snapping, overlap, resize/trim and Undo/Redo must not have separate Master-Shot and normal-placement code paths.
- Save-as-Clip preserves the editable composition tree, tracks, placements, source ranges, ordering, pinned versions and nested relationships. It is not an MP4 render, flat layer list or live link to the source project.
- Media Assets/Reference Sets are separate from compositions and production tasks.
- Production Tasks describe required outputs, prompts, explicit inputs and dependencies. Generation Runs preserve each attempt's effective prompt/settings/reference snapshot.
- Manual copy-prompt/import must work before AI provider API integration.
- Existing `schemaVersion: "1.0"` data (`Shot.slots[]`, nested `ClipVersion.layers[]`, root `timelineClips[]`, linked audio and `storyboard-*` placements) is legacy and must be migrated deterministically and non-destructively.
- Never silently mutate pinned versions or overwrite user edits.

## Current checkpoint to verify, not blindly trust

- Architecture baseline PR: https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/63
- Branch: `feat/unified-composition-model`
- Last recorded checkpoint commit: `406d898ad5176cc2ed55441b3ed502c67db5f7a5`
- Last recorded CI: https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39207371506 (passed tests and TypeScript/build at that commit).
- PR #63 remains Draft and includes DYS-014 migration projection code plus a follow-up for #54: ordinary clip drag/drop and resize occupancy includes Master Shots, cross-model resize trims update both records atomically, and Master Shot drag identity survives protected dragover. Shared logic is extracted to `src/projectTimelinePlacement.ts` with pure tests; both Master Shot and ordinary clip moves now call `moveProjectTimelinePlacement()`. Nested Clip Timelines render explicit track rows with multiple placements, track-aware Add content and compatible track drag/drop. Exact-head CI 39217800522 passed; project import/export now uses a versioned 2.0 compatibility envelope while preserving schema-1.0 files. This is not yet canonical-only persistence. Exact-head code CI 39218695102 passed; next design and test canonical-to-editable round trips, then move live editor state to canonical documents. Both Master and nested Clip Timeline Add layer menus expose only Video/Audio/Text. Nested Image/Code/Clip choices are now in a separate Add content menu. Continue with shared data/operation unification; #53 remains open. Import/export and full shared-editor integration remain incomplete; no deployment is implied.
- User reports residual problems in #53 and #54. Do not close them without code-level regression coverage and explicit user acceptance.
- New tasks: DYS-014 (unified Composition + structure-preserving snapshots) and DYS-015 (Production Task graph + Generation Runs).

## Current checkpoint (verified 2026-10-19)

- Main HEAD `288b5f349080c470a119c33174dfaa93c0e8c9f0`; main CI/Pages passed.
- PR #63 head `3826f84cd529ad2461a07f26ab83adf7a5a5b526`; exact-head CI 39221701720 passed tests and build.
- The project-document boundary now rejects mismatched Composition metadata. Schema-1.0 remains authoritative; canonical persistence and structure-preserving snapshots are still incomplete.
- #53/#54 remain open pending user acceptance. No browser smoke tests or PR deployment.

## Timeline Editor design artifacts (2026-10-19)

Before production UI implementation, read docs/architecture/TIMELINE_EDITOR_UX_DESIGN_PACK.md and docs/architecture/TIMELINE_EDITOR_UML.md plus the `.puml` files in docs/architecture/plantuml/ (use PlantUML Playground), then open public/doc/design/timeline-editor-wireframes.html. DYS-020 is the design review gate ahead of DYS-017. Treat the HTML as a low-fidelity prototype only. Update diagrams with any owner-approved architecture/interaction change.

## What to do next

1. Verify the current GitHub state and correct stale checkpoint information in docs.
2. Review PR #63 for internal consistency. Keep the target model as the baseline unless code inspection reveals a concrete contradiction; document changes and rationale.
3. Review the DYS-014 adapter and exact-head CI. It defines typed Composition/Track/Placement/source references, represents Master Shots as root placements, preserves every legacy Shot Slot Version as a separate projection, and does not mutate the source project.
4. Extend migration tests for alternative/provenance retention and legacy JSON import/export; then integrate the adapter into a versioned, deterministic migration boundary without breaking schema-1.0 projects.
5. Verify the #54 shared-occupancy patch and its App regression tests in exact-head CI. Then migrate root and nested editor state/operations to the same Composition contract; keep #53/#54 open until the user accepts the deployed behavior.
6. Implement structure-preserving Save-as-Clip and prove snapshot independence before calling DYS-014 complete.
7. Keep `public/doc/tasks.json`, task Markdown/HTML/report files, PR description and handoff checkpoint updated in the same coherent PR batch.
8. Run `npm test` and `npm run build` when runtime code changes; inspect exact-head GitHub CI. Do not run browser smoke tests.
9. Keep PR in Draft until code/tests/acceptance scope is reviewable. Report the exact next step and evidence in concise Cantonese.

Start by inspecting GitHub and then continue the work. Do not merely summarize this prompt back to the user.


## Latest pickup note — 2026-10-19

- PR #63 was merged to `main` as `9da2f2bfbf7e80abb73f5552a0d1447cff471c0b`; main CI [39227655141](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39227655141) and GitHub Pages deploy [39227655137](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39227655137) passed for the deployed SHA. Public preview: https://ckfun0skf.github.io/dionysus-ai-video-editor/.
- `src/nestedTimelinePlacement.ts` wires nested Clip/Version Timeline drag previews, snap guides, overlap protection and left/right resize with adjacent-layer trimming into one Undo transaction. #53/#54 remain open pending owner acceptance. Underlying canonical Composition persistence and structure-preserving Save-as-Clip remain unfinished.


## Latest requirements and active bug — 2026-10-19

- Issues #53/#54 have been closed as fixed at the owner’s direction. Do not reopen them for minor Add Clip overlap; that is a separate current follow-up.
- Add Clip insertion is now safe in PR #65: pick the asset, click a blank point on a compatible track, and if the gap is insufficient choose Ripple later placements or Trim the new clip. Linked audio / Master Shots / Storyboard materialization stay in sync; derived timeline end grows when required; no silent overwrite. No browser smoke tests.
- Shot/Clip relationship remains unresolved in implementation: Storyboard creates a Shot with an empty Slot Version, not a separate reusable Asset Clip. Clip Asset version controls now support duplicate-current-version and a new blank version, but this does not unify Shot Slot Version and Clip Asset Version. DYS-014 remains in progress for canonical Composition persistence and structure-preserving snapshots. Do not auto-create duplicate Clip Assets per Shot without an owner decision.


## New Clip Asset Version workflow — 2026-10-19

- PR #66 shipped the reusable Clip Asset **New Blank Version** action alongside **Duplicate Version**. The blank version inherits duration and track setup (fresh track IDs), has no content layers, and activates without mutating earlier versions. Feature SHA `ee1f90c3304ce0f2be5cef294c387192d2aa8969` passed CI [39234313896](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313896) and Pages deployment [39234313840](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39234313840). Re-query live main before edits; documentation checkpoints can advance Git HEAD without changing app code.
- Storyboard Shot creation still creates an empty Slot Version, not a separate reusable Asset Clip. Shot Slot Version vs Clip Asset Version is not yet one canonical Composition model; don't auto-create a linked duplicate Clip Asset per Shot before an explicit design decision.


## Latest mobile-workspace pickup — 2026-10-19

- PR #68 merged the responsive layout foundation to main as `3513d51f9a52599e0231d8cb4db884cc59e5d611`; exact-head PR CI run [39236495588](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39236495588) passed at `aca468fb345b523361467ae8da66b42d1207904a`. Main push CI and Pages deployment still require independent confirmation.
- This slice adds responsive mobile CSS for a four-item bottom navigation, compact top bar, preview-first timeline workspace, touch-sized playback/insert controls and horizontally scrollable track surfaces with sticky track labels.
- It does not yet implement robust touch drag/scrub gestures, a working contextual mobile Inspector sheet, or verified portrait/landscape no-overflow behavior. Keep DYS-012 in progress and report these as limitations.
- Continue next with tests and interaction support for touch scrubbing/selection/version switching, then return to DYS-014 canonical Composition persistence and structure-preserving snapshots.


## Latest mobile touch checkpoint — 2026-10-19

- PR #69 merged the Master Timeline long-press touch drag as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed at `31ed8795ef883e556285eecd6ab7073bee094a87`.
- Active branch `feat/mobile-nested-timeline-touch` implements the same touch gesture for nested Clip Version layers. Check exact-head CI before merging.
- Keep DYS-012 in progress; Inspector/Version picker, robust trim/scrub and viewport acceptance remain. Main push CI and Pages deployment have not yet been independently confirmed; do not ask the owner to test until deployment is verified. No browser smoke tests.


## Latest mobile contextual tools checkpoint — 2026-10-19

- PR #70 merged nested Clip Version touch movement as main commit `fd51602f92640cf18ad426a418bb7c8d8cb39207`; exact-head CI run [39237693258](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237693258) passed at `1b1da31e6cec749f3888385ea5c201183c4facba`.
- Active branch `feat/mobile-contextual-editor-tools` adds selected-clip actions, an Inspector toggle/close action and touch-sized version selector controls.
- Keep DYS-012 in progress. Verify exact-head CI, merge through PR, then independently confirm main push CI and Pages deployment. No browser smoke tests and do not ask the owner to test before deployment confirmation.


## Latest mobile zoom checkpoint — 2026-10-19

- PR #71 merged contextual clip tools and mobile Inspector toggle as main commit `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`; exact-head CI run [39238524459](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238524459) passed at `19eda997ad20a8a38d6b1e63345f03bccf9eb09e`.
- Active branch `feat/mobile-timeline-zoom-controls` adds Zoom In / Zoom Out / Fit controls to root and nested timelines. Confirm CI and merge via PR.
- Keep DYS-012 in progress. Main push CI and Pages deployment are not independently confirmed; no browser smoke tests and do not ask the owner to test before deployment confirmation.


## Latest mobile trim checkpoint — 2026-10-19

- PR #72 merged mobile timeline zoom as main commit `f57b5ad3ffe5b80bd586b513fc2fc1e201898cf8`; exact-head CI run [39238940480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238940480) passed at `2ce2e57f9a4360c6f438a56d721625cb54081947`.
- Active branch `feat/mobile-touch-trim-handles` expands trim hit areas and adds touch-pointer regression coverage.
- Keep DYS-012 in progress. Main push CI and Pages deployment are not independently confirmed; no browser smoke tests and do not ask the owner to test before deployment confirmation.


### Current DYS-012 mobile follow-up (2026-10-19)

Continue from branch `feat/mobile-preview-undo-redo` (if already merged, inspect the PR and main head first). This slice adds phone-sized Undo/Redo beside the preview and an App regression test for duplicate → Undo → Redo. Run exact-head CI/build, keep the work in a PR, verify main CI and Pages deployment after merge, and update the task dashboard/report/handoff. No browser smoke tests; do not ask the owner to test until deployment is verified. DYS-012 remains in progress until phone portrait/landscape/tablet acceptance is evidenced.


### Current DYS-012 mobile follow-up — audio mute (2026-10-19)

Continue from `feat/mobile-audio-clip-mute` (if already merged, inspect PR/main first). This slice adds selected-audio Mute/Unmute on the mobile clip toolbar and an App regression test. Run exact-head CI/build, merge through PR, verify main CI and Pages deployment, then update task dashboard/report/handoff. No browser smoke tests. Keep DYS-012 in progress until phone portrait/landscape/tablet acceptance is evidenced.


### Current DYS-012 mobile follow-up — mute-state accessibility (2026-10-19)

Continue from `feat/mobile-audio-mute-state` (if already merged, inspect PR/main first). This slice adds a visible active state to the selected-audio Mute/Unmute button and asserts its `aria-pressed` value. Run exact-head CI/build, merge through PR, verify main CI and Pages deployment, then update task dashboard/report/handoff. No browser smoke tests. Keep DYS-012 in progress until phone portrait/landscape/tablet acceptance is evidenced.


### Active E1 continuation — atomic import replacement (2026-10-22)

Current PR: [#111](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/111), branch `feat/e1-editor-session-history`. Continue from its live head, not from this note. `createImportedEditorSessionTransition()` now returns imported session + fresh empty history as one result; tests must protect against stale Undo/Redo crossing project boundaries. Verify exact-head CI after the synchronized docs commit, comment on Issue #110 after each meaningful increment, and keep Issue #100 open. Next inspect remaining direct session mutations and then safely consolidate dual-key recovery/persistence. Do not claim canonical-only state, do not run browser smoke tests, and do not merge without explicit owner approval.


### Active E1/E2 continuation — recovery arbitration (2026-10-22)

The latest increment extracts `shouldPreferCompositionRecovery()` into `src/editorSessionPersistence.ts` and tests identity/revision edge cases. Verify exact-head CI after this docs sync, and comment on Issue #110 after each meaningful increment. Next inspect startup's repeated reads/projections and design a single-authority persistence/recovery transition that still imports schema-1.0 projects. Keep Issue #100 open; no browser smoke tests or merge without explicit approval.


### Active E2 continuation — paired startup recovery read (2026-10-22)

Latest code now reads the v1 and v2 recovery keys once in `createInitialEditorSession()` and uses the same parsed results for both project selection and canonical-root acceptance. Verify exact-head CI after this docs sync, and comment on Issue #110 after each meaningful increment. Next assess a single-authority persistence/recovery migration; do not simply delete the v1 key while legacy imports and consumers still exist. Keep Issue #100 open, no browser smoke tests, and no merge without explicit approval.


### Active E2 continuation — canonical recovery precedence

The latest recovery policy treats a valid v2 envelope as authoritative when its project identity matches the v1 mirror; timestamps no longer decide between two snapshots of the same project. Identity mismatch falls back to the legacy candidate, and legacy import remains available if v2 is absent/invalid. Check exact-head CI after docs sync and update Issue #110 after each meaningful increment. Next decide and test when the compatibility mirror can stop being written, without losing legacy import or recovery safety. Issue #100 stays open; no browser smoke tests or merge without explicit approval.


### Active E2 continuation — canonical-only autosave

Current code writes only the v2 canonical Composition envelope; the v1 schema-1.0 localStorage key is read-only fallback for absent/invalid canonical data. Startup selects one complete document and does not compare timestamps or mix the Project from one key with the root from another. Exact-head CI is pending after this docs sync; update Issue #110 after each meaningful increment. Next verify tests and consider explicit cleanup/retirement of the stale v1 key only after recovery and migration evidence is sufficient. Non-root editing and renderer/playback still use legacy projections; Issue #100 remains open. No browser smoke tests or merge without explicit owner approval.


### Verified checkpoint — canonical-only persistence

At head `c1009ae456df33815388c5cd62917c7606d396ac`, [exact-head CI run 39866541271](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39866541271) passed 26 test files / 286 tests, TypeScript/build and audit 0. App tests now read v2 persistence first. Current storage contract: write v2 only, read v1 only as fallback. Next: inspect the read-only legacy key cleanup policy and migrate non-root editing/render/playback; do not claim canonical-only in-memory state. Keep PR #111 unmerged pending owner approval and Issue #100 open; no browser smoke tests.

### Latest active continuation — canonical rendering and nested commands (2026-10-22)

Live state takes precedence over this note: inspect PR #111 and exact-head CI before editing. Latest validated code checkpoint before this docs sync: `6a4632ece321518b95c48bea29d34c559a8d6ecb`; exact-head CI [39877068547](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39877068547) passed 26 test files / 297 tests, TypeScript/build and audit 0. This docs update creates a newer head, so verify exact-head CI again.

The branch `feat/e1-editor-session-history` has paired Editor session/history/import boundaries and canonical-only v2 autosave (v1 remains a read-only migration fallback). `collectVersionRenderLayers()` resolves nested Shot/Slot and Clip Version placements from canonical Composition, including linked-audio children and nested track mute. Master preview/audio/code preview/export use a memoized root render adapter. Nested track mute, duration and description controls synchronize canonical Composition and compatibility metadata. The selected storyboard Version description editor now uses the canonical helper; duplication of Clip Asset/storyboard Versions and creation of blank Versions sync descriptions into canonical metadata.

Initial Clip Assets and New Blank Versions materialize independent canonical Composition documents immediately, preserving parent canvas dimensions even when empty. Duplicating a legacy-only Clip Version first canonicalizes its source and remaps track, placement and linked-audio references; duplicated top-level Composition documents receive fresh IDs while nested pinned children remain unchanged. Save-as-Clip Asset receives the live canonical root Composition and derives both the saved nested document and flattened renderer projection from that same root, so stale legacy Project timing cannot overwrite canonical timing.

Read `docs/AGENT_HANDOFF.md`, `docs/PROJECT_ROADMAP.md`, `public/doc/tasks.json`, and Issue #110 for current evidence. Next: verify CI on the docs-synchronized head, then audit remaining non-root edit/pinned snapshot paths and plan a tested nested editable UI migration. Keep DYS-014 in progress, Issue #100 open until owner acceptance, do not run browser smoke tests, and do not merge without explicit owner approval.

Latest continuation note (2026-10-22): nested Clip Version projection and root linked-audio child projection now clear stale source-type fields before mapping canonical `CompositionSourceReference` back to compatibility layers; regression tests cover switching from Clip Composition to a direct asset and linked audio carrying stale `clipVersionId` metadata. Code head before documentation sync: `a4cc58fd3102ac2fb7c42a00baa44d6e1b776eff`. The docs-synchronized head `2121c59ad7d0da64548081301655df6e3f6a82a4` passed exact-head CI [run 39878411955](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39878411955): 26 test files / 297 tests, TypeScript/build passed, npm audit 0 vulnerabilities. Re-run exact-head CI if you make further changes. Continue auditing non-root edit/pinned snapshot paths and plan nested editable UI migration; DYS-014 stays in progress, Issue #100 stays open, no browser smoke tests, no merge without explicit owner approval.

Latest continuation note (2026-10-23): an additional source-projection audit found stale `childCompositionId` and `shotVersionId` fields could survive in root-placement and linked-audio legacy projections. Both are now cleared alongside all other source-selector fields; regression tests cover the stale values. Code/test commits: `da2c294151ae691cb3924bacd6d6b6c92674a26b`, `f2ad672ca5a6a5f1bccaae0a3e68e0946b78b47d`. The code/test checkpoint `0c891c71b0c3218362bb86c7db798d2090ee0add` passed exact-head CI [run 39880867984](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39880867984): 26 test files / 297 tests, TypeScript/build passed, audit 0. The selector cleanup is checked off in Issue #110. Re-run exact-head CI after this docs sync; keep completed items checked and leave remaining reconciliation/pinned/render/UI work unchecked. Continue remaining non-root/pinned snapshot audit and canonical Timeline command migration; DYS-014 in progress, #100 open, no browser smoke tests, no merge without owner approval.

## Validation correction — projection fixture metadata is intentionally legacy-only (2026-10-23)

The first CI for the expanded selector cleanup passed all 26 test files but failed TypeScript because `childCompositionId` and `shotVersionId` are intentionally not declared on the public `TimelineClip` type. The projection handles them as unknown legacy compatibility fields. Updated the implementation to narrow legacy metadata through `Record<string, unknown>` and changed regression fixtures to inject those unknown legacy fields through typed spreads. Fix commits: `d2ac053a9179802828b2d47ce7bffbe810327e56`, `bd012ac135cb0a20da38232217bce42c083dff1a`. Exact-head CI for this correction and the docs-synchronized head is pending; do not mark the selector expansion complete until it passes.

## Pinned Shot Slot snapshot audit — preserve the version named by the canonical placement (2026-10-23)

- The next non-root/pinned-path audit found `createClipVersionSnapshot()` embedded the currently selected Shot Slot version for each slot but did not resolve an explicit `CompositionSourceReference` of type `shot` to the exact `versionId` pinned by a canonical placement. If selection changed after the placement was pinned, the saved tree could omit the referenced version's child Composition.
- Snapshot child attachment now resolves Shot/Slot/version references from each canonical placement, records the exact pin, embeds that exact version's Composition recursively, and still preserves the current selected version snapshots as separate pins where relevant. The same path works inside nested Compositions.
- Added regression coverage where a root placement pins `shot-version-1` while the slot selection has moved to `shot-version-2`; the snapshot must contain both the exact pinned child and the current selected child, with both pin records.
- Code/test commits: `efe8486bf96fa47ae26874245b42a4ea739da826`, `41f44a5e78bfeef8a9816192198f9e317e0f4a4a`. Exact-head CI is pending; do not check this snapshot item complete until tests/build/audit pass.

## Validation correction — keep Shot source discriminant narrowed (2026-10-23)

The pinned Shot Slot snapshot regression passed with all 298 tests, but TypeScript caught that a nested callback did not retain the `placement.source.type === "shot"` discriminant. The resolver now captures the narrowed source union in a local constant before looking up the Shot and Slot. Fix commit: `f79818e90f6fd7ccc94a3c235665650ed6344c40`. Exact-head CI for this correction and final docs sync is pending; keep the Issue #110 pinned-snapshot checkbox unchecked until it passes.

## Validation correction — explicitly guard optional Shot Slot ID (2026-10-23)

The pinned-version regression again passed all 298 tests, but TypeScript correctly required a local guard because `CompositionSourceReference.shot.slotId` is optional. The resolver now captures `slotId`, skips Shot references without a Slot, and uses the narrowed local value for lookup and pinning. Fix commit: `27af284afe3794da779da7d6d44d5367b2d56492`. Exact-head CI passed at `16ef37a520c302995e02b9c6843de912f4edea3f`, [run 39881785207](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39881785207): 26 test files / 298 tests, TypeScript/build passed, audit 0. The Issue #110 snapshot item is checked; rerun exact-head CI after this docs sync.

## Nested legacy Shot Slot source migration audit (2026-10-23)

- Found that `compositionMigration.ts`'s legacy nested-layer source adapter did not recognize legacy metadata carrying `shotId`, `slotId`, and `shotVersionId`. Such a layer could migrate to `source: { type: "none" }` even though the nested editing adapter already recognizes Shot Slot sources.
- `sourceForLayer()` now converts those metadata fields into a canonical `CompositionSourceReference` of type `shot`, preserving the explicit version pin. Added regression coverage for a legacy nested Clip Version layer referencing a specific Shot Slot version.
- Code/test commits: `08ff16b8fde8f232d7731452fd06b8eb14efdac5`, `16df0113ebb3bffd4d6429644759f3edafd8918a`. Verified at `64733f71509273065fef23821728c3da8ce49a4`, [CI run 39882323664](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39882323664): 26 test files / 299 tests, TypeScript/build passed, audit 0. Issue #110's nested Shot Slot migration checkbox is checked; re-run exact-head CI after this docs update.

Latest continuation (2026-10-23): found a canonical pinned-subtree preservation gap in `reconcileEditorSessionComposition()`. A legacy-domain edit could replace root `nestedCompositions` with a freshly migrated target and drop embedded pinned child trees. The boundary now preserves existing canonical children by ID and appends only newly discovered children; regression test covers metadata-only rename. Code/test commits `9d05a458c1b86714dc5a586461b9913a23552ac5`, `28c82ed18aae641631def38e2a852d02fc95fb20`. Exact-head CI passed at `22dadc5764baf60d95a109ea75d8a5ad1be9ed49`, [run 39936044698](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39936044698): 27 test files / 310 tests, TypeScript/build passed, audit 0. Issue #110 item is checked; verify exact-head CI again after docs changes. Continue broader nested/pinned save-reopen round trips and migration away from legacy-to-canonical reconciliation. No browser smoke tests, no merge without owner approval.

Latest verified checkpoint (2026-10-23): root Timeline metadata/geometry edits preserve canonical source identity unless source fields are explicitly patched (`src/timelineClipSourcePatch.ts` and tests); session reconciliation preserves existing canonical pinned nested child Compositions by ID and appends only newly discovered children. Both are checked in Issue #110. Exact code/test head `22dadc5764baf60d95a109ea75d8a5ad1be9ed49` passed [CI run 39936044698](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39936044698): 27 files / 310 tests, TypeScript/build passed, audit 0. The docs/task-synchronized checkpoint `80b8c4f22f2367b2fa48502295ffc1cdff6394cb` passed [CI run 39936506656](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39936506656): 27 files / 310 tests, TypeScript/build passed, audit 0. Re-run exact-head CI after any further commit. Continue with remaining legacy-to-canonical editable paths and deterministic root/nested edit → undo/redo → save/reopen → JSON round-trip coverage; keep DYS-014 in progress, PR #111 unmerged, Issue #100 open. No browser smoke tests.

Latest continuation (2026-10-23): root reconciliation also used to replace a live canonical Composition ID with the legacy migration ID and erase provenance/canonical-only metadata. It now respects the deterministic root ID required by the v2 project-document contract, retains provenance if target migration omits it, and merges target metadata without dropping canonical-only fields. Regression added for provenance/unknown metadata across a metadata-only rename while retaining the deterministic root ID contract. Code/test commits `709692e86f82d233f77df8b1538244c7c8f586b7`, `fbc380918f9d709a8cf44d3b024027ef6243b331`, `441adf8c91b2780d740d88323dc15367c76ea1f8`, `c0a0d43e79390bc7409184b59b769dd39794bc70`; exact-head CI passed at `f85fb463654880704b852b88f7a765ac09f02216`, [run 39937441846](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39937441846): 27 files / 312 tests, TypeScript/build passed, audit 0. Issue #110 item is checked; verify exact-head CI again after docs changes.

Verified checkpoint (2026-10-23): `src/editorSession.test.ts` now covers a root + pinned nested edit through Undo/Redo and v2 JSON save/reopen, including source/version pin and provenance. Root reconciliation preserves canonical provenance/unknown metadata while keeping the deterministic v2 root ID. Both Issue #110 items are checked. Task-registry-synchronized checkpoint `0ee800302923e34175d67012812b1e2e4d46b239` passed [CI run 39937818376](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39937818376): 27 files / 312 tests, TypeScript/build passed, audit 0. This docs follow-up requires exact-head CI; continue broadening round-trip coverage and migrating editable Timeline/render/playback paths. No browser smoke tests or merge without owner approval.

Latest verified persistence slice (2026-10-23): `src/editorSessionPersistence.test.ts` now covers v2 save/reopen of a root containing a pinned nested Composition and provenance. Exact-head CI passed at `a2e31ee6615e05e1d250cc307c47d1ec7b77d9ac`, [run 39938305163](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39938305163): 27 files / 313 tests, TypeScript/build passed, audit 0. Issue #110 item checked. Continue the full deterministic edit → undo/redo → save/reopen → JSON round-trip matrix across root and nested compositions; do not mark the broader item complete yet.
