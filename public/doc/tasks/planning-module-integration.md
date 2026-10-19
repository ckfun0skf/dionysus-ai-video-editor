# DYS-019 — Integrate Storyboard and References around Timeline-first editing

**Status:** Planned · **Progress:** 0%  
**Milestone:** M2 — Assets, References and project tracking  
**Depends on:** DYS-017 stable Editor/source contract; DYS-004 Asset and Reference foundations; DYS-015 production workflow where applicable

## Goal

Add Storyboard and References as planning tools that prepare and explain Timeline content, without making the Timeline Editor dependent on those modules or silently synchronizing later Storyboard changes over manual edits.

## Storyboard integration

- Storyboard Shots represent narrative/production intent and concrete generated video alternatives; they are not an alternative Timeline data model.
- The user can explicitly assemble/refresh an initial timeline from selected/order-defined Shots. The action previews its impact and does not silently delete or overwrite manual placements.
- The Editor source browser can list/select Shot Versions and place a pinned version.
- New Shot generation versions do not silently replace already pinned Timeline placements.
- After initial assembly, Storyboard edits and Timeline timing/arrangement remain separate unless the user explicitly performs another assembly/update operation.
- Selecting a Shot/placement shows the correct version/provenance while keeping editing operations within the shared Editor.

## References integration

- Reference Groups and Character/Entity Profiles provide reusable generation inputs, not direct timeline clips.
- Per-Shot/task overrides support inherit, exclude, replace and add without mutating shared profile defaults.
- Each generation record captures the effective prompt/reference snapshot when available.
- The Editor may provide shortcuts to view source/reference provenance, but editing a timeline placement must not rewrite generation history.

## Asset integration

- Editor-local Media/Audio/Effects browsing is part of DYS-017 and must work first.
- The later full Asset workspace supports management, metadata, missing-media repair, reverse-use lists and safe delete/replace.
- Deletion/relinking must identify affected Storyboard items, generation records, reference sets, compositions and pinned placements before applying a confirmed change.

## Acceptance criteria

- [ ] Timeline Editor works with a blank project or existing assets before Storyboard/References are populated.
- [ ] Storyboard-to-Timeline assembly is explicit, repeatable and non-destructive to later manual edits.
- [ ] Shot Versions and Clip Versions remain distinct source types with explicit pins.
- [ ] Reference changes affect future generation inputs only; saved run snapshots remain immutable.
- [ ] Missing assets and reverse dependencies are visible and repairable.
- [ ] Project JSON round-trip preserves Shot alternatives, reference provenance and Timeline pins.
- [ ] Core behavior and build are tested; no automated browser smoke tests.
