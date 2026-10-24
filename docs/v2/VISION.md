# Dionysus — product vision

_Owner direction, recorded 2026-10-24. Companion to [MODULE_DESIGN.md](./MODULE_DESIGN.md)._

## Problem

Today an AI video is made in five separate steps: write the story with an AI → plan the shots → generate the assets → generate clips from assets + prompts → composite. The painful parts are **asset management** and **choosing among many generated versions per clip** (often up to ~10).

## One-stop flow

1. **Story.** The user agrees the story with their own AI.
2. **Prompt.** Dionysus provides a copyable prompt that makes that AI output a **fixed-format storyboard JSON**.
3. **Import.** The user pastes/imports the JSON; Dionysus validates it against the schema and builds the storyboard:
   - shot connections and order;
   - per shot, the reference assets it needs;
   - per asset, its generation prompt (plus type, aspect, references);
   - per shot, the clip generation prompt;
   - per asset and per clip, the QA checks to perform;
   - **frame dependencies:** an asset can be the **last frame of another clip**. Linking this must be user-friendly, and the frame is extracted from the clip's chosen version. When the source clip's selected version changes, every downstream asset/clip generated from the old last frame is flagged **"may not match"**, transitively.
4. **Production todo list.** A clear step-by-step list (guided wizard): copy prompt → generate the asset externally → upload into its slot (prompt + model recorded in provenance; progress such as 5/12; skip, regenerate as a new version, reorder) → for each clip, which assets and prompt to use → upload clip versions → pick a version → run the QA checklist.
5. **Timeline.** The timeline editor handles preview and fine-tuning.

## Build order

1. A full-featured timeline editor with most features of common video composers: video, images, music, subtitles, HTML/CSS/JS components with native three.js.
2. Then the Storyboard side, connected to the timeline.

## Future (not now)

- Direct generation API calls from the site.
- AI agents that go from story to all assets and video, with automatic review.

**Current phase:** Dionysus only guides the user through their own external AI. The app makes **no AI calls**.
