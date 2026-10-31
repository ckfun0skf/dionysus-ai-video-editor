/**
 * P9-LINK "Link to main". A linked clip (`Placement.link.parent`) stays attached to a main-track clip. The engine runs
 * `applyLinks(before, after)` after every command, so every edit (move, ripple, reorder, trim, split, delete, version
 * swap, storyboard send) keeps links consistent inside the same undo step:
 *  - parent moved / rippled / reordered → the clip keeps its offset from the parent's content (a left trim that keeps
 *    the picture in place keeps the clip in place too);
 *  - parent shorter → the clip is cut to the parent's range, and removed when nothing of it is left;
 *  - parent split → the clip re-links to the half holding its start (and is not cut at the split point);
 *  - parent deleted → its linked clips are deleted;
 *  - linked clip moved / pasted / duplicated by itself → re-linked to the main clip under its new start (unlinked when
 *    there is none);
 *  - `autoLink` (a command flag + project setting, default on) → new unlinked clips link to the main clip under their start.
 */
import type { Composition, Placement, Project, Track } from "./model";
import { isStill } from "./model";
import { groupOf, isFree, mainTrack } from "./ops";
import { placeOnFreeTrack } from "./storyLinks";

const end = (p: Placement) => p.startTicks + p.durationTicks;
/** Shortest linked clip kept after a cut (0.1 s). */
export const MIN_LINK_TICKS = 12_000;

/** The main-track clip under `t` (a clip starting exactly at `t` wins over one ending there). */
export function mainClipAt(comp: Composition, t: number): Placement | undefined {
  return mainTrack(comp)?.placements.find((p) => p.startTicks <= t && t < end(p));
}

export const autoLinkOn = (p: Pick<Project, "settings">) => p.settings.autoLink !== false;

/** Ticks the parent's content moved by between `a` (before) and `b` (after). */
function contentShift(a: Placement, b: Placement): number {
  const ds = b.startTicks - a.startTicks;
  if (!isStill(a) && !a.freeze && !a.reverse) return ds - Math.round((b.sourceInTicks - a.sourceInTicks) / (a.speed ?? 1));
  // Stills have no source time: a left trim (end kept, length changed) leaves the picture where it was.
  return end(a) === end(b) && a.durationTicks !== b.durationTicks ? 0 : ds;
}

const same = (a: Placement, b: Placement) => a.startTicks === b.startTicks && a.durationTicks === b.durationTicks && a.sourceInTicks === b.sourceInTicks;

/** Link (or unlink) clip `id` to the main clip under its start. Throws when there is nothing to link to. */
export function setLink(comp: Composition, id: string, on: boolean): Composition {
  if (on && !mainClipAt(comp, comp.tracks.flatMap((t) => t.placements).find((p) => p.id === id)?.startTicks ?? -1)) throw new Error("No main clip under this clip's start");
  const main = mainTrack(comp);
  return { ...comp, tracks: comp.tracks.map((t) => (t.id === main?.id ? t : { ...t, placements: t.placements.map((pl) => {
    if (pl.id !== id) return pl;
    if (!on) { const { link: _l, ...rest } = pl; void _l; return rest; }
    const parent = mainClipAt(comp, pl.startTicks);
    return parent ? { ...pl, link: { parent: parent.id } } : pl;
  }) })) };
}

