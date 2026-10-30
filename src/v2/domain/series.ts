/**
 * P5 (item 14): Series — a library of assets shared by every episode of a show.
 *
 * A Series holds characters, props, locations, styles (any reusable asset) with their authored definition (the same
 * JSON a storyboard asset has, states included) and all their versions (uploads, picks and version info). Each
 * episode is an ordinary project with `seriesId`; a board asset with `seriesRef` is linked to the Series asset:
 * - `pullSeries` brings the Series definition and versions into every linked asset of a project (Series wins);
 * - `captureLinked` writes edits made to linked assets in an episode back to the Series;
 * - `promoteToSeries` adds a project asset to the Series (dedupe by id: an existing Series asset is reused);
 * - `detachFromSeries` keeps the episode's current copy and stops following the Series.
 *
 * Pure: no storage, no DOM. The UI keeps Series in local storage and runs these functions.
 */
import type { Asset, Project } from "./model";
import type { AssetSlot, Storyboard, VersionInfo } from "./storyboard";
import { mergeStoryboard, storyboardToDoc } from "./storyRoundtrip";
import { storyDocJson, validateStoryboard, type StoryAsset } from "./storyJson";

export const SERIES_FORMAT = "dionysus.series/1";
type Obj = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One asset's media in the Series: the project asset that holds its versions, and their version info. */
export interface SeriesMedia { asset: Asset; info: Record<string, VersionInfo> }
export interface SeriesAsset {
  id: string;
  /** Authored storyboard JSON of the asset (type, name, prompt, references, states, …) without "id". */
  def: Obj;
  /** Short description for prompts and the library (the asset's notes, else the start of its prompt). */
  description: string;
  /** Versions by slot: "" is the base look, "@<state>" a state. */
  media: Record<string, SeriesMedia>;
  updatedAt: string;
}
export interface Series {
  format: typeof SERIES_FORMAT;
  id: string;
  name: string;
  description?: string;
  assets: Record<string, SeriesAsset>;
  createdAt: string;
  updatedAt: string;
}
/** One line of the Series asset list (prompts, the library, list_series_assets). */
export interface SeriesAssetSummary { id: string; type: string; name: string; description: string; states: string[]; versions: number }

const rid = () => Math.random().toString(36).slice(2, 10);
export function createSeries(name: string, now = new Date().toISOString(), id = `series_${rid()}`): Series {
  return { format: SERIES_FORMAT, id, name: name.trim() || "Untitled series", assets: {}, createdAt: now, updatedAt: now };
}

/** A Series read from storage or a file; undefined when it isn't one. */
export function parseSeries(v: unknown): Series | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Partial<Series>;
  if (s.format !== SERIES_FORMAT || typeof s.id !== "string" || typeof s.name !== "string" || !s.assets || typeof s.assets !== "object") return undefined;
  for (const [k, a] of Object.entries(s.assets)) if (!a || typeof a !== "object" || a.id !== k || !a.def || typeof a.def !== "object" || !a.media || typeof a.media !== "object") return undefined;
  return { ...s, createdAt: s.createdAt ?? new Date(0).toISOString(), updatedAt: s.updatedAt ?? new Date(0).toISOString() } as Series;
}

