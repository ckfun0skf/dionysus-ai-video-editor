/**
 * P12-REVIEW: timeline tools for the WebMCP agent (read the timeline, lint it for review problems) and the schema of
 * the timeline edit and frame capture tools. Pure: the UI (ui/agent/timelineTools) runs the edits through engine
 * commands (one undo step each) and adds the checks that need decoded media (frames, audio).
 */
import { audioOutputOf } from "./spatial";
import { compositionDuration, transformOf, versionOf, type Placement, type Project, type Track } from "./model";
import { mainTrack } from "./ops";
import { codeRoleOf } from "./codeRoles";
import { needsPromptItems } from "./storySync";
import { missingTrackers } from "./codeInputs";
import { TICKS_PER_SECOND } from "./time";
import { textOf } from "./text";
import { maskToJson } from "./mask";

type Schema = Record<string, unknown>;
export interface TimelineToolDef { name: string; title: string; description: string; inputSchema: Schema; readOnly: boolean }

const num = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
const str = (description: string): Schema => ({ type: "string", description });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

export const TIMELINE_TOOLS: TimelineToolDef[] = [
  { name: "get_timeline", title: "Read the timeline", readOnly: true,
    description: "The timeline as JSON: settings (size, fps), duration, and every track (id, kind, group, main) with its clips (id, start/duration/in in seconds, asset, type, volume, effect, transform, text, link parent, storyShot, version, pinnedVersion, mask). Times are seconds. version is the take showing now; pinnedVersion is set when this clip stays on that take instead of following the storyboard. mask, when present, is a clip visibility mask (source-picture fractions; key times in seconds) — not an effect limit and not a tracker box mask (that stays on tracks[].mask).",
    inputSchema: obj({}) },
  { name: "capture_frame", title: "Capture a frame", readOnly: true,
    description: "Render the composited frame at timeSec exactly as export would and return it as a JPEG image (maxWidth px wide, default 640, at most 1280).",
    inputSchema: obj({ timeSec: num("Time in seconds."), maxWidth: num("Image width in px (default 640, max 1280).") }, ["timeSec"]) },
  { name: "capture_shot_frame", title: "Capture a frame of an earlier shot", readOnly: false,
    description: "Storyboard frame references (\"frameOf\", RULE 50): grab the frame at atSec of the source shot's selected clip and store it as the picked frame (a PNG version with { frameOf, atSec, sourceVersionId }) of the target shot's frameOf reference. Give \"shotId\" (the target shot) and, when it has several frame references, \"frameOf\" (the source shot) or \"slotId\". atSec defaults to the reference's atSec. Fails when the source shot has no clip yet (generate it first). One undo step; returns the state and the PNG.",
    inputSchema: obj({ shotId: str("Target shot id (the shot that uses the frame)."), frameOf: str("Source shot id (optional when the target has one frame reference)."), slotId: str("The frame reference slot id, e.g. \"s2.frameof.s1\" (instead of shotId / frameOf)."), atSec: num("Seconds into the source clip (default: the reference's atSec, else 0).") }) },
  { name: "contact_sheet", title: "Contact sheet", readOnly: true,
    description: "One JPEG grid of frames across the whole timeline, each labelled with its time. Give \"count\" (frames, default 12, max 36) or \"interval\" (seconds between frames). Use it to review the cut at a glance.",
    inputSchema: obj({ count: num("Number of frames (default 12, max 36)."), interval: num("Seconds between frames (overrides count)."), maxWidth: num("Sheet width in px (default 1280).") }) },
  { name: "review_lint", title: "Review the timeline", readOnly: true,
    description: "List review problems with times and clip ids: storyboard items needing a prompt, shots removed from the timeline, very short clips, gaps and black frames, overlay clips not linked to a main clip, audio clipping or long silence, text off the frame, and missing media. Fix them with the edit tools, then run it again.",
    inputSchema: obj({ minClipSec: num("Clips shorter than this are flagged (default 0.5)."), media: { type: "boolean", description: "Also decode frames and audio for black frames, clipping and silence (default true; slower)." } }) },
  { name: "move_clip", title: "Move a clip", readOnly: false,
    description: "Move a clip to startSec, optionally onto another track (trackId of the same kind). Linked layers move with a main clip. One undo step; returns the clip.",
    inputSchema: obj({ id: str("Clip id."), startSec: num("New start in seconds."), trackId: str("Target track id (default: the clip's track).") }, ["id", "startSec"]) },
  { name: "trim_clip", title: "Trim a clip", readOnly: false,
    description: "Move a clip's left or right edge to atSec on the timeline. ripple: true closes/opens the gap on the main track. One undo step; returns the clip.",
    inputSchema: obj({ id: str("Clip id."), edge: { type: "string", enum: ["left", "right"] }, atSec: num("New edge time in seconds."), ripple: { type: "boolean" } }, ["id", "edge", "atSec"]) },
  { name: "import_subtitles", title: "Import subtitles from SRT/VTT text", readOnly: false,
    description: "Add pasted SRT or WebVTT text as subtitle cues (each cue a text clip). Without trackId a new subtitle layer is created; with trackId the cues are pasted onto that existing text track and inherit its Caption style. Cues need a 00:00:01,000 --> 00:00:03,000 timing line. One undo step; returns the number of cues.",
    inputSchema: obj({ text: str("The SRT or VTT text."), trackId: str("Optional existing text track id to paste onto.") }, ["text"]) },
  { name: "add_blank_clip", title: "Add a blank (solid colour) clip", readOnly: false,
    description: "Add a solid colour clip at atSec: track \"main\" inserts it on the main track (later clips move up like any insert), \"overlay\" puts it on the first overlay layer with room (else a new one). color is #rrggbb; durationSec defaults to 3. To change the colour later call set_blank_color. One undo step; returns the clip.",
    inputSchema: obj({ track: { type: "string", enum: ["main", "overlay"] }, atSec: num("Timeline start in seconds."), color: str("#rrggbb"), durationSec: num("Length in seconds (default 3).") }, ["track", "atSec", "color"]) },
  { name: "add_code_effect", title: "Add a code effect", readOnly: false,
    description: "Add an effect clip that runs a code package with \"role\": \"effect\" (get_timeline lists it under assets with \"role\": \"effect\") from atSec for durationSec (default 3) on the Effects layer. applyTo \"main\" (default) changes the main track before overlays and text; \"all\" changes the finished frame. Each frame the package gets that picture as ctx.source. A package of another role is rejected. One undo step; returns the clip.",
    inputSchema: obj({ assetId: str("Code package asset id (role effect)."), atSec: num("Timeline start in seconds."), durationSec: num("Length in seconds (default 3)."), applyTo: { type: "string", enum: ["main", "all"] } }, ["assetId", "atSec"]) },
  { name: "set_code_transition", title: "Use a code transition on a cut", readOnly: false,
    description: "Use a code package with \"role\": \"transition\" on the cut into clipId (a main-track clip that starts where another ends). It draws ctx.from (outgoing) and ctx.to (incoming) over ctx.progress 0 → 1. durationSec defaults to 0.5 (each clip gives at most half of itself). A package of another role is rejected. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("The incoming clip of the cut."), assetId: str("Code package asset id (role transition)."), durationSec: num("Transition length in seconds (default 0.5).") }, ["clipId", "assetId"]) },
  { name: "set_clip_input", title: "Choose where a code clip's input reads from", readOnly: false,
    description: "A code clip's manifest \"inputs\" are references (numbers only, as ctx.inputs[name]) of three types: \"graphic\" (a picture: { luma, avgColor, motion, histogram[16] }; sources: \"program\" = the picture under the clip (default), a video track name, \"track:<id>\" or \"clip:<id>\" of a main or overlay clip), \"audio\" (a sound: { rms, peak, bands[8], onset, envelope }; sources: \"mix\" = everything you hear (default), an audio-carrying track or clip) and \"tracker\" ({ x, y, width, height, scale, rotation, found }; sources: \"none\" (default), \"clip:<clip id>#<tracker id>\" from get_timeline tracks[], or \"clip:<clip id>#@<tracker name>\" for a tracker the user still has to set (found:false until it exists)). The older type names \"scene\", \"beat\" and \"track\" mean graphic, audio and tracker. Bindings store ids, so renaming a track keeps them. source omitted = back to the default. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Code (html) clip id."), input: str("Input name from the clip's manifest."), source: str("mix | program | a track name | track:<id> | clip:<id>; omit to reset.") }, ["clipId", "input"]) },
  { name: "rename_track", title: "Rename a track (layer)", readOnly: false,
    description: "Rename a track (get_timeline lists track ids and names). Names are for people and for set_clip_input; bindings use the id, so nothing breaks. 1-40 characters. One undo step.",
    inputSchema: obj({ trackId: str("Track id."), name: str("New name.") }, ["trackId", "name"]) },
  { name: "track_clip", title: "Add a tracker to a video clip", readOnly: false,
    description: "Host-side region tracker (classic template matching with a scale search, not AI subject segmentation; best on high-contrast features that stay in view). Adds a new tracker (\"Track 1\", \"Track 2\"…; a clip can have several, each independent) or re-analyses trackId. region = the box to follow on the frame at atSec (default: the range start), as fractions 0-1 of the video frame { x, y, w, h } (x/y = top-left). The box grows and shrinks with the feature. fromSec / toSec (timeline seconds inside the clip) limit the tracker to part of the clip (default: whole clip); outside that range and on lost frames (the feature left the picture or the match is too weak) there is no position: code inputs get found:false, followers hold, an inside mask hides the clip. followers = clip ids (text, photo, overlay, code) that follow the box; mask \"inside\" / \"outside\". One undo step; returns the tracker id, frames, unstable and lost counts and a few positions.",
    inputSchema: obj({ clipId: str("Video clip id."), region: obj({ x: num("Left, 0-1 of the frame width."), y: num("Top, 0-1 of the frame height."), w: num("Width, 0-1."), h: num("Height, 0-1.") }, ["x", "y", "w", "h"]), atSec: num("Timeline time of the frame the region is drawn on (default: range start)."), fromSec: num("Range start, timeline seconds (default: clip start)."), toSec: num("Range end, timeline seconds (default: clip end)."), trackId: str("Re-analyse this tracker instead of adding one."), name: str("Tracker name (default Track n)."), followers: { type: "array", items: { type: "string" }, description: "Clip ids that follow the box." }, mask: { type: "string", enum: ["inside", "outside"] } }, ["clipId", "region"]) },
  { name: "get_track", title: "Read a tracker's positions", readOnly: true,
    description: "Positions of tracker trackId on clipId (trackId may be omitted when the clip has one tracker) every everySec seconds (default 0.5) across its range: { t, found, x, y, width, height, scale, conf } with x/y the box centre and width/height its size as fractions 0-1 of the output frame, scale vs the first box, conf 0-1. found:false rows (lost or weak) carry no position.",
    inputSchema: obj({ clipId: str("Tracked video clip id."), trackId: str("Tracker id (get_timeline lists tracks[] on the clip)."), everySec: num("Spacing in seconds (default 0.5).") }, ["clipId"]) },
  { name: "attach_track", title: "Make a clip follow a tracker", readOnly: false,
    description: "Make clipId (text, photo, overlay or code clip overlapping the tracker's range) follow tracker trackId of targetId (trackId required when the target has several). Its current offset from the box, measured at atSec, is kept; scale follows the changing box size unless scale is false; rotation follows the target clip. Lost / out-of-range frames get no key (the follower holds). Written as x/y/scale keyframes you can still edit. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Follower clip id."), targetId: str("Tracked video clip id."), trackId: str("Tracker id on targetId."), atSec: num("Time at which the current offset is measured."), scale: { type: "boolean", description: "Follow the box size (default true)." } }, ["clipId", "targetId"]) },
  { name: "set_track_mask", title: "Mask a tracked clip by a tracker's box", readOnly: false,
    description: "Traveling mask from tracker trackId of clipId: \"inside\" shows the clip only inside the box (hidden where the feature is lost or outside the range), \"outside\" cuts the box out, \"off\" removes it. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Tracked video clip id."), trackId: str("Tracker id."), mask: { type: "string", enum: ["inside", "outside", "off"] } }, ["clipId", "mask"]) },
  { name: "set_track_range", title: "Change the part of a clip a tracker covers", readOnly: false,
    description: "Set tracker trackId's range on clipId to fromSec–toSec (timeline seconds inside the clip). Shrinking drops the analysis outside the new range; extending analyses only the new part, starting from the box at the old edge. Optional name renames the tracker. One undo step; returns the tracker.",
    inputSchema: obj({ clipId: str("Tracked video clip id."), trackId: str("Tracker id."), fromSec: num("Range start, timeline seconds."), toSec: num("Range end, timeline seconds."), name: str("New tracker name.") }, ["clipId", "trackId"]) },
  { name: "list_unused_assets", title: "List unused media and old versions", readOnly: true,
    description: "What Clean up project would offer: \"unused\" = assets nothing uses (no clip, code effect or transition, storyboard slot or shot, binding of a used code clip, or source of a used asset), and \"oldVersions\" = versions of kept assets that are not selected and that nothing points at. Pass the ids you choose to delete_assets.",
    inputSchema: obj({}, []) },
  { name: "delete_assets", title: "Delete unused media and old versions", readOnly: false,
    description: "Remove unused assets (assetIds) and old versions (versions: [{ assetId, versionId }]) that list_unused_assets reports; anything still in use is refused with the reason. One undo step (Clean up project). Their files are freed after the next start.",
    inputSchema: obj({ assetIds: { type: "array", items: { type: "string" }, description: "Unused asset ids." }, versions: { type: "array", items: obj({ assetId: str("Asset id."), versionId: str("Old version id.") }, ["assetId", "versionId"]), description: "Old versions to remove." } }, []) },
  { name: "set_blank_color", title: "Change a blank clip's colour", readOnly: false,
    description: "Set the colour (#rrggbb) of a blank clip (get_timeline shows \"blank\": \"#rrggbb\" on it). One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Blank clip id."), color: str("#rrggbb") }, ["clipId", "color"]) },
  { name: "audio_prompt", title: "Prompt for an AI-written audio clip", readOnly: true,
    description: "Returns the prompt that asks an AI for a sound or music clip in the dionysus.audioclip/1 JSON format (rendered in the browser to WAV). Pass the JSON reply to create_audio.",
    inputSchema: obj({ name: str("Short name of the sound."), brief: str("What it should sound like."), durationSec: num("Length in seconds (optional).") }, ["brief"]) },
  { name: "create_audio", title: "Create audio from audio clip JSON", readOnly: false,
    description: "Render a dionysus.audioclip/1 JSON clip (the AI's reply to audio_prompt, or your own) to WAV, import it as an audio asset and add it on an audio track at atSec (default: 0). Invalid JSON is rejected with the problems listed. One undo step; returns the clip.",
    inputSchema: obj({ json: { type: ["string", "object"], description: "The audio clip JSON (or the reply containing a ```json block)." }, atSec: num("Timeline start in seconds.") }, ["json"]) },
  { name: "slip_clip", title: "Slip a clip's source range", readOnly: false,
    description: "Show a different part of the source inside a video, audio or HTML clip: set the source in point to inSec. The clip keeps its timeline position and length; inSec is clamped so the range stays inside the media. moveLinked: true slips linked audio/overlays by the same amount. Images and text cannot slip. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Clip id."), inSec: num("New source in point in seconds."), moveLinked: { type: "boolean" } }, ["clipId", "inSec"]) },
  { name: "replace_clip_asset", title: "Replace a clip's asset", readOnly: false,
    description: "Swap the media of a clip for another asset of the same kind, keeping every other property (position, length, effects, links). The in point is kept when it fits, otherwise moved earlier. If the new source is shorter than the clip, pass onShort: \"shorten\" (clip ends with the source) or \"hold\" (keep length, freeze the last frame); without it the call fails and explains. One undo step; returns the clip. On a shot placeholder (get_timeline \"placeholder\": true) any video, image or html asset fills it in place. On a main-track clip that came from a storyboard shot, the asset is added as a new version of that shot and pinned to THIS clip only (split halves and copies stay on their takes). If the new take is longer than the clip/shot, pass fit \"trim\" (keep the shot length; inSec picks the start, default 0) or \"full\" (use the whole take; later clips move when ripple is true); without fit the call fails and explains. A shorter take shortens the clip (ripple follows ripple). mode \"new\" (default) adds a version; mode \"replace\" overwrites the clip's current take in place (other clips showing that take update).",
    inputSchema: obj({ clipId: str("Clip id."), assetId: str("Asset id of the same kind."), onShort: { type: "string", enum: ["shorten", "hold"] }, fit: { type: "string", enum: ["trim", "full"] }, inSec: num("When fit is trim: start of the kept segment in the new take (default 0)."), ripple: { type: "boolean", description: "When fit is full or the take is shorter: move later main-track clips (default false)." }, mode: { type: "string", enum: ["new", "replace"], description: "new (default) adds a version pinned to this clip; replace overwrites the current take in place." } }, ["clipId", "assetId"]) },
  { name: "split_clip", title: "Split a clip", readOnly: false,
    description: "Split a clip at atSec (inside it). One undo step; returns both halves.",
    inputSchema: obj({ id: str("Clip id."), atSec: num("Split time in seconds.") }, ["id", "atSec"]) },
  { name: "delete_clip", title: "Delete clips", readOnly: false,
    description: "Delete one or more clips (and the layers linked to them). ripple: true closes the gap on the main track. One undo step.",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Clip ids." }, ripple: { type: "boolean" } }, ["ids"]) },
  { name: "set_clip_props", title: "Set clip properties", readOnly: false,
    description: "Change a clip in one undo step: volume (0..2), transform { x, y, scale, rotation, opacity } (null resets), effect { preset, params } (effect clips only; videoEffect preset ids and param ranges as in get_guide), fades { inSec, outSec }, speed (0.25..4), blend, text (text clips only: { text, size, color, … }); P14 sound position (clips with sound): position { azimuth -180..180 (0 front, -90 left, 90 right, ±180 behind), distance 0..1 (0 at the ear, 1 ≈ 20 m), width? 0..1 (1 keeps a stereo file's own image) } or null (centre, unprocessed), pan -1..1 (shorthand: azimuth = pan × 90), positionKeys [{ t: seconds from the clip start, azimuth, distance }] or null, trackPosition (default for the clip's track) and audioOutput { mode: stereo | binaural, environment?: room | outdoor } (whole project). Values are never clamped: an unknown preset, param, field or an out-of-range value fails the whole call with the reason and nothing changes. Returns the clip.",
    inputSchema: obj({ id: str("Clip id."), volume: num("0..2 (1 = unchanged)."), transform: { type: ["object", "null"] }, effect: { type: "object" }, fades: { type: "object" }, speed: num("0.25..4."), blend: str("Blend mode id."), text: { type: "object" }, position: { type: ["object", "null"] }, positionKeys: { type: ["array", "null"] }, pan: num("-1..1 shorthand for azimuth = pan × 90."), trackPosition: { type: ["object", "null"] }, audioOutput: { type: "object" } }, ["id"]) },
  { name: "promote_overlay", title: "Promote an overlay clip to the main track", readOnly: false,
    description: "Move a video, image or HTML clip from an overlay track onto the main track. mode \"replace\" (default) keeps its time and replaces what the main track shows there: covered main clips are removed, partly covered ones are trimmed, and a clip spanning it is split (the right part continues at the right in point). mode \"insert\" puts it in at its start and ripples later main clips (and their linked layers) by its duration; if it starts inside a main clip, give position \"before\" or \"after\" that clip (the call fails without it). Blend mode and chroma key are dropped; the transform is kept unless keepTransform is false; its audio is kept. One undo step; returns the main track.",
    inputSchema: obj({ clipId: str("Overlay clip id."), mode: { type: "string", enum: ["replace", "insert"] }, position: { type: "string", enum: ["before", "after"] }, keepTransform: { type: "boolean", description: "Keep position / scale / rotation / opacity / crop (default true)." } }, ["clipId"]) },
  { name: "merge_layer_up", title: "Merge a layer into the layer above", readOnly: false,
    description: "Move every clip of trackId into the layer directly above it on screen in the same group (the one drawn over it; or targetTrackId, which must be in the same group) and remove the emptied layer, the same as the Merge up button on a layer. Clips keep their times. If a moved clip overlaps a clip on the target, the call fails and lists the conflicts unless resolve is given: \"shift\" moves the incoming clip later to the first gap that fits, \"trimExisting\" cuts the existing clip away under it, \"trimIncoming\" keeps only the parts of the incoming clip that fall in gaps, \"pushLater\" ripples the existing clips later. resolve is one value for all or { clipId: value } per clip. dryRun returns the conflicts without changing anything. One undo step; returns the target layer's clips.",
    inputSchema: obj({ trackId: str("Layer (track) id to merge up."), targetTrackId: str("Layer to merge into (default: the one directly above)."), resolve: { type: ["string", "object"], description: "shift | trimExisting | trimIncoming | pushLater, or { clipId: one of them }." }, dryRun: { type: "boolean", description: "Only list the conflicts." } }, ["trackId"]) },
  { name: "insert_clip_after", title: "Insert a clip after a main clip", readOnly: false,
    description: "Insert a video, image or html asset on the main track immediately after afterClipId (a main-track clip id from get_timeline). Later main clips move later by the new clip's length, and gaps after the insert keep their length. Layers and subtitles linked to those clips (link.parent, including captions sent with a shot) keep their offset from the clip they belong to; a layer with no link stays put. An audio asset, or a code package whose role is effect or transition, is rejected. One undo step; returns the new clip. In the editor the same action is \"Insert new clip after current clip\": current clip is the selected main-track clip (one selection), or the selected main clip under the playhead when several main clips are selected (otherwise the earliest selected), otherwise the main clip under the playhead, otherwise the nearest main clip that ends at or before the playhead.",
    inputSchema: obj({ assetId: str("Video, image or html asset id."), afterClipId: str("Main-track clip id to insert after.") }, ["assetId", "afterClipId"]) },
    { name: "paste_clips", title: "Paste copies of clips", readOnly: false,
    description: "Copy clipIds and paste them in one undo step, the same as the editor paste dialog. where \"after\" inserts after the current main clip (afterClipId, or the same current-clip rules as insert_clip_after) and ripples later clips on the receiving track. where \"end\" puts them at the end of that clip's chain (or 0 with no current clip) and ripples. where \"playhead\" places them at playheadSec (required) without rippling; the call fails if any receiving track already has a clip in that gap (it does not slide or ripple). trackId sends compatible clips to that track (a track id from get_timeline); \"new\" creates a new compatible layer (overlay for ordinary video, never a second main). Without trackId, clips keep their original tracks. One undo step; returns the new clips.",
    inputSchema: obj({ clipIds: { type: "array", items: { type: "string" }, description: "Clip ids to copy." }, where: { type: "string", enum: ["after", "end", "playhead"] }, afterClipId: str("Optional main-track clip to treat as current."), playheadSec: num("Required when where is playhead: timeline time in seconds."), trackId: str("Destination track id, or \"new\".") }, ["clipIds", "where"]) },
{ name: "add_clip", title: "Add a clip from an asset", readOnly: false,
    description: "Place a project media asset (id from get_timeline's \"assets\") at startSec, on trackId or the main track / a matching track. One undo step; returns the new clip.",
    inputSchema: obj({ assetId: str("Media asset id."), startSec: num("Start in seconds."), trackId: str("Track id (optional).") }, ["assetId", "startSec"]) },
  { name: "even_split_words", title: "Even-split caption word timings", readOnly: false,
    description: "P47: invent evenly spaced word timings for a text/caption clip from its text and length (whitespace words, or characters for CJK). One undo step; returns the clip with words[].",
    inputSchema: obj({ clipId: str("Text clip id.") }, ["clipId"]) },
  { name: "set_caption_words", title: "Set caption word timings", readOnly: false,
    description: "P47: set words [{ text, atSec }] on a text clip (seconds from the clip start; clamped in order). Pass mode \"word-highlight\" to keep one cue with karaoke highlighting, or \"word-pop\" to expand into one short clip per word (entrance pop|fade|slide-up). One undo step.",
    inputSchema: obj({ clipId: str("Text clip id."), words: { type: "array", items: obj({ text: str("Word token."), atSec: num("Seconds from clip start.") }, ["text", "atSec"]), description: "Word timings." }, mode: { type: "string", enum: ["word-highlight", "word-pop", "keep"] }, entrance: { type: "string", enum: ["pop", "fade", "slide-up"] } }, ["clipId", "words"]) },
  { name: "set_clip_mask", title: "Mask a clip's picture", readOnly: false,
    description: "P49: set a visibility mask on an image, video or HTML clip (not text, not an effect). The mask multiplies that clip's alpha. It does not limit an effect such as blur (use applyTo for effect scope) and it does not change a tracker's box mask (set_track_mask). shape is rect, ellipse, linear (a split; rotation 0 keeps the top half), band (a strip / mirror bar of width w) or path. Coordinates are fractions of the source picture from the top-left, not of the frame. rect/ellipse: x,y centre, w,h size, rotation degrees clockwise, rect radius 0-0.5 of the smaller side. path: nodes [{ id, x, y, in?: {x,y}, out?: {x,y} }] with at least 3 points (closed; handles are Bezier offsets). feather 0-0.5 and expand -0.5 to 0.5 are fractions of the shorter side. invert and enabled (false bypasses). track is the name or id of a tracker on this same clip; lost and out-of-range frames hold the last found position and never invent one. keys and nodeKeys animate numbers (t in seconds from the clip start); path keys are by node id, so adding or deleting a point does not renumber the others. A bad or unclosed path is rejected and nothing changes. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Image, video or HTML clip id."), mask: { type: "object", description: "Mask object. See the description. Pass clear_clip_mask to remove it." } }, ["clipId", "mask"]) },
  { name: "clear_clip_mask", title: "Remove a clip's visibility mask", readOnly: false,
    description: "P49: remove the visibility mask from a clip (the tracker box mask, if any, stays). One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Clip id.") }, ["clipId"]) },
  { name: "set_clip_version", title: "Set a clip's version pin", readOnly: false,
    description: "Pin one timeline clip to a version of its asset, or pass versionId null to follow the storyboard's current version (asset.selectedVersionId). Split halves and pasted copies of the same shot pick independently. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Clip id."), versionId: { type: ["string", "null"], description: "Asset version id, or null to follow the storyboard." } }, ["clipId", "versionId"]) },
  { name: "delete_version", title: "Delete an asset version", readOnly: false,
    description: "Remove one version of an asset (a shot take). Cannot delete the last remaining version. Clips pinned to it or currently showing it switch to fallbackVersionId (default: the shot's current version if that remains, else the newest remaining). Reports the affected clips. Stored media is dropped only if nothing else references it. One undo step.",
    inputSchema: obj({ assetId: str("Asset id."), versionId: str("Version id to delete."), fallbackVersionId: str("Version remaining clips should switch to (optional).") }, ["assetId", "versionId"]) },
  { name: "word_align_prompt", title: "Prompt to align caption words with AI", readOnly: true,
    description: "P47: returns a copy-paste prompt that asks an external AI for word timings JSON for the caption clip (Dionysus does not call an AI). Optional audioClipId adds that clip's duration to the prompt. Paste the reply into set_caption_words.",
    inputSchema: obj({ clipId: str("Text clip id."), audioClipId: str("Optional narration/dialogue audio or video clip id.") }, ["clipId"]) },
  { name: "set_track_caption_style", title: "Set a track's Caption style", readOnly: false,
    description: "P60: set the Caption style of a text/subtitle track to none, word-highlight or word-pop. The style applies to every clip on that track (including clips added later and SRT imported or pasted onto it). Clips without words get an even split (spaces → words; CJK → characters). word-pop expands each cue into one short clip per word (entrance pop|fade|slide-up). highlight is optional { pending, current, spoken } each { color (#rrggbb), opacity 0–1, scale, weight 100–900 }; defaults match the previous look (pending opacity 0.4, current #20d5ec and scale +0.08, spoken = the clip colour). Preview and export use the same styles. Clips with a caption override are left alone. One undo step.",
    inputSchema: obj({ trackId: str("Text or subtitle track id."), mode: { type: "string", enum: ["none", "word-highlight", "word-pop"] }, highlight: { type: "object", description: "Optional pending/current/spoken styles: each { color, opacity, scale, weight }." }, entrance: { type: "string", enum: ["pop", "fade", "slide-up"] } }, ["trackId", "mode"]) },
  { name: "track_word_align_prompt", title: "Prompt to align every caption on a track with AI", readOnly: true,
    description: "P60: returns one copy-paste prompt that lists every cue on the text track (id, text, start/end). Dionysus does not call an AI. Paste the reply (one JSON object covering all cues) into set_track_caption_words.",
    inputSchema: obj({ trackId: str("Text or subtitle track id."), audioClipId: str("Optional narration/dialogue audio or video clip id.") }, ["trackId"]) },
  { name: "set_track_caption_words", title: "Set word timings for every cue on a track", readOnly: false,
    description: "P60: apply word timings to every caption on a text track in one undo step. Pass cues [{ id, words: [{ text, atSec }] }] matching every clip on the track, or json as the pasted AI reply (a { cues: [...] } object or a map of cue id → words). Times are seconds from each cue start and are clamped in order. Invalid JSON or a reply that skips a cue changes nothing.",
    inputSchema: obj({ trackId: str("Text or subtitle track id."), cues: { type: "array", items: obj({ id: str("Cue clip id."), words: { type: "array", items: obj({ text: str("Word token."), atSec: num("Seconds from cue start.") }, ["text", "atSec"]) } }, ["id", "words"]), description: "One entry per cue." }, json: str("Optional pasted JSON covering all cues (alternative to cues).") }, ["trackId"]) },
];

