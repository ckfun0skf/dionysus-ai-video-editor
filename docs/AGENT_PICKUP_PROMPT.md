# Reusable New-Chat Pickup Prompt — Dionysus

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
