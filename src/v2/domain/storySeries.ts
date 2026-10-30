/**
 * P5 (item 14): Series references in storyboard JSON.
 *
 * An asset may say `"seriesRef": "<series asset id>"` instead of defining itself: the definition (type, name, prompt,
 * references, states, …) then comes from the project's Series. `"series": true` asks the app to promote the asset into
 * the Series when it is applied. This module only resolves references inside the raw JSON before it is validated;
 * it imports nothing from storyJson so the validator can use it.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** What validation needs to know about a Series: its name and each asset's authored definition. */
export interface SeriesLike {
  name: string;
  assets: Record<string, { def: Obj; description?: string }>;
}
export interface SeriesIssue { path: string; message: string }

/** Keys that belong to the reference itself, not to the asset definition. */
const REF_KEYS = new Set(["id", "seriesRef", "series"]);
/** Definition fields compared when a board's copy differs from the Series (for the warning). */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const refIds = (def: Obj): string[] => {
  const ids: string[] = [];
  const take = (refs: unknown) => { if (Array.isArray(refs)) for (const r of refs) { const id = typeof r === "string" ? r : isObj(r) && typeof r.asset === "string" ? r.asset : ""; if (id) ids.push(id.split("@")[0]); } };
  take(def.references);
  if (Array.isArray(def.states)) for (const s of def.states) if (isObj(s)) take(s.references);
  return ids;
};
/** A definition complete enough to stand on its own (when there is no Series to resolve against). */
const complete = (a: Obj) => typeof a.type === "string" && (typeof a.prompt === "string" && a.prompt.trim() !== "" || a.source === "upload" || (isObj(a.source) && a.source.type === "upload"));

/**
 * Resolve `seriesRef` assets in `raw` (mutated; pass a copy). With a Series, each reference takes the Series definition
 * (the Series wins; fields that differ are reported as a warning), and Series assets it is made from that the board
 * lacks are added as references too. A reference to an id the Series doesn't have is an error. Without a Series, a
 * full definition is kept as the board's own copy (warning); a bare reference is an error.
 */
export function resolveSeriesRefs(raw: Obj, series: SeriesLike | undefined): { errors: SeriesIssue[]; warnings: SeriesIssue[]; added: string[] } {
  const errors: SeriesIssue[] = [], warnings: SeriesIssue[] = [], added: string[] = [];
  if (!Array.isArray(raw.assets)) return { errors, warnings, added };
  const assets = raw.assets as unknown[];
  const ids = new Set(assets.flatMap((a) => (isObj(a) && typeof a.id === "string" ? [a.id.trim()] : [])));
  const available = series ? Object.keys(series.assets) : [];
  const listed = () => (available.length ? available.slice(0, 12).join(", ") + (available.length > 12 ? ", …" : "") : "none yet");
  /** A stand-in for an unresolved reference, so the rest of the board is still checked without follow-on errors. */
  const stub = (i: number, a: Obj, ref: string) => { assets[i] = { id: typeof a.id === "string" && a.id.trim() ? a.id.trim() : ref || `asset${i + 1}`, name: typeof a.name === "string" ? a.name : ref, type: typeof a.type === "string" ? a.type : "image", source: "upload" }; };
  const resolveAt = (i: number) => {
    const a = assets[i];
    if (!isObj(a) || a.seriesRef === undefined) return;
    const path = `assets[${i}]`;
    const ref = typeof a.seriesRef === "string" ? a.seriesRef.trim() : "";
    if (!ref) { errors.push({ path: `${path}.seriesRef`, message: '"seriesRef" must be the id of an asset in the project\'s Series.' }); stub(i, a, ref); return; }
    if (a.series !== undefined) { warnings.push({ path: `${path}.series`, message: `"series" is ignored: the asset already uses the Series asset "${ref}".` }); delete a.series; }
    if (!series) {
      if (complete(a)) { warnings.push({ path: `${path}.seriesRef`, message: `This project isn't in a Series, so "${ref}" can't be linked; the asset keeps the definition written here. Pick a Series in the project settings to link it.` }); return; }
      errors.push({ path: `${path}.seriesRef`, message: `Asset uses the Series asset "${ref}", but this project isn't in a Series. Pick a Series in the project settings, or write the asset out in full ("type", "name", "prompt").` });
      stub(i, a, ref); return;
    }
    const entry = series.assets[ref];
    if (!entry) { errors.push({ path: `${path}.seriesRef`, message: `The Series "${series.name}" has no asset "${ref}". Series assets: ${listed()}. Use one of those ids, or define the asset in full (add "series": true to add it to the Series).` }); stub(i, a, ref); return; }
    const def = clone(entry.def);
    const differs = Object.keys(a).filter((k) => !REF_KEYS.has(k) && !same(a[k], def[k]));
    if (differs.length) warnings.push({ path, message: `${differs.map((k) => `"${k}"`).join(", ")} ${differs.length === 1 ? "differs" : "differ"} from the Series asset "${ref}" and ${differs.length === 1 ? "is" : "are"} ignored: the Series definition is used. Edit it in the Series library (every episode changes), or detach the asset to give this episode its own copy.` });
    const id = typeof a.id === "string" && a.id.trim() ? a.id.trim() : ref;
    assets[i] = { ...def, id, seriesRef: ref };
    // Series assets it is made from come along, linked too.
    for (const dep of refIds(def)) {
      if (ids.has(dep) || !series.assets[dep]) continue;
      ids.add(dep); added.push(dep);
      assets.push({ id: dep, seriesRef: dep });
      warnings.push({ path, message: `Added the Series asset "${dep}" too: "${ref}" is made from it.` });
      resolveAt(assets.length - 1);
    }
  };
  const n = assets.length;
  for (let i = 0; i < n; i++) resolveAt(i);
  return { errors, warnings, added };
}

/** True when any asset in the raw JSON uses a Series reference or asks to join the Series. */
export function usesSeries(raw: unknown): boolean {
  return isObj(raw) && Array.isArray(raw.assets) && raw.assets.some((a) => isObj(a) && (a.seriesRef !== undefined || a.series !== undefined));
}
