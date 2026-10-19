import { describe, expect, it } from "vitest";
import type { ClipVersion, CompositionLayer, TimelineTrack } from "./types";
import { applyClipVersionResizePreview, calculateClipVersionDropPosition, calculateClipVersionResizePreview } from "./nestedTimelinePlacement";

const tracks: TimelineTrack[] = [
  { id: "v1", name: "Video 1", kind: "video" },
  { id: "v2", name: "Video 2", kind: "video" },
  { id: "a1", name: "Audio 1", kind: "audio" },
];

function version(layers: CompositionLayer[]): ClipVersion {
  return { id: "version", name: "Version", description: "", duration: 12, layers, tracks, scriptVersionIds: [], generationRecords: [] };
}
const layer = (id: string, trackId: string, start: number, duration: number, kind: CompositionLayer["kind"] = "video"): CompositionLayer =>
  ({ id, name: id, trackId, start, duration, kind });

describe("nested Clip Timeline placement", () => {
  it("snaps drag previews to edges across tracks without allowing destination overlap", () => {
    const doc = version([layer("moving", "v1", 0, 2), layer("anchor", "v2", 4, 3)]);
    expect(calculateClipVersionDropPosition(doc, "moving", "v2", 2.05, 12, 24)).toEqual({ start: 2, snapTime: 4 });
    expect(calculateClipVersionDropPosition(doc, "moving", "v2", 4.1, 12, 24)).toEqual({ start: 2, snapTime: 4 });
  });

  it("rejects incompatible nested track types", () => {
    const doc = version([layer("audio", "a1", 0, 2, "audio")]);
    expect(calculateClipVersionDropPosition(doc, "audio", "v1", 2, 12, 24)).toBeNull();
  });

  it("resizes and atomically trims an adjacent layer while preserving layer metadata", () => {
    const source = { ...layer("left", "v1", 0, 5), assetId: "asset-left", sourceIn: 0, sourceOut: 5 };
    const neighbor = { ...layer("right", "v1", 5, 4), assetId: "asset-right", sourceIn: 10, sourceOut: 14 };
    const doc = version([source, neighbor]);
    const preview = calculateClipVersionResizePreview(doc, "left", "right", 3, 12, 24)!;
    expect(preview.trims).toEqual([{ id: "right", start: 8, duration: 1, edge: "left" }]);
    const updated = applyClipVersionResizePreview(doc, preview, 24);
    expect(updated.layers.find(item => item.id === "left")).toMatchObject({ start: 0, duration: 8, assetId: "asset-left", sourceOut: 8 });
    expect(updated.layers.find(item => item.id === "right")).toMatchObject({ start: 8, duration: 1, assetId: "asset-right", sourceIn: 13, sourceOut: 14 });
    expect(doc.layers).toEqual([source, neighbor]);
  });
});
