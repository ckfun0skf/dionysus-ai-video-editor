# DYS-012 Progress Report — Responsive mobile editing

**Status:** In progress; layout, touch movement, contextual tools and zoom merged; trim hit targets and pointer-captured scrubbing merged; mobile version picker and frame-aligned scrubbing and frame-step controls merged; frame counter and keyboard frame-step refinement merged; mobile preview Undo/Redo active  
**Last reviewed:** 2026-10-19

## Shipped
PR #68 merged responsive layout as `3513d51f9a52599e0231d8cb4db884cc59e5d611`. PR #69 merged Master Timeline touch movement as `01ca4653a23c70273c74d3ada37883b66dabb3e3`. PR #70 merged nested Clip Version touch movement as `fd51602f92640cf18ad426a418bb7c8d8cb39207`. PR #71 merged contextual clip tools and Inspector toggle as `3ab7defb1a882ebc8eefcbfb1ccaa37ffcc69351`. PR #72 merged timeline zoom as `f57b5ad3ffe5b80bd586b513fc2fc1e201898cf8`; exact-head CI run [39238940480](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39238940480) passed at `2ce2e57f9a4360c6f438a56d721625cb54081947`.

- Persistent bottom navigation and preview-first timeline hierarchy.
- Isolated horizontal scrolling surfaces for root/nested ruler and lanes.
- Master and nested timeline long-press touch movement with overlap checks.
- Contextual selected-clip actions, mobile Inspector open/close, and shared Zoom In / Zoom Out / Fit controls.

Main push CI and Pages deployment have not yet been independently confirmed. Do not ask the owner to test until deployment is confirmed.

## Latest merged trim ergonomics
PR #73 merged trim hit targets and visible grab markers as `98f1637f1cc36a069578edb2337bcfdb578b4612`; exact-head CI run [39239397529](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39239397529) passed.

## Latest precision-scrubbing release
PR #74 merged pointer-captured playhead scrubbing to Master, main visual and nested Version rulers as `605edf9af5922f3f6c054997d50f648ecae067ad`; exact-head CI passed at [39242564926](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39242564926).

## Latest mobile version picker release
PR #75 merged the safe-area-aware bottom-sheet version picker as `72b2debcf586e2a0663a03119e7f688b79394f8f`; exact-head CI passed at [39242992878](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39242992878).

## Latest frame-aligned scrubbing release
PR #76 snapped pointer-captured scrubbing to project frame boundaries as `c04d9562747352225b83de90cc48a55355c06494`; exact-head CI passed at [39243270619](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243270619).

## Latest frame-step control release
PR #77 merged phone-only Previous frame / Next frame controls and frame-rate-aligned range steps as `ef1fb36d4e512825b2baec0d3103c5d86ab4ce49`; exact-head CI passed at [39243556120](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243556120).

## Latest mobile frame-counter release
PR #78 merged a phone-only current-frame counter beside the preview timecode as `8d36a4e018395fd13d60110ba9c5f4d2aeeffbbc`; exact-head CI passed at [39243808054](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39243808054).

## Frame-accurate keyboard scrubbing
PR #79 merged Left/Right one-frame stepping on the focused visual timeline ruler as main commit `0a5ace89e28fff5d1f46bc0e4330d56e91f9035e`.

## Current mobile history controls
The active slice adds phone-sized Undo/Redo controls beside the preview. The App integration test verifies a clip duplicate can be undone and redone from these controls. Exact-head CI and post-merge deployment are pending; no browser smoke tests are added.

## Remaining work
- Verify exact-head CI for keyboard frame stepping, then merge through PR.
- Independently verify main push CI and GitHub Pages deployment after merge.
- Refine scrubbing/trim, Inspector/Version picker and mobile viewport behavior.
- Record viewport/device evidence only when available; do not mark DYS-012 done on CSS and gestures alone.

## Related specification
- [DYS-012 task](../tasks/responsive-mobile-editing.md)
