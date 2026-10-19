# DYS-012 — Responsive mobile editing

**Status:** In progress — responsive layout shipped; touch gestures in progress  
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
- Show context-relevant editing tools when content is selected; use a focused panel/sheet for dense properties instead of permanently taking preview width.
- Preserve the same project data, pinned versions, linked audio and composition semantics as desktop.

## Shipped layout foundation
PR #68 merged as `3513d51f9a52599e0231d8cb4db884cc59e5d611`:
- Four-destination bottom navigation and safe-area spacing.
- Compact mobile top bar and reduced page-heading chrome.
- Preview-first timeline hierarchy and larger playback/insertion controls.
- Isolated horizontal scroll surfaces for the root and nested timeline ruler/lanes, with sticky track labels.

Exact-head PR CI run [39236495588](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39236495588) passed at `aca468fb345b523361467ae8da66b42d1207904a`. Main push CI and Pages deployment still need independent confirmation.

## Active touch gesture slice
Branch `feat/mobile-timeline-touch-drag` adds:
- A 260 ms long-press before moving an existing Master Timeline clip.
- Short horizontal swipes pan the timeline; short vertical swipes scroll the page.
- Pointer-based drop calculation and collision checks reuse the existing project placement engine.
- A component regression test verifies that a touch drag moves a clip to a compatible non-overlapping position.

This branch is not yet merged; exact-head CI is pending.

## Not complete
- Touch-first movement for nested Clip Version timeline layers.
- Precise scrub/trim UX and complete touch validation across timeline surfaces.
- Mobile Inspector and Version picker interactions.
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
Do not add or run automated browser smoke tests. Use the existing unit/component suite, TypeScript/Vite build and GitHub Pages deployment status. Do not mark DYS-012 complete based on responsive CSS or one touch gesture alone; device/browser acceptance is separate and must not be claimed without evidence.

## Dependencies
DYS-005 timeline workflow; DYS-006 preview/compositing; DYS-014 shared Composition model.
