/**
 * P62 (#312): let a WebMCP agent attach media to storyboard assets and shots without driving the UI. Pure planning:
 * which URLs the page may fetch, which storyboard item a call targets and what kind of file it needs, and how a batch
 * (items or a path pattern) expands. The UI side (ui/agent/mediaTools) fetches, validates, stores and dispatches.
 */
import type { MediaKind, Project } from "./model";
import { kindForSlot, type Target } from "./storyboard";

/** Hosts a plain http: URL may use (a local file server on the agent's machine). Everything else must be https:. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Resolve `url` (against `base`, when given) and check it may be fetched: https:, http: on localhost / 127.0.0.1 /
 * [::1], or the page's own origin. data: URLs are allowed only when `allowData`. The browser still applies CORS and
 * Private Network Access, so the server must allow this site.
 */
export function checkAgentUrl(url: string, opts: { base?: string; origin?: string; allowData?: boolean } = {}): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try { u = opts.base ? new URL(url, opts.base) : new URL(url); } catch { return { ok: false, error: `Not a valid URL: ${JSON.stringify(url)}${opts.base ? ` (base ${JSON.stringify(opts.base)})` : ""}.` }; }
  if (u.protocol === "data:") return opts.allowData ? { ok: true, url: u.href } : { ok: false, error: 'Pass a data: URL as "dataUrl", not "url".' };
  if (u.protocol === "https:") return { ok: true, url: u.href };
  if (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname)) return { ok: true, url: u.href };
  if (opts.origin && u.origin === opts.origin) return { ok: true, url: u.href };
  return { ok: false, error: `URL not allowed: ${u.href}. Use https:, or http://localhost / http://127.0.0.1 for a local file server.` };
}

export interface AttachTarget {
  target: Target;
  /** The kind of file the target takes. */
  kind: MediaKind;
  /** The storyboard asset (slot) id whose versions change (a shot's clip slot for html/still and shared-clip shots). */
  slotId?: string;
  shotId?: string;
  /** For html: the slot whose bindings and params the clip must provide. */
  htmlSlot?: string;
  label: string;
}

/** Which storyboard item `assetId` / `shotId` names and what it takes. A shot's versions live on its clip slot when it has one. */
export function attachTarget(p: Project, ref: { assetId?: string; shotId?: string }): { ok: true; value: AttachTarget } | { ok: false; error: string } {
  const b = p.storyboard;
  if (!b) return { ok: false, error: "No storyboard yet. Create or import one first." };
  if (ref.assetId && ref.shotId) return { ok: false, error: 'Give "assetId" or "shotId", not both.' };
  if (ref.assetId) {
    const slot = b.slots[ref.assetId];
    if (!slot) return { ok: false, error: `No storyboard asset "${ref.assetId}". Call get_storyboard for asset ids.` };
    if (slot.source.type === "lastFrame" || slot.source.type === "frameOf") return { ok: false, error: `Asset "${ref.assetId}" is a frame taken from a shot; use capture_shot_frame instead.` };
    const kind = kindForSlot(slot.type);
    return { ok: true, value: { target: { slot: slot.id }, kind, slotId: slot.id, ...(kind === "html" ? { htmlSlot: slot.id } : {}), label: slot.name || slot.id } };
  }
  if (ref.shotId) {
    const shot = b.shots[ref.shotId];
    if (!shot) return { ok: false, error: `No shot "${ref.shotId}". Call get_storyboard for shot ids.` };
    const clip = shot.clipSlot ? b.slots[shot.clipSlot] : undefined;
    const kind = clip ? kindForSlot(clip.type) : "video";
    return { ok: true, value: { target: { shot: shot.id }, kind, shotId: shot.id, ...(clip ? { slotId: clip.id } : {}), ...(clip && kind === "html" ? { htmlSlot: clip.id } : {}), label: `Shot ${b.order.indexOf(shot.id) + 1} · ${shot.title}` } };
  }
  return { ok: false, error: 'Give "assetId" (a storyboard asset) or "shotId".' };
}

/** One item of attach_asset_versions after defaults and pattern expansion. */
export interface AttachItem {
  assetId?: string; shotId?: string;
  url?: string; path?: string; text?: string; dataUrl?: string;
  name?: string; makeCurrent?: boolean; mode?: "new" | "replace";
}

const fill = (pattern: string, vars: Record<string, string>) => pattern.replace(/\{(assetId|shotId)\}/g, (_, k: string) => encodeURIComponent(vars[k] ?? ""));

/**
 * Expand a path pattern over the board: "{assetId}" runs over storyboard assets (only those of `type` when given),
 * "{shotId}" over shots in story order (only `shots` when given). Explicit `ids` limit either list.
 */
export function expandAttachPattern(p: Project, pattern: string, opts: { type?: string; ids?: string[] } = {}): { ok: true; items: AttachItem[] } | { ok: false; error: string } {
  const b = p.storyboard;
  if (!b) return { ok: false, error: "No storyboard yet." };
  const hasAsset = pattern.includes("{assetId}"), hasShot = pattern.includes("{shotId}");
  if (hasAsset === hasShot) return { ok: false, error: 'A pattern needs exactly one of "{assetId}" or "{shotId}".' };
  const only = opts.ids?.length ? new Set(opts.ids) : undefined;
  if (hasAsset) {
    const slots = Object.values(b.slots).filter((s) => s.source.type !== "lastFrame" && s.source.type !== "frameOf" && (!opts.type || s.type === opts.type) && (!only || only.has(s.id)));
    return { ok: true, items: slots.map((s) => ({ assetId: s.id, path: fill(pattern, { assetId: s.id }) })) };
  }
  const shots = b.order.filter((id) => b.shots[id] && (!only || only.has(id)));
  return { ok: true, items: shots.map((id) => ({ shotId: id, path: fill(pattern, { shotId: id }) })) };
}

/** A file name for fetched bytes: the URL's last path segment, else `<label>.<ext>`. */
export function fileNameFor(url: string | undefined, kind: MediaKind, label: string): string {
  const ext = kind === "html" ? "html" : kind === "audio" ? "mp3" : kind === "video" ? "mp4" : "png";
  if (url && !url.startsWith("data:")) {
    try { const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""); if (/\.[a-z0-9]{2,5}$/i.test(last)) return last; } catch { /* fall through */ }
  }
  return `${label.replace(/[^\w.-]+/g, "_").slice(0, 60) || "media"}.${ext}`;
}

/** Max items in one attach_asset_versions call (keeps one call to a few minutes). */
export const MAX_ATTACH_ITEMS = 200;
