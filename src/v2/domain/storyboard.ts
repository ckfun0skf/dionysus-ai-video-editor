/**
 * Storyboard domain (schema 3.1, V2-CUT-01/09). Pure data + pure ops on a Project.
 * Uploads live as ordinary project Asset versions (one backing asset per slot / per shot clip),
 * so selection is `asset.selectedVersionId`. The storyboard keeps what the timeline doesn't need:
 * prompts, QA checks, and per-version facts frozen at upload time (inputs used, QA results, the
 * clip version a last frame came from). Staleness ("may not match") is derived, never stored.
 */
import { newId, type AssetVersion, type MediaKind, type MediaRef, type Project } from "./model";
import type { StoryAssetType, StoryConnection, StoryDoc, StoryMeta } from "./storyJson";

export interface QaCheck { id: string; text: string }
export type QaResult = "pass" | "fail";
export type SlotSource = { type: "generate" } | { type: "upload" } | { type: "lastFrame"; shotId: string };

/** A reference asset the story needs (character sheet, location, last frame of shot X …). */
export interface AssetSlot {
  id: string; name: string; type: StoryAssetType; aspect: string; prompt: string;
  /** Other slots this one is generated from. */
  references: string[];
  source: SlotSource; qa: QaCheck[]; notes?: string;
  /** Backing project asset; created on first upload. */
  assetId?: string;
  skipped?: boolean;
}

export interface Shot {
  id: string; title: string; description: string; durationSec: number; prompt: string;
  slotIds: string[]; qa: QaCheck[]; camera?: string; dialogue?: string;
  /** Backing video asset holding the clip versions; created on first upload. */
  assetId?: string;
  skipped?: boolean;
}

/** Facts about one uploaded version, frozen when it was added. */
export interface VersionInfo {
  /** Slot versions this version was made from (references / shot assets), at upload time. */
  inputs: { slotId: string; versionId: string }[];
  /** For last-frame slots: the clip version the frame was extracted from. */
  derivedFrom?: { shotId: string; versionId: string };
  qa?: Record<string, QaResult>;
  model?: string;
}

export interface Storyboard {
  format: "dionysus.storyboard/1";
  meta: StoryMeta;
  order: string[];
  shots: Record<string, Shot>;
  slots: Record<string, AssetSlot>;
  connections: StoryConnection[];
  versions: Record<string, VersionInfo>;
}

const qaList = (owner: string, texts: string[]): QaCheck[] => texts.map((text, i) => ({ id: `${owner}.qa${i + 1}`, text }));

/** Build a storyboard from a validated StoryDoc (see storyJson.validateStoryboard). */
export function storyboardFromDoc(doc: StoryDoc): Storyboard {
  const slots: Record<string, AssetSlot> = {};
  for (const a of doc.assets) {
    slots[a.id] = {
      id: a.id, name: a.name, type: a.type, aspect: a.aspect, prompt: a.prompt, references: [...a.references],
      source: a.source.type === "lastFrame" ? { type: "lastFrame", shotId: a.source.shot } : { type: a.source.type },
      qa: qaList(a.id, a.qa), ...(a.notes ? { notes: a.notes } : {}),
    };
  }
  const shots: Record<string, Shot> = {};
  for (const s of doc.shots) {
    shots[s.id] = {
      id: s.id, title: s.title, description: s.description, durationSec: s.durationSec, prompt: s.prompt,
      slotIds: [...s.assets], qa: qaList(s.id, s.qa), ...(s.camera ? { camera: s.camera } : {}), ...(s.dialogue ? { dialogue: s.dialogue } : {}),
    };
  }
  return { format: "dionysus.storyboard/1", meta: { ...doc.meta }, order: doc.shots.map((s) => s.id), shots, slots, connections: doc.connections.map((c) => ({ ...c })), versions: {} };
}

export function setStoryboard(p: Project, board: Storyboard | undefined): Project {
  const next = { ...p };
  if (board) next.storyboard = board; else delete next.storyboard;
  return next;
}

/** Selected version id of a slot or shot (via its backing asset). */
export function selectedOf(p: Project, owner: { assetId?: string }): string | undefined {
  const a = owner.assetId ? p.assets[owner.assetId] : undefined;
  return a?.selectedVersionId ?? a?.versions.at(-1)?.id;
}

export function versionsOf(p: Project, owner: { assetId?: string }): AssetVersion[] {
  return (owner.assetId && p.assets[owner.assetId]?.versions) || [];
}

const kindForSlot = (t: StoryAssetType): MediaKind => (t === "video" ? "video" : t === "audio" ? "audio" : "image");

type Target = { slot: string } | { shot: string };

/**
 * Upload a new version into a slot or shot and select it. Inputs (and the last-frame source for
 * derived slots) are frozen from the current selections so later changes can be detected.
 */