export const TIMELINE_TOOL_NAMES = new Set(TIMELINE_TOOLS.map((t) => t.name));

export function timelineToolsMarkdown(): string {
  return TIMELINE_TOOLS.map((t) => {
    const props = Object.keys((t.inputSchema.properties as Schema | undefined) ?? {});
    return `- \`${t.name}\`${props.length ? `(${props.join(", ")})` : ""}${t.readOnly ? " · read-only" : ""}: ${t.description}`;
  }).join("\n");
}

const sec = (t: number) => Math.round((t / TICKS_PER_SECOND) * 1000) / 1000;
const rootOf = (p: Project) => p.compositions[p.rootCompositionId];

/** One clip as agent JSON (seconds). */
export function clipJson(p: Project, pl: Placement, track?: Track): Record<string, unknown> {
  const tr = track ?? rootOf(p).tracks.find((t) => t.placements.some((x) => x.id === pl.id));
  const asset = p.assets[pl.source.assetId];
  return {
    id: pl.id, track: tr?.id, type: pl.clipType, start: sec(pl.startTicks), duration: sec(pl.durationTicks), end: sec(pl.startTicks + pl.durationTicks), in: sec(pl.sourceInTicks),
    ...(asset ? { asset: asset.id, name: asset.name } : {}),
    ...(pl.volume !== undefined ? { volume: pl.volume } : {}),
    ...(pl.speed && pl.speed !== 1 ? { speed: pl.speed } : {}),
    ...(pl.transform ? { transform: { ...transformOf(pl) } } : {}),
    ...(pl.effect ? { effect: pl.effect } : {}),
    ...(pl.text ? { text: pl.text.text } : {}),
    ...(pl.position ? { position: pl.position } : {}),
    ...(pl.positionKeys?.length ? { positionKeys: pl.positionKeys.map((k) => ({ ...k, t: sec(k.t) })) } : {}),
    ...(pl.fadeInTicks || pl.fadeOutTicks ? { fades: { inSec: sec(pl.fadeInTicks ?? 0), outSec: sec(pl.fadeOutTicks ?? 0) } } : {}),
    ...(pl.link ? { linkedTo: pl.link.parent } : {}),
    ...(pl.storyShot ? { storyShot: pl.storyShot } : {}),
    ...(pl.source.versionId ? { version: pl.source.versionId } : {}),
    ...(pl.versionId ? { pinnedVersion: pl.versionId } : {}),
    ...(pl.placeholder ? { placeholder: true, label: pl.placeholder.label } : {}),
    ...(pl.blank ? { blank: pl.blank.color } : {}),
    ...(pl.motionTracks?.length ? { tracks: pl.motionTracks.map((t) => ({ id: t.id, name: t.name, sourceInSec: sec(t.inS), sourceOutSec: sec(t.outS), frames: t.samples.length, lost: t.samples.filter((x) => x.lost).length, ...(t.mask ? { mask: t.mask } : {}) })) } : {}),
    ...(pl.mask ? { mask: maskToJson(pl.mask) } : {}),
    ...(pl.htmlInputs ? { inputs: pl.htmlInputs } : {}),
    ...(pl.storyLayer ? { storyLayer: pl.storyLayer } : {}),
    ...(pl.storyCue ? { storyCue: pl.storyCue } : {}),
  };
}

