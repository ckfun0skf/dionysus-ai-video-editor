# Dionysus Architecture Notes

## Principles
1. Local-first and static-hostable.
2. Separate project data from UI state and AI execution-plan serialization.
3. Keep asset identity separate from version-specific usage.
4. Preserve immutable generation snapshots and pin script versions.
5. Treat browser capabilities as variable; degrade gracefully.
6. Never silently overwrite manual edits or historical records.

## Initial application structure
- Project domain model: versioned serializable types for project, shots, clip slots, versions, layers, assets, reference profiles, overrides, and generation records.
- Storyboard workspace: shot ordering, intent, duration, status, and placeholders.
- Timeline workspace: master tracks and nested version timeline views.
- Inspector: selected object details and editing controls.
- Asset/reference library: reusable files, reference groups, character/entity profiles, and provenance.
- Persistence adapter: browser local storage for the first foundation; migrate to IndexedDB when project/media size requires it.
- Project interchange: versioned project JSON.
- AI execution-plan serializer: stable external plan independent of UI components.
- Preview/compositor: later milestone; isolated rendering layer for video, audio, text, and procedural modules.
- History service: later milestone; edit commands/diffs separate from version and generation histories.

## Data model invariants
- Every Shot, Slot, Version, Asset, Profile, and Layer has a stable ID.
- A Slot's selected Version ID must reference one of its Versions.
- A Version owns its layers and pinned Script version IDs.
- Nested compositions must not form cycles.
- Profile references are defaults; Shot overrides do not mutate Profiles.
- Generation records snapshot references and prompts used at generation time.
- Timeline time is stored in seconds initially; frame-accurate timebase remains open.
- Schema migrations are explicit and versioned.

## Current foundation
The initial UI provides Storyboard, a basic Master Timeline view, Shot editing, local browser persistence, project JSON import/export, and AI execution-plan export. Media ingestion, true timeline drag/drop, nested compositor, and actual MP4 export are not yet implemented.