export function addStoryVersion(p: Project, target: Target, media: MediaRef, opts: { versionId?: string; model?: string; now?: string; derivedFrom?: { shotId: string; versionId: string } } = {}): Project {
  const b = p.storyboard;
  if (!b) return p;
  const isSlot = "slot" in target;
  const owner = isSlot ? b.slots[target.slot] : b.shots[target.shot];
  if (!owner) return p;
  const inputIds = isSlot ? (owner as AssetSlot).references : (owner as Shot).slotIds;
  const inputs = inputIds.flatMap((slotId) => { const s = b.slots[slotId]; const v = s && selectedOf(p, s); return v ? [{ slotId, versionId: v }] : []; });
  let derivedFrom = opts.derivedFrom;
  if (isSlot && !derivedFrom && (owner as AssetSlot).source.type === "lastFrame") {
    const shotId = ((owner as AssetSlot).source as { shotId: string }).shotId;
    const v = b.shots[shotId] && selectedOf(p, b.shots[shotId]);
    if (v) derivedFrom = { shotId, versionId: v };
  }
  const version: AssetVersion = {
    id: opts.versionId ?? newId("ver"), createdAt: opts.now ?? new Date().toISOString(), media,
    provenance: { source: derivedFrom ? "derived" : "manual-generation", promptText: owner.prompt || undefined, inputs: inputs.map((i) => ({ assetId: b.slots[i.slotId].assetId!, versionId: i.versionId })) },
  };
  const assetId = owner.assetId ?? newId("ast");
  const prev = p.assets[assetId];
  const name = isSlot ? (owner as AssetSlot).name : `${b.order.indexOf(owner.id) + 1}. ${(owner as Shot).title}`;
  const asset = prev ? { ...prev, versions: [...prev.versions, version], selectedVersionId: version.id }
    : { id: assetId, kind: isSlot ? kindForSlot((owner as AssetSlot).type) : ("video" as MediaKind), name, versions: [version], selectedVersionId: version.id };
  const info: VersionInfo = { inputs, ...(derivedFrom ? { derivedFrom } : {}), ...(opts.model ? { model: opts.model } : {}) };
  const nextOwner = { ...owner, assetId, skipped: undefined };
  const board: Storyboard = {
    ...b,
    slots: isSlot ? { ...b.slots, [owner.id]: nextOwner as AssetSlot } : b.slots,
    shots: isSlot ? b.shots : { ...b.shots, [owner.id]: nextOwner as Shot },
    versions: { ...b.versions, [version.id]: info },
  };
  return { ...p, assets: { ...p.assets, [assetId]: asset }, storyboard: board };
}

/** Select an existing version of a slot/shot backing asset. */
export function selectStoryVersion(p: Project, assetId: string, versionId: string): Project {
  const a = p.assets[assetId];
  if (!a || !a.versions.some((v) => v.id === versionId) || a.selectedVersionId === versionId) return p;
  return { ...p, assets: { ...p.assets, [assetId]: { ...a, selectedVersionId: versionId } } };
}

export function setQaResult(p: Project, versionId: string, checkId: string, result: QaResult | undefined): Project {
  const b = p.storyboard, info = b?.versions[versionId];
  if (!b || !info) return p;
  const qa = { ...info.qa };
  if (result) qa[checkId] = result; else delete qa[checkId];
  return { ...p, storyboard: { ...b, versions: { ...b.versions, [versionId]: { ...info, qa } } } };
}

/** Why a slot or shot's selected version "may not match". Empty reasons = up to date. */
export interface Staleness { stale: boolean; reasons: string[] }
export interface StoryStatus { slots: Record<string, Staleness>; shots: Record<string, Staleness> }

/**
 * Derive "may not match" warnings. A version is stale when anything it was made from has since
 * changed (a different version is selected) or is itself stale — so a change propagates
 * transitively down every last-frame and reference chain.
 */
export function storyStatus(p: Project): StoryStatus {
  const b = p.storyboard;
  const out: StoryStatus = { slots: {}, shots: {} };
  if (!b) return out;
  const visiting = new Set<string>();
  const shotLabel = (id: string) => `shot ${b.order.indexOf(id) + 1}${b.shots[id] ? ` “${b.shots[id].title}”` : ""}`;
  const slotLabel = (id: string) => `“${b.slots[id]?.name ?? id}”`;
  const inputsReasons = (info: VersionInfo | undefined, ids: string[]) => {
    const reasons: string[] = [];
    for (const slotId of ids) {
      const s = b.slots[slotId];
      if (!s) continue;
      const cur = selectedOf(p, s);
      const used = info?.inputs.find((i) => i.slotId === slotId)?.versionId;
      if (cur && used && used !== cur) reasons.push(`made with an older version of ${slotLabel(slotId)}`);
      else if (cur && info && !used) reasons.push(`made before ${slotLabel(slotId)} was uploaded`);
      else if (slot(slotId).stale) reasons.push(`${slotLabel(slotId)} may not match`);
    }
    return reasons;
  };
  const slot = (id: string): Staleness => {
    if (out.slots[id]) return out.slots[id];
    if (visiting.has(id)) return { stale: false, reasons: [] };
    visiting.add(id);
    const s = b.slots[id];
    const v = selectedOf(p, s);
    const info = v ? b.versions[v] : undefined;
    const reasons: string[] = [];
    if (v) {
      if (s.source.type === "lastFrame") {
        const src = b.shots[s.source.shotId];
        const cur = src && selectedOf(p, src);
        if (cur && info?.derivedFrom && info.derivedFrom.versionId !== cur) reasons.push(`taken from an older version of ${shotLabel(s.source.shotId)}`);
        else if (src && shot(src.id).stale) reasons.push(`${shotLabel(src.id)} may not match`);
      }
      reasons.push(...inputsReasons(info, s.references));
    }
    visiting.delete(id);
    return (out.slots[id] = { stale: reasons.length > 0, reasons });
  };
  const shot = (id: string): Staleness => {
    if (out.shots[id]) return out.shots[id];
    if (visiting.has(id)) return { stale: false, reasons: [] };
    visiting.add(id);
    const s = b.shots[id];
    const v = selectedOf(p, s);
    const reasons = v ? inputsReasons(b.versions[v], s.slotIds) : [];
    visiting.delete(id);
    return (out.shots[id] = { stale: reasons.length > 0, reasons });
  };
  Object.keys(b.slots).forEach(slot);
  Object.keys(b.shots).forEach(shot);
  return out;
}
