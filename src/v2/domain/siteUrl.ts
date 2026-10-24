/**
 * Where the app and its AI planner files are deployed (V2-OPS-LINKS). Nothing else in src/ may hard-code a host.
 * - Runtime (in the app): links are built from the page's own origin + Vite `base`, so any host or subpath works.
 * - Build time: `DIONYSUS_SITE_URL` (see docs/v2/DEPLOYMENT.md) sets Vite's `base` and the absolute URLs written into
 *   the published AI files (public/ai/*, public/llms.txt). This module has no imports so vite.config.ts can use it.
 */

/** Fallback deployment (GitHub Pages) used only when `DIONYSUS_SITE_URL` is not set. */
export const DEFAULT_SITE_URL = "https://ckfun0skf.github.io/dionysus-ai-video-editor/";

/** Absolute http(s) URL ending in "/". Throws on anything else so a bad env var fails the build early. */
export function normalizeSiteUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`Site URL must be http(s): ${raw}`);
  u.search = ""; u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.href;
}

/** Site URL for a build: the env var (or the default), with its path replaced by an explicit absolute Vite base (e.g. `--base=/x/pr-35/`). */
export function buildSiteUrl(envValue: string | undefined, base?: string): string {
  const site = normalizeSiteUrl(envValue?.trim() || DEFAULT_SITE_URL);
  return base && base.startsWith("/") ? normalizeSiteUrl(new URL(base, site).href) : site;
}

export interface AiLinks {
  site: string;
  /** The v2 app. */
  app: string;
  guide: string;
  guideHtml: string;
  presets: string;
  /** The full format reference, published next to the guide. */
  formatDoc: string;
  llms: string;
}

/** Every public AI link, resolved against a site URL (absolute, ends in "/"). */
export function aiLinks(site: string): AiLinks {
  const s = normalizeSiteUrl(site);
  const at = (p: string) => new URL(p, s).href;
  return { site: s, app: at("?v2"), guide: at("ai/storyboard-guide.md"), guideHtml: at("ai/storyboard-guide.html"), presets: at("ai/presets.json"), formatDoc: at("ai/STORYBOARD_FORMAT.md"), llms: at("llms.txt") };
}

/** Hosts an outside AI can't reach (dev server, LAN). Prompts copied there link to the configured public site instead. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "" || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || h === "0.0.0.0"
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
    || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

declare const __DIONYSUS_SITE_URL__: string | undefined;
/** Site URL baked in by vite.config.ts (`DIONYSUS_SITE_URL` or the default). */
export const CONFIGURED_SITE_URL: string = typeof __DIONYSUS_SITE_URL__ === "string" ? __DIONYSUS_SITE_URL__ : DEFAULT_SITE_URL;

/**
 * Site URL of the running app: `new URL(import.meta.env.BASE_URL, location.href)`, so the links follow the actual
 * deployment (any host, any subpath, relative bases too). On a private host (localhost, LAN) or outside a browser it
 * returns `fallback`, because an outside AI can't open links there.
 */
export function runtimeSiteUrl(
  loc: { href: string; hostname: string } | undefined = (globalThis as { location?: { href: string; hostname: string } }).location,
  base: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/",
  fallback: string = CONFIGURED_SITE_URL,
): string {
  if (!loc?.href || !/^https?:$/.test(new URL(loc.href).protocol) || isPrivateHost(loc.hostname)) return normalizeSiteUrl(fallback);
  return normalizeSiteUrl(new URL(base || "/", loc.href).href);
}

/** AI links for the running app (see runtimeSiteUrl). */
export const runtimeAiLinks = (): AiLinks => aiLinks(runtimeSiteUrl());
