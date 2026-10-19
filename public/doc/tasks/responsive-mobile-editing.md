# DYS-012 — Responsive mobile editing

**Status:** In progress — responsive layout foundation only  
**Milestone:** M4 — Preview, compositing, and mobile editing  
**Owner requirement:** A future phone version with a CapCut-inspired editing experience.

## Goal
Make Dionysus usable on phone and tablet screens without removing Storyboard, References, Assets, advanced multi-track editing, or reusable Clip Version workflows. The first delivery target is responsive mobile web sharing the desktop project model; this does not commit the project to a separate native application.

## UX contract
- Preview first, timeline immediately below it, with the timeline able to use its own horizontal scroll surface.
- Persistent bottom navigation for Storyboard, Timeline, Assets and References; respect device safe-area insets.
- Touch-sized playback, insertion, track and version controls with visible focus/selected states.
- Keep track labels identifiable while panning the timeline. Prevent page-level horizontal overflow rather than squeezing every track into an unusably narrow lane.
- Show context-relevant editing tools when content is selected; use a focused panel/sheet for dense properties instead of permanently taking preview width.
- Preserve the same project data, pinned versions, linked audio and composition semantics as desktop.

## Current slice
- Adds a four-destination mobile bottom navigation.
- Compresses the top bar and page heading on narrow screens.
- Prioritizes the integrated preview above the timeline.
- Increases hit areas for playback, insertion, timeline tabs and key track controls.
- Keeps timeline panning inside timeline surfaces and makes track labels sticky while scrolling.
- Retains access to Storyboard, Assets and References.

## Not complete
- Touch-first clip drag/reorder, precise playhead scrubbing and reliable edge trimming.
- Mobile Inspector open/close behavior and a contextual Version picker.
- Portrait, landscape and tablet viewport validation, including page overflow.
- Confirmation that every timeline interaction works on real touch input.

## Acceptance criteria
- [ ] No page-level horizontal overflow at supported phone portrait/landscape and tablet sizes.
- [ ] Preview and timeline are both accessible without losing selection.
- [ ] Touch selection, scrubbing, drag/trim and version switching work reliably.
- [ ] Storyboard, References and Assets remain reachable.
- [ ] Exact-head CI/build and deployment evidence are recorded.
- [ ] Any manual acceptance report is clearly separated from automated checks.

## Verification policy
Do not add or run automated browser smoke tests. Use the existing unit/component suite, TypeScript/Vite build and GitHub Pages deployment status. Do not mark DYS-012 complete based on responsive CSS alone; device/browser acceptance is separate and must not be claimed without evidence.

## Dependencies
DYS-005 timeline workflow; DYS-006 preview/compositing; DYS-014 shared Composition model.