/** Short description: the asset's notes, else its prompt without the "References:" block, cut to about 140 characters. */
export function describeAsset(def: Obj): string {
  const notes = typeof def.notes === "string" ? def.notes.trim() : "";
  let text = notes || (typeof def.prompt === "string" ? def.prompt : "");
  if (!notes && /^References:/i.test(text.trim())) text = text.split(/\n\s*\n/).slice(1).join(" ") || text;
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137).replace(/\s+\S*$/, "")}…` : text;
}

export function seriesAssetList(series: Series): SeriesAssetSummary[] {
  return Object.values(series.assets).map((a) => ({
    id: a.id, type: String(a.def.type ?? ""), name: String(a.def.name ?? a.id), description: a.description,
    states: Array.isArray(a.def.states) ? (a.def.states as Obj[]).map((s) => String(s.id)) : [],
    versions: Object.values(a.media).reduce((t, m) => t + m.asset.versions.length, 0),
  })).sort((x, y) => x.type.localeCompare(y.type) || x.id.localeCompare(y.id));
}

/** The Series asset list for the copy prompt, the guide and get_guide: ids plus a short description. */
export function seriesPromptSection(series: Series): string {
  const rows = seriesAssetList(series);
  const head = `This video is an episode of the series "${series.name}". The series already has these assets. Reuse them by id instead of redefining them: in "assets" write only { "id": "<id>", "seriesRef": "<id>" } (Dionysus fills in the definition, states and uploads), and use the id (or "<id>@<state>") in shots as usual. Add "series": true to a new asset that later episodes should reuse too.`;
  if (!rows.length) return `${head}\n\n(No series assets yet.)`;
  return `${head}\n\n${rows.map((r) => `- "${r.id}" (${r.type}) ${r.name}${r.description ? ` — ${r.description}` : ""}${r.states.length ? ` · states: ${r.states.join(", ")}` : ""}`).join("\n")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Project side

const stateSuffix = (base: string, id: string) => (id === base ? "" : id.startsWith(`${base}@`) ? id.slice(base.length) : undefined);
/** The base slot and its state slots, with their media keys ("" and "@<state>"). */
function slotFamily(b: Storyboard, base: string): { slot: AssetSlot; key: string }[] {
  return Object.values(b.slots).flatMap((s) => {
    if (s.id !== base && s.stateOf !== base) return [];
    const key = stateSuffix(base, s.id);
    return key === undefined ? [] : [{ slot: s, key }];
  });
}
/** Base slots linked to a Series asset: slot id → Series asset id. */
export function linkedSlots(p: Project): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of Object.values(p.storyboard?.slots ?? {})) if (s.seriesRef && !s.stateOf) out.set(s.id, s.seriesRef);
  return out;
}

/** The authored definition and media of a board asset (as the Series stores it). */
export function captureAsset(p: Project, slotId: string): { def: Obj; media: Record<string, SeriesMedia> } | undefined {
  const b = p.storyboard;
  if (!b?.slots[slotId]) return undefined;
  const a = storyboardToDoc(b).assets.find((x) => x.id === slotId);
  if (!a) return undefined;
  const authored = JSON.parse(storyDocJson({ ...storyboardToDoc(b), assets: [a] })).assets[0] as Obj;
  const { id: _id, seriesRef: _r, series: _s, implicit: _i, ...def } = authored;
  const media: Record<string, SeriesMedia> = {};
  for (const { slot, key } of slotFamily(b, slotId)) {
    const asset = slot.assetId ? p.assets[slot.assetId] : undefined;
    if (!asset) continue;
    media[key] = { asset: clone(asset), info: Object.fromEntries(asset.versions.flatMap((v) => (b.versions[v.id] ? [[v.id, clone(b.versions[v.id])]] : []))) };
  }
  return { def, media };
}

/** Union of two media maps by version id; `keep` decides the selected version and asset name. */
function mergeMedia(keep: Record<string, SeriesMedia>, add: Record<string, SeriesMedia>): Record<string, SeriesMedia> {
  const out = clone(keep);
  for (const [k, m] of Object.entries(add)) {
    const o = out[k];
    if (!o) { out[k] = clone(m); continue; }
    const ids = new Set(o.asset.versions.map((v) => v.id));
    o.asset.versions.push(...clone(m.asset.versions.filter((v) => !ids.has(v.id))));
    for (const [vid, info] of Object.entries(m.info)) o.info[vid] ??= clone(info);
    o.asset.selectedVersionId ??= m.asset.selectedVersionId;
  }
  return out;
}

const touch = (s: Series, now: string, assets: Record<string, SeriesAsset>): Series => ({ ...s, assets, updatedAt: now });

/**
 * Add a board asset to the Series and link it (P5 "Promote to series"). Dedupe by id: when the Series already has an
 * asset with that id, the episode links to it (the Series definition wins) and its versions are added to the Series.
 */
