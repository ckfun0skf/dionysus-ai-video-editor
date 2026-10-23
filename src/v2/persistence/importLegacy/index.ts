/**
 * Import Dionysus legacy projects into schema 3.0.
 * Accepts a schema-1.0 project JSON or a "dionysus-project-document" 2.0 envelope (root composition is
 * authoritative there). Pure: returns the project plus blobs to store (data: URLs) and warnings.
 * Deterministic ids are derived from legacy ids so imports are reproducible (golden-tested).
 */
import { SCHEMA, TICKS_PER_SECOND, ops, trackKindFor, type Asset, type Composition, type MediaKind, type Project, type Track } from "../../domain";

export interface LegacyImport { project: Project; blobs: { key: string; dataUrl: string }[]; warnings: string[]; sourceVersion: "1.0" | "2.0" }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const ticks = (seconds: number) => Math.max(0, Math.round(seconds * TICKS_PER_SECOND));

interface Clip { id: string; trackId: string; start: number; duration: number; sourceIn: number; assetId?: string; volume?: number }
interface Lane { id: string; name: string; kind: string; muted?: boolean }

export function importLegacy(json: unknown, now = new Date().toISOString()): LegacyImport {
  if (!isRec(json)) throw new Error("Not a Dionysus project file.");
  let legacy: Rec, lanes: Lane[], clips: Clip[], sourceVersion: "1.0" | "2.0";
  const warnings: string[] = [];
  if (json.format === "dionysus-project-document") {
    if (json.documentVersion !== "2.0" || !isRec(json.project) || !isRec(json.compositionModel) || !isRec(json.compositionModel.rootComposition)) throw new Error("Unsupported or malformed project document (expected version 2.0).");
    legacy = json.project; sourceVersion = "2.0";
    const root = json.compositionModel.rootComposition as Rec;
    lanes = (Array.isArray(root.tracks) ? root.tracks : []).filter(isRec).sort((a, b) => num(a.order) - num(b.order)).map((t) => ({ id: str(t.id), name: str(t.name), kind: str(t.kind), muted: t.muted === true }));
    clips = (Array.isArray(root.placements) ? root.placements : []).filter(isRec).map((p) => {
      const src = isRec(p.source) ? p.source : {};
      const children = Array.isArray(p.linkedAudioChildren) ? p.linkedAudioChildren.length : 0;
      if (children) warnings.push(`Clip "${str(p.name, str(p.id))}": linked audio is not supported yet and plays from the video element.`);
      return { id: str(p.id), trackId: str(p.trackId), start: num(p.start), duration: num(p.duration), sourceIn: num(p.sourceIn), assetId: src.type === "asset" ? str(src.assetId) : undefined, volume: isRec(p.legacyData) && typeof p.legacyData.volume === "number" ? p.legacyData.volume : undefined };
    });
  } else if (json.schemaVersion === "1.0") {
    legacy = json; sourceVersion = "1.0";
    lanes = (Array.isArray(json.tracks) ? json.tracks : []).filter(isRec).map((t) => ({ id: str(t.id), name: str(t.name), kind: str(t.kind), muted: t.muted === true }));
    clips = (Array.isArray(json.timelineClips) ? json.timelineClips : []).filter(isRec).map((c) => ({ id: str(c.id), trackId: str(c.trackId), start: num(c.start), duration: num(c.duration), sourceIn: num(c.sourceIn), assetId: typeof c.assetId === "string" ? c.assetId : undefined, volume: typeof c.volume === "number" ? c.volume : undefined }));
  } else throw new Error("Unsupported file. Expected a Dionysus schema-1.0 project or a 2.0 project document.");

  const assets: Record<string, Asset> = {};
  const blobs: LegacyImport["blobs"] = [];
  for (const a of (Array.isArray(legacy.assets) ? legacy.assets : []).filter(isRec)) {
    const kind = a.kind as MediaKind;
    if (kind !== "video" && kind !== "image" && kind !== "audio") { warnings.push(`Asset "${str(a.name)}" (${str(a.kind)}) is not supported in v2 yet and was skipped.`); continue; }
    const id = `legacy_${str(a.id)}`;
    const blobKey = `${id}/v1`;
    const path = str(a.path);
    if (path.startsWith("data:")) blobs.push({ key: blobKey, dataUrl: path });
    else warnings.push(`Asset "${str(a.name)}" has no embedded media; relink it by importing the file again.`);
    const mime = path.startsWith("data:") ? path.slice(5, path.indexOf(";")) : "";
    assets[id] = { id, kind, name: str(a.name, "Untitled"), selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: str(a.createdAt, now), media: { blobKey, mime, durationTicks: kind === "image" ? undefined : a.duration !== undefined ? ticks(num(a.duration)) : undefined }, provenance: { source: "legacy", inputs: [] } }] };
  }

  const tracks: Track[] = [];
  for (const l of lanes) {
    if (l.kind !== "video" && l.kind !== "audio") { warnings.push(`Track "${l.name}" (${l.kind}) is not supported in v2 yet and was skipped.`); continue; }
    tracks.push({ id: `legacy_${l.id}`, kind: l.kind, name: l.name || (l.kind === "video" ? "Video" : "Audio"), muted: l.muted || undefined, placements: [] });
  }
  if (!tracks.some((t) => t.kind === "video")) tracks.unshift({ id: "legacy_video", kind: "video", name: "Video 1", placements: [] });
  if (!tracks.some((t) => t.kind === "audio")) tracks.push({ id: "legacy_audio", kind: "audio", name: "Audio 1", placements: [] });

  const compId = `legacy_${str(legacy.id, "project")}_root`;
  let comp: Composition = { id: compId, name: "Master Timeline", tracks };
  for (const c of [...clips].sort((x, y) => x.start - y.start)) {
    const asset = c.assetId ? assets[`legacy_${c.assetId}`] : undefined;
    if (!asset) { warnings.push(`Clip ${c.id} references unsupported or missing media and was skipped.`); continue; }
    const track = tracks.find((t) => t.id === `legacy_${c.trackId}` && t.kind === trackKindFor(asset.kind)) ?? tracks.find((t) => t.kind === trackKindFor(asset.kind))!;
    const durationTicks = ticks(c.duration);
    if (durationTicks < ops.MIN_DURATION_TICKS) { warnings.push(`Clip ${c.id} is too short and was skipped.`); continue; }
    const before = ticks(c.start);
    comp = ops.insertPlacement(comp, track.id, { id: `legacy_${c.id}`, startTicks: before, durationTicks, sourceInTicks: ticks(c.sourceIn), source: { kind: "assetVersion", assetId: asset.id, versionId: asset.versions[0].id }, clipType: asset.kind, volume: c.volume ?? 1 });
    const placed = comp.tracks.find((t) => t.id === track.id)!.placements.find((p) => p.id === `legacy_${c.id}`)!;
    if (placed.startTicks !== before) warnings.push(`Clip ${c.id} overlapped another clip and was moved to ${(placed.startTicks / TICKS_PER_SECOND).toFixed(2)}s.`);
  }

  const project: Project = {
    schema: SCHEMA, id: `legacy_${str(legacy.id, "project")}`, name: str(legacy.name, "Imported project"),
    settings: { width: num(legacy.width, 1920), height: num(legacy.height, 1080), fps: num(legacy.frameRate, 30) },
    rootCompositionId: compId, assets, compositions: { [compId]: comp },
    meta: { createdAt: str(legacy.createdAt, now), updatedAt: now },
  };
  return { project, blobs, warnings, sourceVersion };
}
