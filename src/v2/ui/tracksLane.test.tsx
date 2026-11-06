// @vitest-environment jsdom
/** P40 Tracks lane: one span per tracker, yellow where weak / lost, tap opens, drag ends / body change the range. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, secondsToTicks as s, type NamedTrack, type Placement, type Track } from "../domain";
import { buildRows } from "./Timeline";
import { qualityGradient, TracksLane } from "./TracksLane";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const tr = (id: string, name: string, inS: number, outS: number): NamedTrack => ({ id, name, inS, outS, srcW: 16, srcH: 9, samples: [0, 1, 2, 3].map((i) => ({ s: s(i), x: 0.5, y: 0.5, w: 0.1, h: 0.1, scale: 1, conf: i === 2 ? 0.2 : 1, ...(i === 2 ? { lost: true } : {}) })) });
const clip: Placement = { id: "c1", startTicks: s(2), durationTicks: s(4), sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "b" }, clipType: "video", motionTracks: [tr("mt1", "Track 1", 0, s(4)), tr("mt2", "Ball", s(1), s(3))] };
const track: Track = { id: "trk", kind: "video", name: "Video 1", placements: [clip] } as Track;

describe("TracksLane", () => {
  it("renders a span per tracker over its range, tints weak frames, opens on tap and re-ranges on drag", () => {
    const onOpen = vi.fn(), onRange = vi.fn();
    const el = document.createElement("div"); document.body.appendChild(el);
    act(() => { createRoot(el).render(<TracksLane track={track} toPx={(t) => (t / s(1)) * 100} pps={100} onOpen={onOpen} onRange={onRange} />); });
    const spans = [...el.querySelectorAll(".v2-mtrack")] as HTMLElement[];
    expect(spans.map((x) => [x.textContent, x.style.left, x.style.width])).toEqual([["Track 1", "200px", "400px"], ["Ball", "300px", "200px"]]);
    expect(spans[1].style.top).not.toBe(spans[0].style.top);
    expect(el.querySelector(".v2-mtrack-lane")!.getAttribute("aria-label")).toMatch(/not exported/);
    const ev = (n: Element, type: string, x: number) => act(() => { n.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x })); });
    ev(spans[1], "pointerdown", 350); ev(spans[1], "pointerup", 350);
    expect(onOpen).toHaveBeenCalledWith("c1", "mt2");
    const h = spans[1].querySelector(".v2-mtrack-h.is-out")!;
    ev(h, "pointerdown", 500); ev(h, "pointermove", 550); ev(h, "pointerup", 550);
    expect(onRange).toHaveBeenCalledWith({ clipId: "c1", trackId: "mt2", start: s(3), end: s(5.5) });
  });
  it("tints lost / weak stretches yellow", () => {
    expect(qualityGradient(clip, clip.motionTracks![0], s(2), s(6), 4)).toMatch(/--mt-ok.*--mt-bad/);
  });
  it("adds a Tracks row under a video track whose clips have trackers (desktop and phone)", () => {
    const p = createProject("x"), c = p.compositions[p.rootCompositionId];
    const main = c.tracks.find((t) => t.kind === "video")!;
    const comp = { ...c, tracks: c.tracks.map((t) => (t.id === main.id ? { ...t, placements: [clip] } : t)) };
    for (const mobile of [false, true]) {
      const rows = buildRows(comp, mobile).map((r) => r.type);
      expect(rows[rows.indexOf("track") + 1]).toBe("mtracks");
    }
  });
});