export function timelineJson(p: Project): Record<string, unknown> {
  const c = rootOf(p), main = mainTrack(c);
  return {
    settings: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps, audioOutput: audioOutputOf(p) },
    duration: sec(compositionDuration(c)),
    tracks: c.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, ...(t.group ? { group: t.group } : {}), ...(t === main ? { main: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}), ...(t.position ? { position: t.position } : {}), ...(t.captionStyle ? { captionStyle: t.captionStyle } : {}), clips: t.placements.map((pl) => clipJson(p, pl, t)) })),
    assets: Object.values(p.assets).filter((a) => a.kind !== "text" && a.kind !== "effect").map((a) => ({ id: a.id, kind: a.kind, name: a.name, ...(codeRoleOf(a) !== "clip" ? { role: codeRoleOf(a) } : {}) })),
    ...(c.subtitles?.length ? { subtitles: c.subtitles.length } : {}),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
/** Average glyph advance as a share of the font size (a sans-serif estimate: the model has no font metrics). */
export const TEXT_ADVANCE = 0.55;
/**
 * P13: estimated box of a text clip in frame fractions (0..1 = inside): lines × size × line height high, the longest
 * line × size × TEXT_ADVANCE wide (size is a share of the frame height), times the clip scale, centred on x/y.
 */
