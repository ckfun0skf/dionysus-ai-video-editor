# DYS-012 — Responsive mobile editing

**Status:** In progress — layout, touch movement, contextual tools, zoom, trim hit targets, pointer-captured scrubbing and mobile version picker merged; frame-accurate scrubbing refinement in progress  
**Milestone:** M4 — Preview, compositing, and mobile editing  
**Owner requirement:** A future phone version with a CapCut-inspired editing experience.

## Goal
Make Dionysus usable on phone and tablet screens without removing Storyboard, References, Assets, advanced multi-track editing, or reusable Clip Version workflows. The first delivery target is responsive mobile web sharing the desktop project model; this does not commit the project to a separate native application.

## UX contract
- Preview first, timeline immediately below it, with the timeline able to use its own horizontal scroll surface.
- Persistent bottom navigation for Storyboard, Timeline, Assets and References; respect device safe-area insets.
- Touch-sized playback, insertion, track, trim and version controls with visible focus/selected states.
- Keep track labels identifiable while panning the timeline. Prevent page-level horizontal overflow rather than squeezing every track into an unusably narrow lane.
- Short swipes pan the timeline/page; holding a clip for about 260 ms activates drag-to-move on both Master and nested Clip Version timelines.
- Selecting a Master Timeline clip reveals a compact action row; a separate Inspector toggle opens shot/project properties without permanently consuming preview width.
- Zoom In / Zoom Out / Fit scales root and nested timeline surfaces together without changing clip timing.
- Trim handles should have generous hit areas and visible grab markers without obscuring short clips.
- Preserve the same project data, pinned versions, linked audio and composition semantics as desktop.

## Issue #83 — mobile UI/UX correction in progress
- Owner report: some controls lack clear button styling, layer actions overflow the phone viewport, and the overall screen feels too busy compared with CapCut.
- Current corrective patch consolidates Master Timeline layer actions into a safe-area-aware overflow menu, standardizes touch control styling, and converts preview/master action rows to horizontal strips.
- Automated component coverage is included. This is not yet full CapCut parity or device acceptance.

## Shipped foundation
- PR #68 merged responsive layout as main commit `3513d51f9a52599e0231d8cb4db884cc59e5d611`.
- PR #69 merged Master Timeline touch movement as main commit `01ca4653a23c70273c74d3ada37883b66dabb3e3`; exact-head CI run [39237331052](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237331052) passed.
- PR #70 merged nested Clip Version touch movement as main commit `fd51602f92640cf18ad426a418bb7c8d8cb39207`; exact-head CI run [39237693258](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39237693258) passed.
- PR #71 merged contextual clip tools and mobile Inspector toggle as main commit `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`; exact-head CI run [39238524459](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238524459) passed.
- PR #72 merged Zoom In / Zoom Out / Fit controls as main commit `f57b5ad3ffe5b80bd586b513fc2fc1e201898cf8`; exact-head CI run [39238940480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238940480) passed.
- Main push CI and Pages deployment have not yet been independently confirmed.

## Latest merged interaction improvements
- PR #73 merged mobile trim hit targets and visible grab markers as `98f1637f1cc36a069578edb2337bcfdb578b4612`; exact-head CI run [39239397529](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39239397529) passed.
- PR #74 merged pointer-captured scrubbing as `605edf9af5922f3f6c054997d50f648ecae067ad`; exact-head CI run [39242564926](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39242564926) passed.
- PR #75 merged the safe-area-aware mobile bottom-sheet version picker as `72b2debcf586e2a0663a03119e7f688b79394f8f`; exact-head CI run [39242992878](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39242992878) passed.
- PR #76 merged frame-aligned pointer scrubbing as `c04d9562747352225b83de90cc48a55355c06494`; exact-head CI run [39243270619](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243270619) passed.
- PR #77 merged phone-only Previous frame / Next frame controls and frame-rate-aligned range steps as `ef1fb36d4e512825b2baec0d3103c5d86ab4ce49`; exact-head CI run [39243556120](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243556120) passed.
- PR #78 merged the phone-only current-frame counter as `8d36a4e018395fd13d60110ba9c5f4d2aeeffbbc`; exact-head CI run [39243808054](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243808054) passed.
- PR #79 merged frame-accurate Left/Right keyboard scrubbing as main commit `0a5ace89e28fff5d1f46bc0e4330d56e91f9035e`.
- PR #80 merged mobile-sized Undo/Redo buttons beside preview controls as main commit `85646e4a70cdde113bee728b4ed1cd781a022f0a`; exact-head CI run [39248435319](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39248435319) passed.
- PR #81 merged selected-audio Mute/Unmute as main commit `7ba96ec0eae8d6e3fb2196d7b9f492e293ff10e2`; exact-head CI run [39249271916](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39249271916) passed.
- Current branch styles the active muted state and asserts `aria-pressed` in the App integration test.
- Main push CI and Pages deployment for the latest main head have not yet been independently confirmed. Do not ask the owner to test until deployment is verified.

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


## Issue #83 correction merged — follow-up acceptance still required

PR #84 merged as `a83f4a6836d7c4ee683b17a1ccdb5897e17364e2`; exact-head CI [39252298875](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39252298875) passed. It consolidates Master Timeline layer actions, improves button styling and selected-state affordances, accounts for bottom navigation safe areas, and reduces vertical toolbar clutter.

Issue #83 is closed by the code merge, but this does not prove deployment or owner acceptance. First verify main push CI and Pages deployment, then continue the mobile viewport/usability pass. Keep DYS-012 in progress; no browser smoke tests.


## Mobile preview control density release — 2026-10-19

PR #86 merged the progressive-disclosure preview control slice as app commit `6e130e33a4236fff97f468f6d76fef933677bb58`. Exact-head feature CI [39259760793](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259760793), main push CI [39259981315](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981315) and GitHub Pages deployment [39259981194](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39259981194) all passed.

Undo/Redo, start, Play/Pause and frame stepping remain in the primary preview row on narrow screens. +0.5s, the playhead slider, overlay and optional image-clear action are available behind More controls / Less controls; desktop retains the complete set. The App regression test validates the accessible toggle and compact/expanded state. No browser smoke tests were added or run. DYS-012 remains in progress pending actual portrait, landscape and tablet viewport acceptance.