export function promoteToSeries(series: Series, p: Project, slotId: string, now = new Date().toISOString()): { series: Series; project: Project; deduped: boolean } | undefined {
  const b = p.storyboard, slot = b?.slots[slotId];
  if (!b || !slot || slot.stateOf || slot.implicit || slot.keyframeOf || slot.source.type === "lastFrame") return undefined;
  const id = slot.seriesRef ?? slotId;
  const cap = captureAsset(p, slotId);
  if (!cap) return undefined;
  const existing = series.assets[id];
  const entry: SeriesAsset = existing
    ? { ...existing, media: mergeMedia(existing.media, cap.media), updatedAt: now }
    : { id, def: cap.def, description: describeAsset(cap.def), media: cap.media, updatedAt: now };
  const next = touch(series, now, { ...series.assets, [id]: entry });
  const { seriesPromote: _p, ...rest } = slot;
  const linked: Project = { ...p, storyboard: { ...b, slots: { ...b.slots, [slotId]: { ...rest, seriesRef: id } } } };
  return { series: next, project: pullSeries(linked, next), deduped: !!existing };
}

/** Promote every asset imported with "series": true. */
export function promoteFlagged(series: Series, p: Project, now = new Date().toISOString()): { series: Series; project: Project; promoted: string[] } {
  let s = series, q = p;
  const promoted: string[] = [];
  for (const slot of Object.values(p.storyboard?.slots ?? {})) {
    if (!slot.seriesPromote) continue;
    const r = promoteToSeries(s, q, slot.id, now);
    if (r) { s = r.series; q = r.project; promoted.push(slot.id); }
  }
  return { series: s, project: q, promoted };
}

/** Stop following the Series: the episode keeps the asset as it is now (definition and versions). */
export function detachFromSeries(p: Project, slotId: string): Project {
  const b = p.storyboard, slot = b?.slots[slotId];
  if (!b || !slot?.seriesRef) return p;
  const { seriesRef: _r, ...rest } = slot;
  return { ...p, storyboard: { ...b, slots: { ...b.slots, [slotId]: rest } } };
}

/**
 * Bring the Series into the project: every linked asset takes the Series definition (states included) and its
 * versions. Returns the same project when nothing changes, so it can run on every Series change.
 */
export function pullSeries(p: Project, series: Series): Project {
  const b = p.storyboard;
  const links = linkedSlots(p);
  if (!b || ![...links.values()].some((r) => series.assets[r])) return p;
  let board: Storyboard = b;
  // Definitions: re-validate the board's own JSON against the Series (seriesRef assets take the Series definition).
  const r = validateStoryboard(JSON.parse(storyDocJson(storyboardToDoc(b))), { series });
  if (r.ok) {
    const merged = mergeStoryboard(p, r.doc);
    if (!same(merged.slots, b.slots) || !same(merged.shots, b.shots)) board = merged;
  }
  // Versions.
  let assets = p.assets;
  const slots = { ...board.slots };
  let versions = board.versions;
  for (const [base, ref] of linkedSlots({ ...p, storyboard: board })) {
    const sa = series.assets[ref];
    if (!sa) continue;
    for (const { slot, key } of slotFamily(board, base)) {
      const m = sa.media[key];
      if (!m) continue;
      if (!same(assets[m.asset.id], m.asset)) assets = { ...assets, [m.asset.id]: clone(m.asset) };
      if (slot.assetId !== m.asset.id) slots[slot.id] = { ...slots[slot.id], assetId: m.asset.id };
      for (const [vid, info] of Object.entries(m.info)) if (!same(versions[vid], info)) versions = { ...versions, [vid]: clone(info) };
    }
  }
  if (board === b && assets === p.assets && versions === b.versions && same(slots, b.slots)) return p;
  return { ...p, assets, storyboard: { ...board, slots, versions } };
}

/**
 * Write edits made in the episode to its linked assets back to the Series (definition and versions). Returns the
 * same Series when nothing changed.
 */
