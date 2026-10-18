import { describe, expect, it } from "vitest";
import { collectCompositionLayers, getCompositionDuration } from "./compositionRenderer";
import { sampleProject } from "./sampleProject";

describe("compositionRenderer", () => {
  it("collects only selected versions and offsets layers by slot start", () => {
    const project = structuredClone(sampleProject);
    const layers = collectCompositionLayers(project);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers).toEqual([...layers].sort((a,b)=>a.start-b.start));
    for (const shot of project.shots) for (const slot of shot.slots) {
      const selected = slot.versions.find(version=>version.id===slot.selectedVersionId);
      if (selected) for (const layer of selected.layers) {
        expect(layers.some(item=>item.id===layer.id && item.start===layer.start+slot.start)).toBe(true);
      }
    }
  });
  it("calculates output duration from the last visible layer end", () => {
    expect(getCompositionDuration([
      {id:"a",name:"a",kind:"image",start:0,duration:3},
      {id:"b",name:"b",kind:"text",start:2.5,duration:4}
    ])).toBe(6.5);
  });
});
