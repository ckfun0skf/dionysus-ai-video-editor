# DYS-013 — Reusable Clip Assets and nested composition timeline

**Status:** Done for this feature slice  
**Progress estimate:** 100%  
**Milestone:** M3 — Timeline model & Version workflow  
**Last updated:** 2026-10-18  
**Implementation PR:** [#51 — Asset, Clip timeline, and editor integrity](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/51)

## Goal

Treat a reusable Clip as a first-class project Asset whose selected Version is an editable composition, not just a video file. Allow Clips to be composed from smaller modules and embedded elsewhere without corrupting project data or creating recursive cycles.

## Delivered

- [x] Create an empty Clip Asset with name, canvas dimensions, duration, and an initial Version.
- [x] Open a Clip Version in its own Timeline tab without replacing the Master Timeline.
- [x] Edit a Clip Version's duration, description, and ordered internal modules; support video, image, audio, text, Code/procedural modules, and nested Clips.
- [x] Duplicate a Clip Version with new module IDs while preserving the prior Version.
- [x] Pin concrete Clip Versions when used by timeline placements or nested Clip modules.
- [x] Detect direct/indirect Clip Asset cycles and reject invalid project graphs.
- [x] Validate Clip assets, selected Version IDs, layer references, referenced images, and normalized composition geometry.
- [x] Expand reusable Clip placements into timed composition layers; support nested Clip rendering and looped sources.
- [x] Keep Code preview sandboxed and pass only explicitly selected image references.
- [x] Test core graph, validation, rendering, preview transforms, and App creation/opening workflow.

## Architecture transition

This completed slice covers the existing nested Clip Asset feature, not the new requirement to preserve the complete Project timeline structure. Current save-master logic collects composition layers but does not fully preserve the root track/placement tree. DYS-014 owns the structure-preserving snapshot and shared-editor migration. Do not mark that target complete until track/placement structure, concrete version pins, nested expansion, snapshot independence, migration and round-trip tests are verified.

## Scope boundaries

DYS-013 covers the reusable Clip Asset graph and its nested timeline workflow. It does **not** certify frame-accurate professional NLE behavior or final MP4 export, and it does not complete the separate Shot identity/Version migration or all reference-management improvements. The browser compositor currently exports WebM under supported browser capabilities. Missing media/unsupported codecs must remain explicit rather than being presented as rendered footage.

## Evidence

- [PR #51](https://github.com/ckfun0skf/dionysus-ai-video-editor/pull/51)
- [GitHub Actions workflow run](https://github.com/ckfun0skf/dionysus-ai-video-editor/actions/runs/39153686513) — this is the implementation-head run before the documentation batch; verify the newest PR head again before merge.
- [Creative editing workflow spec](../creative-editing-workflow-spec.md)
- [Implementation report](../reports/reusable-clip-assets-report.md)