export function captureLinked(series: Series, p: Project, now = new Date().toISOString()): Series {
  let assets = series.assets;
  for (const [slotId, ref] of linkedSlots(p)) {
    const sa = series.assets[ref];
    const cap = sa && captureAsset(p, slotId);
    if (!sa || !cap) continue;
    // Media the episode doesn't have (e.g. a state added in the Series since) stays.
    const media = { ...sa.media, ...cap.media };
    if (same(sa.def, cap.def) && same(sa.media, media)) continue;
    assets = { ...assets, [ref]: { ...sa, def: cap.def, description: same(sa.def, cap.def) ? sa.description : describeAsset(cap.def), media, updatedAt: now } };
  }
  return assets === series.assets ? series : touch(series, now, assets);
}

/** Rename, describe or remove Series assets from the library. */
export function updateSeriesAsset(series: Series, id: string, patch: { description?: string; def?: Obj }, now = new Date().toISOString()): Series {
  const a = series.assets[id];
  if (!a) return series;
  return touch(series, now, { ...series.assets, [id]: { ...a, ...(patch.def ? { def: clone(patch.def) } : {}), ...(patch.description !== undefined ? { description: patch.description.trim() } : {}), updatedAt: now } });
}
export function removeSeriesAsset(series: Series, id: string, now = new Date().toISOString()): Series {
  if (!series.assets[id]) return series;
  const { [id]: _gone, ...rest } = series.assets;
  return touch(series, now, rest);
}

/** Series asset ids a definition is made from (its references and its states' references). */
export function seriesDeps(def: Obj): string[] {
  const ids: string[] = [];
  const take = (refs: unknown) => { if (Array.isArray(refs)) for (const r of refs) { const v = typeof r === "string" ? r : r && typeof r === "object" ? (r as Obj).asset : undefined; if (typeof v === "string") ids.push(v.split("@")[0]); } };
  take(def.references);
  if (Array.isArray(def.states)) for (const s of def.states as Obj[]) take(s?.references);
  return ids;
}

/** The part of the Series an episode uses (its linked assets and the Series assets they are made from). */
export function seriesForProject(series: Series, p: Project): Series {
  const keep = new Set<string>();
  const add = (id: string) => { if (keep.has(id) || !series.assets[id]) return; keep.add(id); seriesDeps(series.assets[id].def).forEach(add); };
  for (const ref of linkedSlots(p).values()) add(ref);
  return { ...series, assets: Object.fromEntries([...keep].map((id) => [id, series.assets[id]])) };
}

/** Every blob the Series refers to (kept by the blob collector, packed by the Series export). */
export function seriesMediaKeys(series: Series): string[] {
  const keys = new Set<string>();
  for (const a of Object.values(series.assets)) for (const m of Object.values(a.media)) for (const v of m.asset.versions) {
    keys.add(v.media.blobKey); if (v.media.thumbKey) keys.add(v.media.thumbKey); if (v.media.specKey) keys.add(v.media.specKey);
  }
  return [...keys];
}

/**
 * Reconnect an imported Series to the one already here (same id): assets missing here are added; for an asset in
 * both, the newer definition wins and versions are combined by id.
 */
export function mergeSeries(here: Series, incoming: Series, now = new Date().toISOString()): Series {
  const assets = { ...here.assets };
  for (const [id, a] of Object.entries(incoming.assets)) {
    const h = assets[id];
    if (!h) { assets[id] = clone(a); continue; }
    const newer = a.updatedAt > h.updatedAt ? a : h;
    assets[id] = { ...newer, def: clone(newer.def), media: mergeMedia(newer.media, newer === a ? h.media : a.media) };
  }
  return { ...here, assets, updatedAt: now };
}

/** A board asset that may be promoted (not a state, last frame, keyframe or app-made background). */
export const canPromote = (s: AssetSlot) => !s.stateOf && !s.implicit && !s.keyframeOf && s.source.type !== "lastFrame";

/** Storyboard asset JSON that uses a Series asset (what "Use in this episode" adds). */
export const seriesRefAsset = (id: string, as = id): Pick<StoryAsset, "id" | "seriesRef"> => ({ id: as, seriesRef: id });
