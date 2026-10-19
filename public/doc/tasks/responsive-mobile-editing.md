# DYS-012 — Responsive mobile editing

**Status:** In progress — layout, touch movement and contextual tools shipped; timeline zoom in progress  
**Milestone:** M4 — Preview, compositing, and mobile editing  
**Owner requirement:** A future phone version with a CapCut-inspired editing experience.

## Goal
Make Dionysus usable on phone and tablet screens without removing Storyboard, References, Assets, advanced multi-track editing, or reusable Clip Version workflows. The first delivery target is responsive mobile web sharing the desktop project model; this does not commit the project to a separate native application.

## UX contract
- Preview first, timeline immediately below it, with the timeline able to use its own horizontal scroll surface.
- Persistent bottom navigation for Storyboard, Timeline, Assets and References; respect device safe-area insets.
- Touch-sized playback, insertion, track and version controls with visible focus/selected states.
- Keep track labels identifiable while panning the timeline. Prevent page-level horizontal overflow rather than squeezing every track into an unusably narrow lane.
- Short swipes pan the timeline/page; holding a clip for about 260 ms activates drag-to-move on both Master and nested Clip Version timelines.
- Selecting a Master Timeline clip reveals a compact action row; a separate Inspector toggle opens shot/project properties without permanently consuming preview width.
- Zoom In / Zoom Out / Fit scales the root and nested timeline surfaces together without changing clip timing.
- Nested Clip Asset version selection must be touch-sized and usable on narrow screens.
- Preserve the same project data, pinned versions, linked audio and composition semantics as desktop.

## Shipped foundation
- PR #68 merged responsive layout as main commit `3513d51f9a52599e0231d8cb4db884cc59e5d611`.
- PR #69 merged Master Timeline touch movement as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; exact-head CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed.
- PR #70 merged nested Clip Version touch movement as main commit `fd51602f92640cf18ad426a418bb7c8d8cb39207`; exact-head CI run [39237693258](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237693258) passed.
- PR #71 merged contextual clip tools and mobile Inspector toggle as main commit `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`; exact-head CI run [39238524459](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238524459) passed.
- Main push CI and Pages deployment have not yet been independently confirmed.

## Active timeline zoom slice
Branch `feat/mobile-timeline-zoom-controls` adds:
- Zoom In / Zoom Out / Fit controls at phone widths.
- A shared track-width scale applied to root and nested scroll surfaces.
- An App integration test confirming zoom changes layout width without mutating clip duration.

This branch is not yet merged; exact-head CI is pending.

## Not complete
- Precise scrub/trim UX and complete touch validation across timeline surfaces.
- Mobile Inspector and Version picker behavior still needs usability refinement and viewport validation.
- Portrait, landscape and tablet viewport validation, including page-level horizontal overflow.
- Confirmation that every timeline interaction works on real touch input.

## Acceptance criteria
- [ ] No page-level horizontal overflow at supported phone portrait/landscape and tablet sizes.
- [ ] Preview and timeline are both accessible without losing selection.
- [ ] Touch selection, scrubbing, drag/trim and version switching work reliably.
- [ ] Zoom controls operate on both root and nested timelines without changing project timing.
- [ ] Storyboard, References and Assets remain reachable from mobile navigation.
- [ ] Exact-head CI/build and deployment evidence are recorded.
- [ ] Any manual acceptance report is clearly separated from automated checks.

## Verification policy
Do not add or run automated browser smoke tests. Use the existing unit/component suite, TypeScript/Vite build and GitHub Pages deployment status. Do not mark DYS-012 complete based on CSS and gestures alone; device/browser acceptance is separate and must not be claimed without evidence.

## Dependencies
DYS-005 timeline workflow; DYS-006 preview/compositing; DYS-014 shared Composition model.
