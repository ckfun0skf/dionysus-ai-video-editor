# Clip types

One folder per clip type. Design, decisions and the phased plan: `docs/v2/CLIP_PLUGIN_ARCHITECTURE.md`.

**Status (P73, Phase 1 complete):** the domain predicates (`trackKindFor`, `isStill`, `canChromaKey`, `hasSound`,
`canSetRange`, `slipKind`, …) and the export audio plan read this registry (P66). Every drawn type renders through
its `render.ts`, in preview and export alike: text and blank (P67), html, video, image and audio (P68), and the
unknown-type slate (P73). The timeline clip look and asset thumbnails/previews come from `ui.tsx` (P69), and so do the
inspector tabs, mobile toolbar and context menu (P70). Storyboard mapping and file import read `core.story` and
`core.accepts` (P71). The agent surface reads `core.agent`: contributed WebMCP tools, AI guide rules and
`get_timeline` fields, and the per-type tool checks `clipTools` / `props` (P72). Since P73 a placeholder is a host
clip **state** any type can have (`state.ts`, checked before any type; decision 9), and a `clipType` this build does
not register loads, keeps its data and shows as a slate (§6 of the design doc).

**Phase 2 (P74, step 2.1):** `scene/` is the first type built on the registry: a deterministic three.js scene whose
asset version holds a `dionysus.scene/1` document (`domain/scene.ts`, `docs/v2/SCENE_FORMAT.md`). It renders in the
sandboxed HTML clip host (`render/scenePage.ts`, reached through `host.media.sceneHost` / `sceneDoc`), with the pure
`stateAt(doc, t)` sent to the page every frame. Since P75 (step 2.2) it also draws GLB models from the document's
`files` and poses their animations with `mixer.setTime` from `t` (`domain/glb.ts` reads clip and node names). Since
P76 (step 2.3) it has its own timeline editor (`ui/SceneEditor.tsx`, pure operations in `domain/sceneEdit.ts`), and since
P77 (step 2.4) its blocks are dragged and resized to retime events (`domain/sceneRetime.ts`).

```
clipTypes/
  types.ts      ClipTypeCore, ClipCaps, ClipVariant, ClipAccepts, ClipStory (P71), ClipAgent (P72)
  story.ts      storyOf(kind), kindForSlotType(t), kindForFile(file), mimeForFile(file), DEFAULT_CLIP_STORY (P71)
  agent.ts      clipTypeAgentTools(), clipTypeAgentRules(), agentToolOwner(name), clipTypeDescribe(p), clipToolFits,
                clipPropFits (P72)
  define.ts     defineClipType({…}) — the default export of every core.ts
  registry.ts   createClipTypeRegistry(), checkClipType()
  load.ts       registers discovered modules, collects problems
  state.ts      the placeholder clip state (P73): isPlaceholder(p), placeholderCore(core), placeholderCaps, placeholderAccepts
  index.ts      import.meta.glob("./*/core.ts"), CLIP_TYPES, CLIP_TYPE_PROBLEMS, variantOf(p) (blank), clipTypeOf(p)
                (placeholder state first), coreOf(id), isKnownClipType(id)
  <id>/core.ts  video, image, audio, text, html, effect, blank, scene (P74), unknown (video, image, audio and html
                also declare `accepts` and `story`, P71)
  <id>/render.ts  text, blank (P67), unknown (P73 slate): default export { id, draw(host) } (stateless, canvas only);
                  html, video, image, audio (P68), scene (P74): { id, frame(host) } (stateful: every frame for a visible
                  clip with an asset version, via the Player's pools in host.media; shared element path in
                  render/mediaClip.ts). Discovered by src/v2/render/clipRenderers.ts. Render-layer code: canvas and
                  render helpers allowed.
  <id>/ui.tsx   video, image, audio, html, text, effect, blank (P69), scene (P74): default export ClipTypeUi
                (declarative timeline fields: name, icon, body, background, filmstrip, waveform, assetThumb, …;
                P70 inspector/toolbar fields: inspectorTabs, inspectorActions, toolbar, editor, speed, volume, …
                naming host-owned tabs, tools and actions);
                discovered by src/v2/ui/clipTypeUi.tsx, missing fields take DEFAULT_CLIP_UI; placeholders get the host's
                PLACEHOLDER_UI and unknown ids UNKNOWN_CLIP_UI (P73).
                UI-layer code: React and ui helpers allowed.
```

## Rules

- The folder name is the id. Built-ins use the stored `Placement.clipType` (`video`, `image`, …). `blank` is a
  **variant**: stored as `clipType: "image"` with the `blank` flag (`variant: { of, field }`), so saved projects never
  change. `unknown` is the fallback for an id this build does not know.
- A **placeholder** is not a type: any clip with `placement.placeholder` is one, and the host handles it before any
  type (`state.ts`, `render/placeholderSlate.ts`, `PLACEHOLDER_UI`). Types never handle placeholders.
- `core.ts` is pure data: no DOM, no React, and `domain` only through `import type` (enforced by
  `src/v2/architecture.test.ts`).
- `caps` must keep answering exactly what today's predicates answer. `parity.test.ts` checks every type against
  `trackKindFor`, `isStill`, `hasSound`, `canChromaKey`, `needsThumb` and `canSetRange`. If a parity case fails, the
  change in behaviour is a bug, not a test to update.
- Never rename a shipped id. Bump `version` when the behaviour of existing data changes.
- Invalid modules (no default export, an id that is not the folder name, bad fields, duplicates, a variant of a type
  that is not registered) are left out and listed in `CLIP_TYPE_PROBLEMS`, which the tests require to be empty.

## Adding a type

Follow `docs/v2/ADDING_CLIP_TYPES.md` (step by step, with a worked example checked by
`src/v2/ui/addingClipTypes.test.tsx`).