export function applyLinks(before: Composition, after: Composition, opts: { autoLink?: boolean } = {}): Composition {
  const main = mainTrack(after);
  const was = new Map(before.tracks.flatMap((t) => t.placements.map((p) => [p.id, { p, track: t.id }] as const)));
  const wasMain = new Map(mainTrack(before)?.placements.map((p) => [p.id, p]));
  const nowMain = new Map(main?.placements.map((p) => [p.id, p]));
  const now = new Set(after.tracks.flatMap((t) => t.placements.map((p) => p.id)));
  const newMain = [...nowMain.values()].filter((p) => !wasMain.has(p.id));
  let touched = false;
  const moved: Placement[] = [];
  const tracks: Track[] = after.tracks.map((t) => {
    if (t.id === main?.id) {
      if (!t.placements.some((p) => p.link)) return t;
      touched = true; // a clip moved onto the main track is a parent, never a child
      return { ...t, placements: t.placements.map((p) => { if (!p.link) return p; const { link: _l, ...r } = p; void _l; return r; }) };
    }
    let changed = false;
    const placements = t.placements.flatMap((pl): Placement[] => {
      const old = was.get(pl.id);
      const relink = (): Placement[] => {
        const parent = mainClipAt(after, pl.startTicks);
        if (parent) return pl.link?.parent === parent.id ? [pl] : (changed = true, [{ ...pl, link: { parent: parent.id } }]);
        if (!pl.link) return [pl];
        changed = true; const { link: _l, ...r } = pl; void _l; return [r];
      };
      if (!pl.link) return !old && opts.autoLink ? relink() : [pl];
      // New (pasted, duplicated) or self-moved clip: follows the main clip under its new start.
      if (!old) return relink();
      const selfMoved = old.p.startTicks !== pl.startTicks || old.track !== t.id;
      const a0 = wasMain.get(pl.link.parent), a1 = nowMain.get(pl.link.parent);
      if (!a0) return relink();
      if (!a1 && now.has(pl.link.parent)) return relink(); // parent left the main track: no longer a parent
      if (!a1) { changed = true; return []; } // parent deleted → deleted with it (same undo step)
      if (same(a0, a1)) return selfMoved ? relink() : [pl];
      if (selfMoved || old.p !== pl) return [pl]; // the command already placed it (multi-select move, version swap)
      // Split: the parent kept the left half and a new main clip holds the rest.
      const right = newMain.find((n) => n.startTicks === end(a1) && end(n) === end(a0) && a1.startTicks === a0.startTicks);
      if (right) {
        if (pl.startTicks >= right.startTicks) { changed = true; return [{ ...pl, link: { parent: right.id } }]; }
        return [pl];
      }
      const start = pl.startTicks + contentShift(a0, a1);
      const s = Math.max(start, a1.startTicks), e = Math.min(start + pl.durationTicks, end(a1));
      changed = true;
      if (e - s < Math.min(MIN_LINK_TICKS, pl.durationTicks)) return []; // nothing of it is left inside the parent
      const keys = s !== start && pl.keyframes ? shift(pl.keyframes, start - s) : pl.keyframes;
      const next: Placement = { ...pl, startTicks: s, durationTicks: e - s, ...(keys ? { keyframes: keys } : {}) };
      if (next.fadeInTicks && next.fadeInTicks > next.durationTicks) next.fadeInTicks = next.durationTicks;
      if (next.fadeOutTicks && next.fadeOutTicks > next.durationTicks) next.fadeOutTicks = next.durationTicks;
      if (next.startTicks !== pl.startTicks || next.durationTicks !== pl.durationTicks) moved.push(next);
      return [next];
    });
    if (!changed) return t;
    touched = true;
    return { ...t, placements: placements.sort((a, b) => a.startTicks - b.startTicks) };
  });
  if (!touched) return after;
  let comp: Composition = { ...after, tracks };
  // A followed clip that now overlaps another clip on its layer goes to a free layer of the same kind.
  for (const pl of moved) {
    const track = comp.tracks.find((t) => t.placements.some((p) => p.id === pl.id));
    if (!track || isFree(track, pl.startTicks, pl.durationTicks, pl.id)) continue;
    const g = groupOf(comp, track);
    comp = { ...comp, tracks: comp.tracks.map((t) => (t === track ? { ...t, placements: t.placements.filter((p) => p.id !== pl.id) } : t)) };
    comp = placeOnFreeTrack(comp, pl, (t) => t.kind === track.kind && groupOf(comp, t) === g && !!t.layerStyle?.subtitle === !!track.layerStyle?.subtitle && t.id !== main?.id);
  }
  return comp;
}

function shift(k: NonNullable<Placement["keyframes"]>, by: number): Placement["keyframes"] {
  return Object.fromEntries(Object.entries(k).map(([prop, keys]) => [prop, keys!.map((x) => ({ ...x, t: Math.max(0, x.t + by) }))]));
}

/** Clips linked to main clip `parentId`. */
export const linkedTo = (comp: Composition, parentId: string): Placement[] => comp.tracks.flatMap((t) => t.placements.filter((p) => p.link?.parent === parentId));

/** Run applyLinks over every composition of a project (the engine's post-command step). */
export function applyProjectLinks(before: Project, after: Project, autoLink: boolean): Project {
  if (before === after) return after;
  let compositions = after.compositions;
  for (const [id, c] of Object.entries(after.compositions)) {
    const b = before.compositions[id];
    if (!b || b === c) continue;
    const n = applyLinks(b, c, { autoLink: autoLink && autoLinkOn(after) });
    if (n !== c) compositions = { ...compositions, [id]: n };
  }
  return compositions === after.compositions ? after : { ...after, compositions };
}
