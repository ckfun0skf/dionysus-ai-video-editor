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