export function textBounds(pl: Placement, aspect: number) {
  const tf = transformOf(pl), d = textOf(pl.text);
  const lines = d.text.split("\n");
  const h = lines.length * d.size * (d.lineHeight ?? 1.25) * tf.scale;
  const w = (Math.max(1, ...lines.map((l) => [...l].length)) * d.size * TEXT_ADVANCE * tf.scale) / aspect;
  const cx = 0.5 + tf.x, cy = 0.5 + tf.y;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
}

export type LintKind = "needs-prompt" | "removed-from-timeline" | "short-clip" | "gap" | "black-frame" | "unlinked-layer" | "audio-clipping" | "audio-silence" | "text-off-frame" | "missing-asset" | "placeholder" | "needs-tracking";
export interface LintIssue { kind: LintKind; severity: "error" | "warning" | "info"; message: string; atSec?: number; clip?: string; shot?: string }

/**
 * The model-only review checks. `hasBlob` (optional) says whether a media blob is stored; without it, missing media
 * means an asset/version that no longer exists. Black frames, clipping and silence need decoded media (UI side).
 */
export function reviewLint(p: Project, o: { minClipSec?: number; hasBlob?: (key: string) => boolean } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const c = rootOf(p), main = mainTrack(c), min = (o.minClipSec ?? 0.5) * TICKS_PER_SECOND;
  for (const it of needsPromptItems(p.storyboard)) out.push({ kind: "needs-prompt", severity: "warning", message: it.label, ...(it.shot ? { shot: it.shot } : {}) });
  const sb = p.storyboard;
  for (const id of sb?.order ?? []) if (sb?.shots[id]?.removedFromTimeline) out.push({ kind: "removed-from-timeline", severity: "info", shot: id, message: `Shot "${sb.shots[id].title}" was removed from the timeline (kept on the board).` });
  // P43: a code clip references a tracker by name that nobody has set yet (like a placeholder: a warning, not a block).
  for (const m of missingTrackers(p)) out.push({ kind: "needs-tracking", severity: "warning", clip: m.clipId, message: `Clip ${m.clipId} input "${m.input}" follows tracker "${m.name}" on clip ${m.targetId}, which isn't set yet (found:false until then). Select ${m.targetId}, tap Track, draw the box and name the tracker "${m.name}" (or track_clip { clipId: "${m.targetId}", name: "${m.name}", … }).` });
  for (const t of c.tracks) for (const pl of t.placements) {
    const at = sec(pl.startTicks);
    if (pl.durationTicks < min) out.push({ kind: "short-clip", severity: "warning", clip: pl.id, atSec: at, message: `Clip ${pl.id} is only ${sec(pl.durationTicks)}s long.` });
    if (t !== main && t.kind !== "audio" && t.kind !== "effect" && main && main.placements.length && !pl.link) out.push({ kind: "unlinked-layer", severity: "info", clip: pl.id, atSec: at, message: `Layer ${pl.id} on ${t.name} isn't linked to a main clip; it won't follow edits.` });
    if (pl.placeholder) {
      out.push({ kind: "placeholder", severity: "warning", clip: pl.id, atSec: at, ...(pl.storyShot ? { shot: pl.storyShot } : {}), message: `${pl.placeholder.label} is a placeholder (${sec(pl.durationTicks)}s): its clip isn't generated yet, so it exports as a black frame. Add the shot's clip, then send_to_timeline (Update) or replace_clip_asset on ${pl.id}.` });
      continue;
    }
    if (pl.clipType !== "text" && pl.clipType !== "effect") {
      const v = versionOf(p, pl.source);
      if (!v) out.push({ kind: "missing-asset", severity: "error", clip: pl.id, atSec: at, message: `Clip ${pl.id} points to media that no longer exists.` });
      else if (o.hasBlob && !o.hasBlob(v.media.blobKey)) out.push({ kind: "missing-asset", severity: "error", clip: pl.id, atSec: at, message: `The media of clip ${pl.id} (${p.assets[pl.source.assetId]?.name ?? "?"}) is missing from this browser.` });
    }
    if (pl.clipType === "text") {
      const b = textBounds(pl, p.settings.width / p.settings.height);
      const out1 = [b.left < -0.001 && "left", b.right > 1.001 && "right", b.top < -0.001 && "top", b.bottom > 1.001 && "bottom"].filter(Boolean);
      if (out1.length)
        out.push({ kind: "text-off-frame", severity: "warning", clip: pl.id, atSec: at, message: `Text ${pl.id} runs past the ${out1.join(" and ")} edge of the frame (estimated box ${r2(b.left)}–${r2(b.right)} × ${r2(b.top)}–${r2(b.bottom)} of the frame).` });
    }
  }
  if (main) {
    const ps = [...main.placements].sort((a, b) => a.startTicks - b.startTicks);
    let end = 0;
    for (const pl of ps) {
      if (pl.startTicks - end > 1) out.push({ kind: "gap", severity: "warning", atSec: sec(end), message: `Gap on the main track from ${sec(end)}s to ${sec(pl.startTicks)}s (black frame).` });
      end = Math.max(end, pl.startTicks + pl.durationTicks);
    }
  }
  return out;
}
