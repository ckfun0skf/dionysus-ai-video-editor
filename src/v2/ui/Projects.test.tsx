// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain";
import { createMemoryStorage, readBlobBytes } from "../persistence";
import { ago } from "./Projects";
import { V2App } from "./V2App";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(() => { document.body.innerHTML = ""; localStorage.clear(); });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const btn = (el: Element, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;

describe("project list", () => {
  it("formats update times", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-10-23T09:00:00Z", now)).toBe("3 h ago");
  });

  it("creates, renames, opens and deletes (with undo)", async () => {
    const storage = createMemoryStorage();
    const other = createProject("Holiday cut", "2020-01-01T00:00:00Z");
    await storage.projects.save(other);
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<V2App openStorage={async () => storage} />));
    await wait();
    const title = () => (el.querySelector('[aria-label="Project name"]') as HTMLInputElement).value;
    expect(title()).toBe("My first v2 project");
    await act(async () => btn(el, "Projects").click()); await wait();
    const dlg = () => el.querySelector('[aria-label="Projects"][role="dialog"]')!;
    expect(dlg().querySelectorAll("li")).toHaveLength(2);
    expect(dlg().querySelector('[aria-current="true"]')!.textContent).toContain("My first v2 project");
    // ⋯ menu: the open project can't be deleted
    await act(async () => btn(dlg(), "More for My first v2 project").click());
    const menu = () => el.querySelector('[role="menu"]')!;
    expect(menu().getAttribute("aria-label")).toBe("My first v2 project actions");
    expect([...menu().querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(["Export project file", "Rename", "Delete (open now)", "Cancel"]);
    expect(btn(menu(), "Delete (open now)").disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(dlg()).toBeTruthy(); // Escape closed only the menu

    // rename the other project (right-click opens the same menu)
    const row = [...dlg().querySelectorAll("li")].find((li) => li.textContent?.includes("Holiday cut"))!;
    await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 })));
    await act(async () => btn(menu(), "Rename").click());
    const input = dlg().querySelector('[aria-label="New project name"]') as HTMLInputElement;
    input.value = "Summer cut";
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await wait();
    expect((await storage.projects.load(other.id))!.name).toBe("Summer cut");

    // delete it, then undo
    await act(async () => btn(dlg(), "More for Summer cut").click());
    await act(async () => btn(menu(), "Delete").click());
    await act(async () => btn(dlg(), "Delete").click()); await wait();
    expect(await storage.projects.load(other.id)).toBeUndefined();
    await act(async () => btn(dlg(), "Undo").click()); await wait();
    expect((await storage.projects.load(other.id))!.name).toBe("Summer cut");

    // open it
    await act(async () => [...dlg().querySelectorAll(".v2-project-open")].find((b) => b.textContent?.includes("Summer cut"))!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await wait(); await wait();
    expect(title()).toBe("Summer cut");
    expect(storage.lastProjectId.get()).toBe(other.id);

    // new project opens empty
    await act(async () => btn(el, "Projects").click()); await wait();
    await act(async () => btn(dlg(), " New project").click()); await wait(); await wait();
    expect(title()).toMatch(/^Untitled/);
    expect((await storage.projects.list())).toHaveLength(3);
  });

  it("exports a project file and imports it back as a copy, and explains a bad file", async () => {
    const storage = createMemoryStorage();
    const other = createProject("Holiday cut", "2020-01-01T00:00:00Z");
    const clip = new Uint8Array(40_000).map((_, i) => i & 255);
    other.assets.a1 = { id: "a1", kind: "video", name: "clip", versions: [{ id: "v1", createdAt: "2020-01-01T00:00:00Z", media: { blobKey: "a1/v1", mime: "video/mp4" }, provenance: { source: "import", inputs: [] } }] };
    await storage.blobs.put("a1/v1", new Blob([clip], { type: "video/mp4" }));
    await storage.projects.save(other);
    let saved: Blob | undefined, savedName = "";
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => { saved = b; return "blob:x"; };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { savedName = this.download; });
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<V2App openStorage={async () => storage} />));
    await wait();
    await act(async () => btn(el, "Projects").click()); await wait();
    const dlg = () => el.querySelector('[aria-label="Projects"][role="dialog"]')!;
    await act(async () => btn(dlg(), "More for Holiday cut").click());
    await act(async () => btn(el.querySelector('[role="menu"]')!, "Export project file").click());
    await wait(); await wait();
    const ex = el.querySelector('[aria-label="Export project file"]')!;
    expect(ex.textContent).toContain("Holiday-cut.dionysus.zip");
    expect(ex.textContent).toContain("Downloaded.");
    expect(savedName).toBe("Holiday-cut.dionysus.zip");
    expect(saved!.size).toBeGreaterThan(40_000);
    await act(async () => btn(ex, "Done").click());
    click.mockRestore();

    const pick = async (f: File) => {
      const input = dlg().querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toContain(".zip");
      Object.defineProperty(input, "files", { value: [f], configurable: true });
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      await wait(); await wait();
      return el.querySelector('[aria-label="Import project file"]')!;
    };
    let im = await pick(new File([saved!], "Holiday-cut.dionysus.zip", { type: "application/zip" }));
    expect(im.textContent).toContain("already here as “Holiday cut”");
    expect(btn(im, "Replace")).toBeTruthy();
    await act(async () => btn(im, "Import as a copy").click()); await wait(); await wait();
    expect(im.textContent).toContain("Imported “Holiday cut (copy)”");
    const copy = (await storage.projects.list()).find((p) => p.name === "Holiday cut (copy)")!;
    const loaded = (await storage.projects.load(copy.id))!;
    expect(await readBlobBytes((await storage.blobs.get(loaded.assets.a1.versions[0].media.blobKey))!)).toEqual(clip);
    expect([...dlg().querySelectorAll("li")].some((li) => li.textContent?.includes("Holiday cut (copy)"))).toBe(true);
    await act(async () => btn(im, "Close").click());

    im = await pick(new File(["hello"], "notes.zip"));
    expect(im.querySelector('[role="alert"]')!.textContent).toMatch(/not a zip/);
    await act(async () => btn(im, "Close").click());
    expect(el.querySelector('[aria-label="Import project file"]')).toBeNull();
  });
});
