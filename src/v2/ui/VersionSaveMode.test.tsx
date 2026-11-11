// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { VersionSaveModeChoice } from "./VersionSaveMode";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

describe("VersionSaveModeChoice", () => {
  it("renders both choices and notes other clips when replacing", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el); roots.push(root);
    act(() => { root.render(<VersionSaveModeChoice mode="replace" onChange={() => undefined} otherCount={2} />); });
    expect(el.textContent).toContain("Save as new version");
    expect(el.textContent).toContain("Replace current version");
    expect(el.textContent).toContain("2 other clips use this take");
  });

  it("reports the picked mode", () => {
    const picked: string[] = [];
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el); roots.push(root);
    act(() => { root.render(<VersionSaveModeChoice mode="new" onChange={(m) => picked.push(m)} otherCount={1} />); });
    act(() => { el.querySelector<HTMLButtonElement>("[data-testid=save-mode-replace]")!.click(); });
    expect(picked).toEqual(["replace"]);
  });
});
