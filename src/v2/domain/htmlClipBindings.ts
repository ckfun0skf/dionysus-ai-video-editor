/**
 * Bindings of an HTML clip to other assets (V2-HTML-PKG). A manifest binding names its asset by a storyboard asset id
 * (the slot's backing project asset is used) or by a project asset id; the asset's selected version is bound. For a
 * storyboard html asset, its `references` are the expected bindings (named by asset id), and its size and length come
 * from its aspect and the shots that use it.
 */
import type { MediaKind, Project } from "./model";
import { kindForSlot, selectedOf, type AssetSlot, type Storyboard } from "./storyboard";
import type { BindingType, HtmlClipManifest, PackagePromptInput } from "./htmlClipPackage";

export interface ResolvedBinding { name: string; type: BindingType; assetId: string; versionId: string; blobKey: string; mime: string }

const bindingTypeOf = (k: MediaKind): BindingType | undefined => (k === "video" ? "video" : k === "audio" ? "audio" : k === "image" ? "image" : undefined);

/** Bound media for a clip, in manifest order; bindings with no matching asset or version are left out. */
export function resolveClipBindings(p: Project, m: HtmlClipManifest): ResolvedBinding[] {
  const out: ResolvedBinding[] = [];
  for (const [name, b] of Object.entries(m.bindings ?? {})) {
    if (!b || typeof b !== "object") continue;
    const ref = b.asset ?? name;
    const assetId = p.storyboard?.slots[ref]?.assetId ?? (p.assets[ref] ? ref : undefined);
    const asset = assetId ? p.assets[assetId] : undefined;
    if (!asset) continue;
    const vid = selectedOf(p, { assetId });
    const v = asset.versions.find((x) => x.id === vid);
    if (!v || !bindingTypeOf(asset.kind)) continue;
    out.push({ name, type: b.type, assetId: asset.id, versionId: v.id, blobKey: v.media.blobKey, mime: v.media.mime });
  }
  return out;
}

/** Cache key part: changes when a bound asset gets another selected version. */
export const bindingSignature = (bs: ResolvedBinding[]) => bs.map((b) => `${b.name}=${b.versionId}`).join(",");

const slotBindingType = (s: AssetSlot): BindingType | undefined => bindingTypeOf(kindForSlot(s.type));

/** Expected bindings of a storyboard html asset: its references (not other html assets), by asset id. */
export function slotBindings(b: Storyboard, slot: AssetSlot): { name: string; type: BindingType; label: string }[] {
  const out: { name: string; type: BindingType; label: string }[] = [];
  for (const id of slot.references) {
    const ref = b.slots[id];
    const type = ref && slotBindingType(ref);
    if (ref && type && !out.some((o) => o.name === id)) out.push({ name: id, type, label: ref.name });
  }
  return out;
}

/** Longest planned on-screen time of a storyboard html asset: the shots it is the clip of, and its html layers. */
export function slotDurationSec(b: Storyboard, slotId: string): number | undefined {
  let best = 0;
  for (const id of b.order) {
    const s = b.shots[id];
    if (!s || s.skipped) continue;
    if (s.render === "html" && s.clipSlot === slotId) best = Math.max(best, s.durationSec);
    for (const l of s.layers ?? []) if (l.type === "html" && l.asset === slotId) best = Math.max(best, Math.max(0, Math.min(l.endSec, s.durationSec) - l.startSec));
  }
  return best > 0 ? Math.round(best * 1000) / 1000 : undefined;
}

/** Everything the package prompt needs for a storyboard html asset. */
export function slotPackageInput(b: Storyboard, slot: AssetSlot): PackagePromptInput {
  const uses = b.order.map((id) => b.shots[id]).filter((s) => s && !s.skipped && (s.clipSlot === slot.id || s.layers?.some((l) => l.type === "html" && l.asset === slot.id)));
  const context = uses.length
    ? `WHERE IT PLAYS\n${uses.map((s) => `- Shot "${s.id}" (${s.title}, ${s.durationSec} s): ${s.clipSlot === slot.id ? "the whole shot" : "an overlay layer"}. ${s.description}`.trim()).join("\n")}`
    : undefined;
  // Only ever an overlay layer: draw on transparent so the shot below shows through.
  const overlay = uses.length > 0 && uses.every((s) => s.clipSlot !== slot.id);
  return { brief: slot.prompt, name: slot.name, id: slot.id, aspect: slot.aspect, durationSec: slotDurationSec(b, slot.id), bindings: slotBindings(b, slot), context, ...(overlay ? { background: "transparent" } : {}) };
}
