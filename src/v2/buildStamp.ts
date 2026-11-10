/**
 * P56: resolve the values vite.config injects as __BUILD_SHA__ / __BUILD_TIME__ / __BUILD_RUN__.
 * Reads GITHUB_SHA and GITHUB_RUN_NUMBER (set automatically by GitHub Actions — no workflow edit),
 * then `git rev-parse HEAD`, then "dev". No GitHub Pages URLs.
 */
export function readBuildStamp(
  env: { GITHUB_SHA?: string; GITHUB_RUN_NUMBER?: string } = {},
  gitHead?: () => string,
  now: () => Date = () => new Date(),
): { sha: string; time: string; run: string } {
  let sha = env.GITHUB_SHA?.trim() || "";
  if (!sha && gitHead) {
    try { sha = gitHead().trim(); } catch { /* no git, or not a checkout */ }
  }
  return { sha: sha || "dev", time: now().toISOString(), run: env.GITHUB_RUN_NUMBER?.trim() || "" };
}
