/**
 * P38: code packages as effects and transitions. An effect clip whose preset is "code:<assetId>" runs that html asset
 * every frame with ctx.source (the picture under it); a cut whose transition kind is "code:<assetId>" runs it with
 * ctx.from, ctx.to and ctx.progress. The asset's role is stored on its version (MediaRef.role) when it is imported.
 */
import type { Asset, Project } from "./model";
import { roleMismatch, type CodePackageRole } from "./htmlClipPackage";

export const CODE_PRESET_PREFIX = "code:";
export const codePresetId = (assetId: string) => `${CODE_PRESET_PREFIX}${assetId}`;
/** The asset id of a "code:<assetId>" effect preset or transition kind, else undefined. */
export const codeAssetOf = (preset: string | undefined) => (preset?.startsWith(CODE_PRESET_PREFIX) ? preset.slice(CODE_PRESET_PREFIX.length) : undefined);

const selected = (a: Asset) => a.versions.find((v) => v.id === a.selectedVersionId) ?? a.versions[0];
/** The role of an asset: html assets carry it on their selected version; everything else is a clip. */
export const codeRoleOf = (a: Asset | undefined): CodePackageRole => (a?.kind === "html" ? selected(a)?.media.role ?? "clip" : "clip");
/** Html assets of one role (for the Custom (code) groups). */
export const codeAssetsOfRole = (p: Project, role: Exclude<CodePackageRole, "clip">): Asset[] => Object.values(p.assets).filter((a) => a.kind === "html" && codeRoleOf(a) === role);

/** Why `assetId` can't be used as `want` (missing, not code, or the wrong role), else undefined. */
export function codeRoleIssue(p: Project, assetId: string, want: CodePackageRole): string | undefined {
  const a = p.assets[assetId];
  if (!a) return `Unknown asset "${assetId}".`;
  if (want !== "clip" && a.kind !== "html") return `"${a.name}" is not a code package.`;
  return roleMismatch(codeRoleOf(a), want);
}
