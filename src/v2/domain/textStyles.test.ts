import { describe, expect, it } from "vitest";
import { text } from ".";
import { fontStack } from "../registry";

describe("text styles (registry textStyle presets)", () => {
  it("textTemplates lists every style with CSS font stacks and no nulls", () => {
    const list = text.textTemplates();
    expect(list.map((t) => t.id)).toEqual(["plain", "caption", "outline", "neon", "pop", "typewriter", "glow", "echo", "soft-shadow", "cinematic"]);
    for (const t of list) {
      expect(t.label).toBeTruthy();
      for (const v of Object.values(t.data)) expect(v).not.toBeNull();
      if (t.data.font) expect(t.data.font).toContain(",");
    }
  });
  it("textStyleData resolves a style and returns undefined for unknown ids", () => {
    expect(text.textStyleData("pop")).toMatchObject({ font: fontStack("impact"), size: 0.14 });
    expect(text.textStyleData("plain")).toMatchObject({ shadow: undefined, background: undefined });
    expect(text.textStyleData("nope")).toBeUndefined();
  });
  it("textStyleFields maps storyboard style data", () => {
    expect(text.textStyleFields({ font: "serif", size: 0.09, background: null })).toEqual({ font: fontStack("serif"), size: 0.09, background: undefined });
  });
});
