import { describe, expect, it } from "vitest";
import { timelineClipPatchChangesSourceIdentity } from "./timelineClipSourcePatch";

describe("timelineClipPatchChangesSourceIdentity", () => {
  it.each([
    [{ muted: true }, "mute"],
    [{ x: 20, y: 10, width: 80, height: 90 }, "preview transform"],
    [{ name: "Renamed clip" }, "display name"],
    [{ start: 4, duration: 3, sourceIn: 1, sourceOut: 4 }, "timing and source range"],
  ] as const)("does not re-derive canonical source for %s (%s)", patch => {
    expect(timelineClipPatchChangesSourceIdentity(patch)).toBe(false);
  });

  it.each([
    [{ kind: "clip" }, "kind"],
    [{ assetId: "asset-next" }, "asset"],
    [{ shotId: "shot-next" }, "shot"],
    [{ slotId: "slot-next" }, "slot"],
    [{ clipVersionId: "version-next" }, "clip version"],
    [{ scriptVersionId: "script-next" }, "script version"],
  ] as const)("rebuilds canonical source for explicit %s edits (%s)", patch => {
    expect(timelineClipPatchChangesSourceIdentity(patch)).toBe(true);
  });
});
