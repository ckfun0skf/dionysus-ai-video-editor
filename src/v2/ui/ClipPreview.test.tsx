// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { FilmstripTiles } from "./ClipPreview";
import type { Placement } from "../domain";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

describe("FilmstripTiles", () => {
  it("tiles the clip width and maps tiles to source time (speed, sourceIn)", () => {
    const p = { id: "c", startTicks: 0, durationTicks: 4 * 120000, sourceInTicks: 2 * 120000, speed: 1, clipType: "video" } as Placement;
    const strip = { times: [0, 1, 2, 3, 4, 5, 6, 7], frames: ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"], aspect: 1 };
    const el = document.createElement("div");
    act(() => { createRoot(el).render(<FilmstripTiles strip={strip} p={p} width={192} pps={48} />); });
    const srcs = Array.from(el.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["f2", "f3", "f4", "f5"]); // 48px tiles at 48px/s → 1 tile per second from sourceIn 2s
  });
});
