# WebMCP: let an AI agent edit the storyboard (P4C)

Long films make an AI write very long storyboard JSON. With WebMCP, an AI agent that runs in your browser can design the storyboard directly in the open Dionysus tab, one small call at a time: add an asset, add a shot, change a cue, validate, send to the timeline. You watch every change happen live and can undo any of them.

For AIs that can't call tools (an ordinary chat), Dionysus also imports a storyboard **in parts**; see [Long stories in parts](#long-stories-in-parts-no-webmcp).

## What WebMCP is

[WebMCP](https://github.com/webmachinelearning/webmcp) is a W3C Web Machine Learning Community Group proposal. A web page registers "tools" (a name, a description, a JSON Schema for the input and an `execute` function) with `document.modelContext.registerTool(tool, { signal })`. A browser agent can list those tools and call them, on the page the user has open and with the user's session. Dionysus doesn't run any AI itself; it only exposes tools.

Dionysus detects the API at runtime (`document.modelContext`, falling back to the older `navigator.modelContext`) and does nothing when it's missing. It doesn't bundle a polyfill.

## Browser support (October 2026)

Be aware that this is early and experimental:

| Browser | Status |
|---|---|
| Chrome / Edge on desktop | Behind a flag: open `chrome://flags/#enable-webmcp-testing` (Chromium 146+), set it to **Enabled** and restart. Chrome also runs an origin trial (from Chrome 149) that lets a site enable it without the flag; Dionysus isn't enrolled, so on the deployed site you need the flag. |
| Chrome on Android | No agent extension support, so no practical way to connect an agent yet. |
| Safari (macOS, iOS), Chrome on iOS, Firefox | Not supported. The panel says so and everything else works as before. |

You also need an **agent** that speaks WebMCP. Today that means a browser extension, for example Google's *Model Context Tool Inspector* (lists the page's tools, lets you call them by hand, and can drive them with a Gemini API key) or a similar WebMCP-aware agent extension. Built-in browser assistants don't necessarily use page tools yet. The open-source MCP-B project offers a polyfill plus an extension that bridges page tools to desktop MCP clients; it should work too since Dionysus uses the standard API, but it isn't tested.

## Connecting an agent

1. Use desktop Chrome or Edge with WebMCP enabled (see above) and install a WebMCP agent extension.
2. Open Dionysus, go to **Storyboard → Agent** (on a phone: **⋯ → AI agent**).
3. Turn on **Allow AI agent access**. It's **off by default** and remembered in this browser only. The panel shows whether WebMCP was found and lists the tools.
4. Ask the agent, for example: "Use the Dionysus tools to plan a 2-minute film about …. Read get_guide first."
5. While the agent works, a pill at the top says **AI is editing · tool name**, with **Undo** and **Stop** (Stop turns access off and removes the tools). Every call is listed in the panel's **Activity** log (time, tool, result).

Turning the switch off unregisters every tool at once.

## Safety and undo

- Tools only exist while access is on. A call that arrives after access was turned off is refused.
- Every edit is checked by the same parser rules as an imported JSON storyboard. If the board would have any error, the call is **rejected and nothing changes**; the agent gets the error list (with shot ids) and can retry.
- Every successful edit is **one undo step** (Ctrl/Cmd+Z, or Undo on the pill), labelled with the tool name.
- Tools can only touch the open project's storyboard and its timeline (`send_to_timeline`). They can't read files, media or other projects, and make no network calls.
- `send_to_timeline` places shots that are ready or updates the shots already placed (update mode); it never deletes media.

## Tools

Generated from the same schema as the storyboard parser (`src/v2/domain/storyAgent.ts`), so field lists and enums can't drift.

