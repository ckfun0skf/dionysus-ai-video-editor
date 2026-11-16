// @vitest-environment jsdom
/**
 * P69 timeline parity (clip type plugins Phase 1 step 1.4): the timeline's markup for a project with every clip type
 * (placeholder, blank, image, video incl. reversed / muted / sped-up, html, audio, text, captions, effects, an unknown
 * clipType) with thumbnails, filmstrips, waveforms and load bars, on desktop and phone (collapsed and each group
 * expanded), hashed against a golden recorded on the pre-P69 code. `UPDATE_TIMELINE_GOLDEN=1` re-records it (only for
 * an intended change, say so in the PR); `TIMELINE_PARITY_DUMP=<dir>` writes the markup per view for diffing.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import { Engine, cmd } from "../engine";
import { ops, type Placement, type Project } from "../domain";
import { renderParityProject } from "../__fixtures__/renderParity";
import type { Filmstrip, Peaks } from "./media";
import type { ClipLoad } from "../render";

const GOLDEN = join(__dirname, "__golden__", "timelineParity.json");

export function timelineParityProject(): Project {
  const e = new Engine(renderParityProject());
  e.dispatch(cmd.setSpeed("m-vid", 2));
  e.dispatch(cmd.setLinkedAudioMuted("m-vid", true));
  const p = structuredClone(e.getState().project);
  const comp = p.compositions[p.rootCompositionId];
  const overlay = comp.tracks.find((t) => t.placements.some((x) => x.id === "o-blue"))!;
  const vid = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === "m-vid")!;
  // A frozen video and a clip of a type this build does not register.
  overlay.placements.push({ ...structuredClone(vid), id: "o-freeze", startTicks: 17 * 120_000, durationTicks: 120_000, freeze: true, speed: undefined, linkedAudio: undefined, transitionIn: undefined });
  overlay.placements.push({ ...structuredClone(vid), id: "o-unknown", startTicks: 19 * 120_000, durationTicks: 120_000, clipType: "scene3d" as Placement["clipType"], transitionIn: undefined, speed: undefined, linkedAudio: undefined });
  return p;
}

function previews(p: Project) {
  const thumbs: Record<string, string> = {};
  const peaks: Record<string, Peaks> = {};
  const strips: Record<string, Filmstrip> = {};
  for (const a of Object.values(p.assets)) {
    if (a.id === "a-glb") continue; // still loading: no thumbnail yet (is-nothumb)
    thumbs[a.id] = `data:thumb/${a.id}`;
    for (const v of a.versions) {
      peaks[`${a.id}:${v.id}`] = { perSecond: 4, data: new Float32Array([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.4, 0.8]) };
      strips[`${a.id}:${v.id}`] = { times: [0, 1, 2], frames: ["data:f0", "data:f1", "data:f2"], aspect: 16 / 9 };
    }
  }
  const loads = new Map<string, ClipLoad>([["m-vid", { progress: 0.5 }], ["o-vid", {}]]);
  return { thumbs, peaks, strips, loads };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const VIEWS: { name: string; centered: boolean; expanded?: ops.TrackGroup; selectedId?: string }[] = [
  { name: "desktop", centered: false, selectedId: "m-img" },
  { name: "phone", centered: true, selectedId: "m-img" },
  ...(["main", "overlay", "text", "effect", "audio"] as const).map((g) => ({ name: `phone-${g}`, centered: true, expanded: g, selectedId: "o-vid" })),
];

describe("P69 timeline parity", () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
    // Waveforms paint on a canvas; jsdom has none (the canvas element itself is part of the markup).
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
  });

  it("every view renders the same markup as before", () => {
    const project = timelineParityProject();
    const pv = previews(project);
    const out: Record<string, string> = {};
    let all = "";
    const dump = process.env.TIMELINE_PARITY_DUMP;
    if (dump) mkdirSync(dump, { recursive: true });
    for (const v of VIEWS) {
      const engine = new Engine(project);
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      act(() => {
        root.render(<Timeline engine={engine} project={project} time={9 * 120_000} playing={false} onSeek={() => {}} onSelect={() => {}} selectedId={v.selectedId}
          pps={40} onZoom={() => {}} centered={v.centered} expanded={v.expanded} onExpand={() => {}} {...pv} />);
      });
      // Generated ids (caption words, tracks) differ per run: number them in order of appearance.
      const ids = new Map<string, string>();
      const html = el.innerHTML.replace(/\b[a-z]{2,5}_[0-9a-f]{8}[0-9a-z]*\b/g, (m) => { if (!ids.has(m)) ids.set(m, `id${ids.size}`); return ids.get(m)!; });
      out[v.name] = fnv(html);
      all += html;
      if (dump) writeFileSync(join(dump, `${v.name}.html`), html.replace(/></g, ">\n<"));
      act(() => root.unmount());
      el.remove();
    }
    // Every clip of the fixture is on screen somewhere.
    for (const id of ["m-red", "m-ph", "m-img", "m-vid", "m-html", "o-vid", "o-glb", "o-freeze", "o-unknown", "a-music", "t-hello", "e-blur"]) expect(all, id).toContain(`data-placement-id="${id}"`);
    for (const part of ["v2-ph", "v2-blank-body", "v2-clip-load", "is-nothumb", "background-image", "<canvas"]) expect(all, part).toContain(part);
    if (process.env.UPDATE_TIMELINE_GOLDEN) { mkdirSync(join(__dirname, "__golden__"), { recursive: true }); writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`); }
    expect(out).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });
});
