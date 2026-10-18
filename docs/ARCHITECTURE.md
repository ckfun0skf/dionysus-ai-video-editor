# Dionysus Architecture Notes

## Principles
1. Local-first and static-hostable.
2. Separate project data from UI state and AI execution-plan serialization.
3. Keep asset identity separate from version-specific usage.
4. Preserve immutable generation snapshots and pin script versions.
5. Treat browser capabilities as variable; degrade gracefully.
6. Never silently overwrite manual edits or historical records.

## Initial application structure
- UI localization: all static user-facing interface copy lives in `src/i18n.ts`; components use typed translation keys and parameter interpolation. Add locale catalogs with the same keys and expose a language selector in a later milestone.
- Project domain model: versioned serializable types for project, shots, clip slots, versions, layers, assets, reference profiles, overrides, and generation records.
- Storyboard workspace: shot ordering, intent, duration, status, and placeholders.
- Timeline workspace: persistent Master Timeline tab plus nested Shot-Version timeline tabs, each with its own ruler/playhead and clip/module selection.
- Timeline presentation: preview above actual track lanes. Asset library entries do not become a generic “Media track”; assets are sources assigned to typed timeline modules.
- Track hierarchy: ordered layer groups for video/compositing, text/title, audio, and procedural Three.js. Video source audio may be a child audio lane while linked; unlinking converts it into an independent audio layer.
- Track controls: mute is layer-level for every audio layer and is persisted independently. Layer order, mute, child relationships, active Version, and nested Version internals are domain data; open tabs and playhead are UI state.
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
- A Version owns its ordered internal layers/modules and pinned Script version IDs; Master Timeline placement and Version-internal timing are separate.
- A Shot's selected Version determines its active Master Timeline output. Version menu selection is distinct from Edit: selection changes active output, while Edit opens a new nested timeline tab without closing Master Timeline.
- Linked source audio references a valid video clip, follows its timing while linked, and becomes independently editable after unlinking. Every audio layer owns an independent mute flag.
- Procedural modules have stable IDs and pinned script/scene versions; imported code requires explicit authorization and isolated execution.
- Nested compositions must not form cycles.
- Profile references are defaults; Shot overrides do not mutate Profiles.
- Generation records snapshot references and prompts used at generation time.
- Timeline time is stored in seconds initially; frame-accurate timebase remains open.
- Schema migrations are explicit and versioned.

## Current foundation
The current UI provides Storyboard, a Master Timeline editing workspace, local browser persistence, project JSON import/export, and AI execution-plan export. The desired timeline contract further separates Master Shot placement from nested Version internals and requires timeline tabs, version dropdown actions, hierarchical linked audio with independent mute, and a first-class Three.js layer. The existing schema still needs to evolve to persist these relationships and any migrations. Do not assume a visible lane or preview component proves end-to-end rendering/export support.


## Canonical composition model: Shot vs Clip (2026-10-18)

- `Shot` is an identity for a video shot; `ShotVersion` points to one concrete video output/source asset. A Shot is not itself a nested Clip container.
- `Clip` is an editable composition. `ClipVersion` owns a versioned internal timeline made of modules/placements, including references to a pinned `ShotVersion`, `ClipVersion`, Code asset/module, image, audio, or other supported content.
- `Layer` is a track and contains multiple Clips. Code is a Clip content/module type, not a standalone top-level Code Layer. Effects are settings on the applicable Clip/Layer.
- `Asset` identity is shared; usage and child-version selections belong to the referencing Clip Version. Do not duplicate media bytes merely because an asset is referenced.

### Invariants

1. A Clip Version pins the exact Shot Version and child Clip Version it uses. It does not implicitly track whichever version is “latest.”
2. Adding a Shot Version leaves existing Clip Versions untouched. Batch-changing references is an explicit user action.
3. “Create Clip Versions for selected references” duplicates the selected Clip Version and changes the new copy's reference; it must not mutate the original.
4. Clip nesting is a directed graph. Reject a proposed edge if the child can already reach the parent; this prevents both direct self-containment and indirect cycles. Apply this validation to UI selection, mutation APIs, project import, and migrations. UI filtering is helpful but is not the integrity boundary.
5. Empty Clip Versions are valid compositions.
6. The Master Timeline and Clip Timeline share one editor implementation with context-specific data/time scope. Saving Master Timeline as an Asset creates a reusable Clip composition without deleting or replacing the Master Timeline.
7. Canvas aspect ratio, pixel dimensions, and frame rate are project settings. Preview transform state uses normalized composition coordinates and supports pointer-driven move/resize with accessible numeric controls.
8. Asset creation is a single menu for Clip, Code, Audio, and Image. Audio creation requires an uploaded audio source. Image assets have stable IDs usable by Code and Clip; Reference/Storyboard integration is a later stage.

### Suggested graph validation

When adding a reference from parent Clip P to child Clip C, reject if P equals C or if traversing the child-reference graph from C reaches P. Also reject unresolved child/version IDs, and validate imported project JSON before committing it to live state. Error messages should identify the cycle path when possible.
