# DYS-014 Structure-Preserving Snapshot — Handoff Checkpoint

**Date:** 2026-10-19 · **Status:** DYS-014 remains in progress.

This note is additive. It supersedes stale statements in older checkpoints without rewriting them. Re-query GitHub before acting; nothing here replaces live state.

## Verified GitHub state (2026-10-19)

- `main` HEAD at the start of this slice: `a54526fc82345c8813a6f0b770056dfe6e25a526` (test: preserve Shot alternatives and provenance in migration round-trips).
- Open PRs at that time: #33, #37, Draft #45, plus this Draft PR (#88). Open Issues: #56, #58, #59.
- Issues #53/#54 are closed at the owner's direction. PR #63 is merged (`9da2f2bfbf7e80abb73f5552a0d1447cff471c0b`). The mobile audio mute-state slice (PR #81 and follow-ups) is merged.

## This slice (PR #88)

- `src/compositionSnapshot.ts`: pure `createCompositionSnapshot(project, { snapshotId, name? })`. It copies the root Composition produced by `migrateLegacyProjectToComposition()` under fresh deterministic IDs and returns `trackIdMap` / `placementIdMap`. Tracks, placement order, timing, source ranges and linked-placement relationships are preserved. Clip and Shot sources are pinned when a version is resolvable; otherwise an `unpinned-source` warning is emitted. Missing sources are retained and reported.
- `src/compositionSnapshot.test.ts`: structure preservation, fresh IDs and remapped links, two-way independence, determinism and JSON round trip, Clip pin, unpinned warning, missing source.
- Exact-head evidence: head `4821e700b91aacf73cc183f65ca6e5c60ecbf6be`; PR check `build` completed with conclusion `success` in [run 39267830422](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39267830422). Individual test counts were not inspected. No browser smoke tests were added or run.

## Not done

- `saveMasterTimelineAsClipAsset()` in `src/App.tsx` is not wired to the snapshot module; the UI still uses the legacy path, which per earlier handoffs flattens layers. The function body was not inspected in this slice.
- The snapshot is a canonical `CompositionDocument`. Converting it to an editable `ClipVersion` is unresolved, notably for Master Shot placements, which have no output asset in the schema-1.0 model.
- Cycle prevention must be enforced when a snapshot is placed into another Composition.
- Canonical-only persistence is not implemented. Schema 1.0 remains authoritative; the 2.0 document is a compatibility envelope.
- `public/doc/tasks.json`, task Markdown/HTML/report files and the older handoff/pickup documents were not updated because they could not be read in full through the tooling used. A follow-up must update them.

## Stale statements to correct in older documents

- `docs/AGENT_HANDOFF.md`, `docs/AGENT_PICKUP_PROMPT.md`, `docs/PROJECT_ROADMAP.md` and `public/doc/tasks.json` still say #53/#54 are open pending acceptance in some sections; they are closed.
- Some sections still list PR #63 as Draft or active; it is merged.
- Sections that call the mobile mute-state or alternatives/provenance branches "active" are historical; both are merged.

## Next single step

Read `saveMasterTimelineAsClipAsset()` in full, decide the snapshot-to-`ClipVersion` mapping (including Master Shots), then wire the UI with an App-level regression test proving the saved Clip keeps its tracks and is independent of later project edits. Update `tasks.json`, task docs and the older handoffs in the same PR.
