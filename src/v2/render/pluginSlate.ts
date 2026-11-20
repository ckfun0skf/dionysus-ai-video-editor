import type { ClipRenderer } from "./clipRenderers";
import { drawBlackFrame, drawSlate } from "./placeholderSlate";
import { pluginMetaOf } from "../clipTypes";

/**
 * P84 (Phase 3 step 3.2): a clip of a registered third-party plugin type draws the shared slate "Plugin “Name”",
 * NOT ENABLED, in preview and a black frame in export (the export dialog warns first), until the plugin runs in its
 * sandboxed worker with the user's trust (P85/P86). Its params are kept.
 */
export const PLUGIN_SLATE_RENDERER: ClipRenderer = {
  id: "plugin",
  draw(h) {
    if (h.track.kind === "audio") return;
    if (h.offline) { drawBlackFrame(h); return; }
    const name = pluginMetaOf(h.placement.clipType)?.name ?? h.placement.clipType;
    drawSlate(h.g, h.width, h.height, `Plugin “${name}”`, "NOT ENABLED");
  },
};
