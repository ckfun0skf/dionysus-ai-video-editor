# Agent Handoff Guide

This file is the starting point for any agent continuing Dionysus. Keep project knowledge in Git; do not rely on chat history as the source of truth.

## Read first

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
