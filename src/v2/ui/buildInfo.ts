/** Values injected at build time (vite.config `define`); "dev" / "" when a define is missing. */
export interface BuildInfo {
  /** Full SHA, or "dev". */
  sha: string;
  /** First 7 characters of the SHA, or "dev". */
  shortSha: string;
  /** ISO-8601 timestamp of the build, or "". */
  time: string;
  /** GitHub Actions run number, or "". */
  run: string;
}

export function shortSha(sha: string): string {
  const s = sha.trim() || "dev";
  return s === "dev" ? "dev" : s.slice(0, 7);
}

export function resolveBuildInfo(raw: { sha?: string; time?: string; run?: string } = {}): BuildInfo {
  const sha = (raw.sha ?? "").trim() || "dev";
  return { sha, shortSha: shortSha(sha), time: (raw.time ?? "").trim(), run: (raw.run ?? "").trim() };
}

const injected = {
  sha: typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "",
  time: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "",
  run: typeof __BUILD_RUN__ === "string" ? __BUILD_RUN__ : "",
};

export const BUILD_INFO: BuildInfo = resolveBuildInfo(injected);

/** Show a build timestamp in the viewer's local time (or `timeZone` in tests). */
export function formatBuildTime(iso: string, opts?: { locale?: string; timeZone?: string }): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat(opts?.locale, { dateStyle: "medium", timeStyle: "short", timeZone: opts?.timeZone }).format(d);
}