<!-- tools:start -->
- `get_guide` · read-only: The Dionysus storyboard guide: how the format becomes a video, every field, the preset ids you may use, the numbered rules and an example. Read it before editing.
- `get_storyboard`(id) · read-only: Without "id": a summary (title, counts, the shot list with ids, durations and titles, asset ids, cue ids). With "id": the full JSON of that shot, asset ("<asset>@<state>" for a state), audio cue, or "meta" / "connections".
- `create_storyboard`(meta, assets, shots, audio, connections): Start a new storyboard when there is none: "meta" (title, aspect, style, …), any "assets", and at least one shot. Add the rest with add_shot. Fails if a storyboard exists (edit it instead).
- `update_meta`(patch): Change storyboard "meta" fields (title, aspect, style, fps, textStyles, audioOutput { mode: stereo | binaural, environment?: room | outdoor }, …).
- `add_asset`(asset): Add an asset (character, location, prop, style, image, frame, video, audio or html).
- `update_asset`(id, patch): Change fields of an asset (name, prompt, references, qa, aspect, source, states, …).
- `remove_asset`(id): Remove an asset. Rejected while a shot, layer, cue or other asset still uses it (the error lists where); change those first.
- `add_asset_state`(asset, state): Add another look of an asset (lamp on, coat soaked, street at night), used as "<asset>@<state>".
- `update_asset_state`(asset, id, patch): Change fields of an asset state (name, prompt, references, qa).
- `add_shot`(shot, after): Add a shot. "after": the shot id to insert after (omit to append at the end; null to insert first). Add a long story in batches of shots.
- `update_shot`(id, patch): Change fields of a shot (title, description, durationSec, clip, inSec, dialogue, qa, render, effects (each may set applyTo: main, overlay or all), …). Schema 3.1: a shot has no prompt; change the prompt, references, camera, keyframe or genDurationSec of its clip with update_asset (a shared clip changes every shot that uses it).
- `remove_shot`(id): Remove a shot, its connections and its own (auto) clip. Rejected while a cue, last-frame link or other shot still needs it; change those first.
- `set_shot_layers`(id, layers): Replace all layers of a shot (text, html, image, video), drawn in order on top. [] removes them. Text layers may set anim.inParams, e.g. the typewriter cursor { cursor, blink, after: blink|hide|fade, scramble }. A layer is linked to its shot's main clip on Send to timeline unless it sets link: false (RULE 46).
- `set_shot_background`(id, background): Give a still shot a colour or gradient background (sets "render": "still"); null removes it. Use clip or background, not both.
- `set_shot_params`(id, params, replace): Set the params of an html shot's clip (e.g. a title card's text). Merged into the current values; null removes one; "replace": true replaces them all.
- `reorder_shots`(id, index, order): Move one shot ("id" + 0-based "index") or give the whole new "order" (every shot id once).
- `set_connection`(connection, remove): Set the connection between two adjacent shots (kind cut / continuity / match, note, transition). "remove": true deletes it.
- `add_cue`(cue): Add an audio cue (voiceover, music, sfx, ambience, sting, dialogue) that plays from a shot: an audio "asset", or "source": { "fromVideo", "inSec"?, "outSec"? } to use the sound of a video asset or of a shot's clip. Gets "audio<n>" as id when you give none.
- `update_cue`(id, patch): Change fields of an audio cue (from, to, atSec, volume, fades, loop, volumeKeys, fx, position { azimuth, distance, width? }, pan, positionKeys, source { fromVideo, inSec?, outSec? }, …).
- `remove_cue`(id): Remove an audio cue.
- `list_series_assets` · read-only: List the shared assets of the Series this project belongs to (id, type, name, short description, states). Reuse them with use_series_asset instead of defining a new character, prop, location or style.
- `use_series_asset`(id, as): Add a Series asset to the board, linked: its definition, states and uploads come from the Series and stay in sync. Then use its id (or "<id>@<state>") in shots.
- `promote_to_series`(id): Add a board asset to the project's Series so later episodes can reuse it (sets "series": true; the app adds it with its uploads and links it). If the Series already has that id, the board links to it (dedupe by id).
- `validate` · read-only: Run the importer's checks on the current storyboard and list its warnings (edits are already checked; this reports what is left to improve).
- `export_json` · read-only: The whole storyboard as storyboard JSON ("dionysus.storyboard/1"), edits included.
- `send_to_timeline`: Update the timeline from the storyboard (update mode): adds shots that have a clip and new audio cues, switches changed clips and refreshes shot text; everything else on the timeline stays. Shots without an uploaded clip are skipped. New layers and in-shot cues are linked to their shot's main clip (moved, trimmed and deleted with it) unless they set link: false.
- `sync_to_storyboard`: Write timeline edits back to the storyboard (one undo step): clip lengths, order and trims, layers, effects and audio cues of the shots they came from. Timeline clips with no shot become new shots, layers or cues flagged needsPrompt; shots whose clip was removed are kept and flagged removedFromTimeline. Afterwards call list_needs_prompt and fill every item.
- `list_needs_prompt` · read-only: List the shots, layers and audio cues flagged needsPrompt (made on the timeline by Sync to Storyboard). Fill each: a shot needs a description (update_shot) and a clip generation prompt on its clip asset (update_asset), a layer or cue needs a description (set_shot_layers / update_cue); filling it clears the flag.
<!-- tools:end -->

