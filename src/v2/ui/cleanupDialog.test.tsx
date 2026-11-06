// @vitest-environment jsdom
/** P38 (item 9): unused media checked by default, old versions unchecked; ✓ removes in one undo step. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type Asset } from "../domain";
import { cmd, Engine } from "../engine";
import { CleanupDialog } from "./CleanupDialog";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const v = (id: string) => ({ id, createdAt: "2026-11-01T00:00:00Z", media: { blobKey: id, mime: "x", durationTicks: 120000 }, provenance: { source: "import" as const, inputs: [] } });
const blobs = { get: async () => ({ size: 2 * 1024 * 1024 }) } as never;

describe("CleanupDialog", () => {
  it("defaults, toggles and removes in one undo step", async () => {
    const e = new Engine(createProject("x"));
    const used: Asset = { id: "used", kind: "video", name: "used.mp4", selectedVersionId: "u2", versions: [v("u1"), v("u2")] };
    const spare: Asset = { id: "spare", kind: "image", name: "spare.png", versions: [v("s1")] };
    e.dispatch([cmd.importAsset(used), cmd.importAsset(spare)]);
    e.dispatch(cmd.addAssetToTimeline("used", 0));
    const onDone = vi.fn();
    const el = document.createElement("div"); document.body.appendChild(el);
    act(() => { createRoot(el).render(<CleanupDialog engine={e} project={e.getState().project} blobs={blobs} onClose={() => {}} onDone={onDone} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const boxes = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(el.textContent).toContain("spare.png");
    expect(el.textContent).toContain("used.mp4 · v1");
    act(() => boxes[1].click());
    expect(el.textContent).toContain("2 selected · frees about 4.0 MB");
    act(() => (el.querySelector('[aria-label="Remove 2 items"]') as HTMLButtonElement).click());
    expect(Object.keys(e.getState().project.assets)).toEqual(["used"]);
    expect(e.getState().project.assets.used.versions.map((x) => x.id)).toEqual(["u2"]);
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining("Removed 1 media and 1 old version"));
    e.undo();
    expect(Object.keys(e.getState().project.assets).sort()).toEqual(["spare", "used"]);
  });
});
