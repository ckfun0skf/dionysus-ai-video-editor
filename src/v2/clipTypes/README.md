# Clip types

One folder per clip type. Design, decisions and the phased plan: `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md`.

**Status (P69, Phase 1 step 1.4):** the domain predicates (`trackKindFor`, `isStill`, `canChromaKey`, `hasSound`,
`canSetRange`, `slipKind`, …) and the export audio plan read this registry (P66). Every drawn type renders through
its `render.ts`, in preview and export alike: text, placeholder and blank (P67), html, video, image, audio and the
unknown fallback (P68). The timeline clip look and asset thumbnails/previews come from `ui.tsx` (P69). Inspector,
toolbar, storyboard and agent tools still use the `clipType` checks listed in §2 of the design doc (steps 1.5–1.8).

```
clipTypes/
  types.ts      ClipTypeCore, ClipCaps, ClipVariant
  define.ts     defineClipType({…}) — the default export of every core.ts
  registry.ts   createClipTypeRegistry(), checkClipType()
  load.ts       registers discovered modules, collects problems
  index.ts      import.meta.glob("./*/core.ts"), CLIP_TYPES, CLIP_TYPE_PROBLEMS, variantOf(p), clipTypeOf(p)
  <id>/core.ts  video, image, audio, text, html, effect, placeholder, blank, unknown
  <id>/render.ts  text, placeholder, blank (P67): default export { id, draw(host) } (stateless, canvas only);
                  html, video, image, audio, unknown (P68): { id, frame(host) } (stateful: every frame for a visible
                  clip with an asset version, via the Player's pools in host.media; shared element path in
                  render/mediaClip.ts). Discovered by src/v2/render/clipRenderers.ts. Render-layer code: canvas and
                  render helpers allowed.
  <id>/ui.tsx   video, image, audio, html, text, effect, placeholder, blank (P69): default export ClipTypeUi
                (declarative timeline fields: name, icon, body, background, filmstrip, waveform, assetThumb, …);
                discovered by src/v2/ui/clipTypeUi.tsx, missing fields and unknown ids take DEFAULT_CLIP_UI.
                UI-layer code: React and ui helpers allowed.
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