Patch tools (`update_*`, `set_shot_params`) merge the given fields; `null` deletes a field. Ids can't be renamed.

## Timeline review and edit tools (P12)

**Audit (October 2026).** Before P12 every WebMCP tool came from `STORY_TOOLS` in `src/v2/domain/storyAgent.ts`, which only edits the *storyboard*. The only ways an agent could touch the timeline were `send_to_timeline` and `sync_to_storyboard`. It couldn't read clip positions, move, trim, split or delete a clip, change a clip's volume, effect or transform, or see a frame. P12 adds the tools below (schemas in `src/v2/domain/timelineReview.ts`, runtime in `src/v2/ui/agent/timelineTools.ts`). The panel's tool list and the activity log include them. Unregistering now goes by tool name, not by index.

- Times are in **seconds**. Clip and track ids come from `get_timeline`.
- Each edit tool dispatches **one undo step** labelled with the tool name, and returns the changed clip as JSON (`split_clip` returns both halves). Linked layers follow their main clip as they do with a hand edit.
- `capture_frame` and `contact_sheet` render through the export path (an offline player with exact decoded video frames) and return an MCP **image** (`{ "type": "image", "data": <base64 JPEG>, "mimeType": "image/jpeg" }`) after a text part.
- `review_lint` runs the model checks (needsPrompt items, shots removed from the timeline, clips shorter than `minClipSec`, gaps on the main track, overlay layers not linked to a main clip, text whose estimated box (lines × size × line height high, longest line × size × 0.55 wide, times the clip scale; no font metrics) runs past a frame edge, media whose asset or stored blob is missing). With `media` (on by default) it also samples about 40 frames for **black frames** and decodes the export audio mix for **clipping** (samples at full scale) and **silence** (under -60 dBFS for 2 s or more).
- P13: `set_clip_props` validates everything before changing anything: unknown properties or transform fields, values out of range (volume 0..2, speed 0.25..4, transform ranges, crop 0..0.95, text size 0.005..1), an `effect` on a clip that is not an effect clip, unknown `videoEffect` presets or params (checked against the preset registry, e.g. `blur`) and unknown blend modes fail the call with every reason listed; nothing is clamped.
- P14: `set_clip_props` also takes `position` / `positionKeys` (t in seconds) / `pan` / `trackPosition` (clips with sound only, validated like the rest) and `audioOutput` (project-wide stereo | binaural, room | outdoor). `get_timeline` lists clip and track `position` / `positionKeys` and `settings.audioOutput`. A stereo file keeps its own L/R image (`width` default 1); see STORYBOARD_FORMAT.md P14-SPATIAL.

