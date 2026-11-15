# Clip types

One folder per clip type. Design, decisions and the phased plan: `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md`.

**Status (P67, Phase 1 step 1.3a):** the domain predicates (`trackKindFor`, `isStill`, `canChromaKey`, `hasSound`,
`canSetRange`, `slipKind`, …) and the export audio plan read this registry (P66). Text, placeholder and blank clips
draw through their `render.ts` (P67), in preview and export alike. Video, image, audio and html still draw inline in
`render/player.ts` (step 1.3b); timeline, inspector, storyboard and agent tools still use the `clipType` checks
listed in §2 of the design doc (steps 1.4–1.8).

```
clipTypes/
  types.ts      ClipTypeCore, ClipCaps, ClipVariant
  define.ts     defineClipType({…}) — the default export of every core.ts
  registry.ts   createClipTypeRegistry(), checkClipType()
  load.ts       registers discovered modules, collects problems
  index.ts      import.meta.glob("./*/core.ts"), CLIP_TYPES, CLIP_TYPE_PROBLEMS, variantOf(p), clipTypeOf(p)
  <id>/core.ts  video, image, audio, text, html, effect, placeholder, blank, unknown
  <id>/render.ts  text, placeholder, blank (P67): default export { id, draw(host) }; discovered by
                  src/v2/render/clipRenderers.ts. Render-layer code: canvas and render helpers allowed.
```

## Rules

- The folder name is the id. Built-ins use the stored `Placement.clipType` (`video`, `image`, …). `placeholder` and
  `blank` are **variants**: they are stored as `clipType: "image"` with the `placeholder` / `blank` flag
  (`variant: { of, field }`), so saved projects never change. `unknown` is the fallback for an id this build does
  not know.
- `core.ts` is pure data: no DOM, no React, and `domain` only through `import type` (enforced by
  `src/v2/architecture.test.ts`).
- `caps` must keep answering exactly what today's predicates answer. `parity.test.ts` checks every type against
  `trackKindFor`, `isStill`, `hasSound`, `canChromaKey`, `needsThumb` and `canSetRange`. If a parity case fails, the
  change in behaviour is a bug, not a test to update.
- Never rename a shipped id. Bump `version` when the behaviour of existing data changes.
- Invalid modules (no default export, an id that is not the folder name, bad fields, duplicates, a variant of a type
  that is not registered) are left out and listed in `CLIP_TYPE_PROBLEMS`, which the tests require to be empty.

## Adding a type (not yet)

New types need the render and ui parts and the `Placement.plugin` data field from later steps. Until step 1.8 adds
`docs/v2/ADDING_CLIP_TYPES.md`, do not add new types here.
