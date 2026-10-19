# DYS-012 — Responsive mobile editing

**Status:** In progress — responsive layout and Master Timeline touch drag shipped; nested gestures in progress  
**Milestone:** M4 — Preview, compositing, and mobile editing  
**Owner requirement:** A future phone version with a CapCut-inspired editing experience.

## Goal
Make Dionysus usable on phone and tablet screens without removing Storyboard, References, Assets, advanced multi-track editing, or reusable Clip Version workflows. The first delivery target is responsive mobile web sharing the desktop project model; this does not commit the project to a separate native application.

## UX contract
- Preview first, timeline immediately below it, with the timeline able to use its own horizontal scroll surface.
- Persistent bottom navigation for Storyboard, Timeline, Assets and References; respect device safe-area insets.
- Touch-sized playback, insertion, track and version controls with visible focus/selected states.
- Keep track labels identifiable while panning the timeline. Prevent page-level horizontal overflow rather than squeezing every track into an unusably narrow lane.
- Short swipes pan the timeline/page; holding a clip for about 260 ms activates drag-to-move. Trim handles remain deliberate direct targets.
- The same long-press gesture should work on both the Master Timeline and nested Clip Version timelines.
- Preserve the same project data, pinned versions, linked audio and composition semantics as desktop.

## Shipped foundation
- PR #68 merged the responsive layout as main commit `3513d51f9a52599e0231d8cb4db884cc59e5d611`; exact-head PR CI passed.
- PR #69 merged Master Timeline touch movement as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; exact-head CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed at `31ed8795ef883e556285eecd6ab7073bee094a87`.
- Main push CI and Pages deployment have not yet been independently confirmed.

## Active nested gesture slice
Branch `feat/mobile-nested-timeline-touch` adds:
- A 260 ms long-press before moving a nested Clip Version layer.
- Short horizontal swipes pan the nested timeline; short vertical swipes scroll the page.
- Drop targets are resolved from the actual nested track and use the existing version-specific placement/overlap engine.
- A component regression test verifies movement to another compatible track.

This branch is not yet merged; exact-head CI is pending.

## Not complete
- Mobile Inspector and Version picker interactions.
- Precise scrub/trim UX and complete touch validation across timeline surfaces.
- Portrait, landscape and tablet viewport validation, including page-level overflow.
- Confirmation that every timeline interaction works on real touch input.

## Acceptance criteria
- [ ] No page-level horizontal overflow at supported phone portrait/landscape and tablet sizes.
- [ ] Preview and timeline are both accessible without losing selection.
- [ ] Touch selection, scrubbing, drag/trim and version switching work reliably.
- [ ] Storyboard, References and Assets remain reachable.
- [ ] Exact-head CI/build and deployment evidence are recorded.
- [ ] Any manual acceptance report is clearly separated from automated checks.

## Verification policy
Do not add or run automated browser smoke tests. Use the existing unit/component suite, TypeScript/Vite build and GitHub Pages deployment status. Do not mark DYS-012 complete based on CSS or one gesture alone; device/browser acceptance is separate and must not be claimed without evidence.

## Dependencies
DYS-005 timeline workflow; DYS-006 preview/compositing; DYS-014 shared Composition model.
