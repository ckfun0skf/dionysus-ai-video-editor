// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "../domain";
import { createMemoryStorage } from "../persistence";
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
    await act(async () => btn(el, "☰ Projects").click()); await wait();
    const dlg = () => el.querySelector('[aria-label="Projects"][role="dialog"]')!;
    expect(dlg().querySelectorAll("li")).toHaveLength(2);
    expect(dlg().querySelector('[aria-current="true"]')!.textContent).toContain("My first v2 project");
    expect(btn(dlg(), "Delete My first v2 project").disabled).toBe(true);

    // rename the other project
    await act(async () => btn(dlg(), "Rename Holiday cut").click());
    const input = dlg().querySelector('[aria-label="New project name"]') as HTMLInputElement;
    input.value = "Summer cut";
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); await wait();
    expect((await storage.projects.load(other.id))!.name).toBe("Summer cut");

    // delete it, then undo
    await act(async () => btn(dlg(), "Delete Summer cut").click());
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
    await act(async () => btn(el, "☰ Projects").click()); await wait();
    await act(async () => btn(dlg(), "＋ New project").click()); await wait(); await wait();
    expect(title()).toMatch(/^Untitled/);
    expect((await storage.projects.list())).toHaveLength(3);
  });
});
