# Clip types

One folder per clip type. Design, decisions and the phased plan: `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md`.

**Status (P65, Phase 1 step 1.1):** the registry exists, but the app does not read it yet. Today's behaviour still comes
from the `clipType` checks listed in §2 of the design doc. The later Phase 1 steps move those checks here one surface at
a time, with no behaviour change.

```
clipTypes/
  types.ts      ClipTypeCore, ClipCaps, ClipVariant
  define.ts     defineClipType({…}) — the default export of every core.ts
  registry.ts   createClipTypeRegistry(), checkClipType()
  load.ts       registers discovered modules, collects problems
  index.ts      import.meta.glob("./*/core.ts"), CLIP_TYPES, CLIP_TYPE_PROBLEMS, variantOf(p), clipTypeOf(p)
  <id>/core.ts  video, image, audio, text, html, effect, placeholder, blank, unknown
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
