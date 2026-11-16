/**
 * P69/P70 UI parity fixture: the render parity project plus a sped-up, muted main video, a frozen video and a clip of
 * a type this build does not register. Used by `ui/timelineParity.test.tsx` and `ui/inspectorParity.test.tsx`.
 */
import { cmd, Engine } from "../engine";
import type { Placement, Project } from "../domain";
import { renderParityProject } from "./renderParity";

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

