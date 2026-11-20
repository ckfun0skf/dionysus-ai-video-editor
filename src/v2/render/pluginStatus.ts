/**
 * P86: which plugin clips stopped in the preview (after the watchdog's restarts, P85) and why, so the inspector and
 * the phone Plugin sheet can say "Stopped" and offer Retry. Set by the preview Player (not by export); Retry bumps the
 * clip's generation, and any Player then starts a new worker for it on its next draw.
 */
export interface PluginStop { clipType: string; reason?: string }

const stops = new Map<string, PluginStop>();
const gens = new Map<string, number>();
const subs = new Set<() => void>();
let rev = 0;
const emit = () => { rev += 1; subs.forEach((f) => f()); };

export const pluginStatus = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  revision: () => rev,
  /** Why placement `id` stopped in the preview, if it did. */
  stopped: (id: string): PluginStop | undefined => stops.get(id),
  /** The clip's retry generation (a host made for an older one is replaced). */
  generation: (id: string): number => gens.get(id) ?? 0,
};

export function markPluginStopped(id: string, stop: PluginStop) {
  const old = stops.get(id);
  if (old && old.clipType === stop.clipType && old.reason === stop.reason) return;
  stops.set(id, stop); emit();
}
export function clearPluginStopped(id: string) { if (stops.delete(id)) emit(); }

/** Start placement `id` again: forget that it stopped and make Players replace its worker on their next draw. */
export function retryPluginClip(id: string) {
  gens.set(id, (gens.get(id) ?? 0) + 1);
  stops.delete(id);
  emit();
}