<!-- timeline-tools:start -->
- `get_timeline` · read-only: The timeline as JSON: settings (size, fps), duration, and every track (id, kind, group, main) with its clips (id, start/duration/in in seconds, asset, type, volume, effect, transform, text, link parent, storyShot). Times are seconds.
- `capture_frame`(timeSec, maxWidth) · read-only: Render the composited frame at timeSec exactly as export would and return it as a JPEG image (maxWidth px wide, default 640, at most 1280).
- `capture_shot_frame`(shotId, frameOf, slotId, atSec): Storyboard frame references ("frameOf", RULE 50): grab the frame at atSec of the source shot's selected clip and store it as the picked frame (a PNG version with { frameOf, atSec, sourceVersionId }) of the target shot's frameOf reference. Give "shotId" (the target shot) and, when it has several frame references, "frameOf" (the source shot) or "slotId". atSec defaults to the reference's atSec. Fails when the source shot has no clip yet (generate it first). One undo step; returns the state and the PNG.
- `contact_sheet`(count, interval, maxWidth) · read-only: One JPEG grid of frames across the whole timeline, each labelled with its time. Give "count" (frames, default 12, max 36) or "interval" (seconds between frames). Use it to review the cut at a glance.
- `review_lint`(minClipSec, media) · read-only: List review problems with times and clip ids: storyboard items needing a prompt, shots removed from the timeline, very short clips, gaps and black frames, overlay clips not linked to a main clip, audio clipping or long silence, text off the frame, and missing media. Fix them with the edit tools, then run it again.
- `move_clip`(id, startSec, trackId): Move a clip to startSec, optionally onto another track (trackId of the same kind). Linked layers move with a main clip. One undo step; returns the clip.
- `trim_clip`(id, edge, atSec, ripple): Move a clip's left or right edge to atSec on the timeline. ripple: true closes/opens the gap on the main track. One undo step; returns the clip.
- `split_clip`(id, atSec): Split a clip at atSec (inside it). One undo step; returns both halves.
- `delete_clip`(ids, ripple): Delete one or more clips (and the layers linked to them). ripple: true closes the gap on the main track. One undo step.
- `set_clip_props`(id, volume, transform, effect, fades, speed, blend, text, position, positionKeys, pan, trackPosition, audioOutput): Change a clip in one undo step: volume (0..2), transform { x, y, scale, rotation, opacity } (null resets), effect { preset, params } (effect clips only; videoEffect preset ids and param ranges as in get_guide), fades { inSec, outSec }, speed (0.25..4), blend, text (text clips only: { text, size, color, … }); P14 sound position (clips with sound): position { azimuth -180..180 (0 front, -90 left, 90 right, ±180 behind), distance 0..1 (0 at the ear, 1 ≈ 20 m), width? 0..1 (1 keeps a stereo file's own image) } or null (centre, unprocessed), pan -1..1 (shorthand: azimuth = pan × 90), positionKeys [{ t: seconds from the clip start, azimuth, distance }] or null, trackPosition (default for the clip's track) and audioOutput { mode: stereo | binaural, environment?: room | outdoor } (whole project). Values are never clamped: an unknown preset, param, field or an out-of-range value fails the whole call with the reason and nothing changes. Returns the clip.
- `add_clip`(assetId, startSec, trackId): Place a project media asset (id from get_timeline's "assets") at startSec, on trackId or the main track / a matching track. One undo step; returns the new clip.
<!-- timeline-tools:end -->

Rule 48 (`review-timeline`) tells an AI to finish a timeline edit with `get_timeline`, then `review_lint` and `contact_sheet`, and to fix what they report.

## Series (P5)

When the open project is an episode of a Series, the agent sees the Series too:

- `get_guide` ends with the **SERIES ASSETS** list (ids and short descriptions).
- `list_series_assets` lists them with their states and version counts.
- `use_series_asset({ id, as? })` adds one to the board, linked: its definition, states and uploads come from the Series and stay in sync.
- `promote_to_series({ id })` marks a board asset with `"series": true`; the app adds it (with its versions) to the Series and links it. An existing Series asset with that id is reused (dedupe by id).
- Every mutating call checks `seriesRef` against the Series: a missing id is rejected with the list of Series ids.

Editing a linked asset changes it in every episode. The user can detach it on the board (Asset → Detach from series) to give this episode its own copy.

## Long stories in parts (no WebMCP)

Any chat AI can produce a long storyboard in parts, which you paste into **Storyboard → Import** one after another:

1. **Outline first.** Ask the AI for a plain-text outline: the numbered shot list (id, title, length, one-line beat) and the asset list. Fix it in chat.
2. **Part 1** is a normal, complete storyboard: `format`, `meta`, every asset known so far and the first 8-12 shots.
3. **Later parts** have a `part` object and no `meta`:

```json
{
  "format": "dionysus.storyboard/1",
  "schemaVersion": "3.1",
  "part": { "index": 2, "of": 4, "after": "s10" },
  "shots": [{ "id": "s11", "title": "…", "durationSec": 5, "clip": "s11-clip" }],
  "assets": [{ "id": "s11-clip", "name": "Clip · …", "type": "video", "prompt": "…", "references": ["hero"], "qa": ["…", "…"] }],
  "audio": []
}
```

Schema 3.1 (P16): every tool reads and writes the clip-centric form. A shot has no `prompt`; it names its clip (a `video` asset) in `clip` and may start a shared clip at `inSec`. Edit a clip's prompt, references, camera, keyframe or `genDurationSec` with `update_asset`; a shared clip changes every shot that uses it. `get_storyboard` returns `"schemaVersion": "3.1"`, and a 3.0 board (prompts on shots) is migrated when it is loaded.

Import merges a part into the current board by id: same id → replaced, new id → added (new shots after `part.after`, else at the end), `"part": { "remove": ["s7"] }` deletes, `meta` fields (if any) are merged. The merged board is validated as a whole and shown as a diff before you apply it, and applying is one undo step. The rule `long-story-parts` in the guide tells the AI how to do this. See [STORYBOARD_FORMAT.md §4.8](STORYBOARD_FORMAT.md).
