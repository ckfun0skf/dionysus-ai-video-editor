// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileMatchesAccept, hasFileDrag, useFileDrag } from "./fileDrop";
import { CODE_FILE_ACCEPT } from "./CodeEditor";
import { HTML_IMPORT_ACCEPT } from "./htmlPackage";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

describe("fileMatchesAccept", () => {
  it("matches MIME wildcards, listed extensions, and common image extensions when type is empty", () => {
    expect(fileMatchesAccept(new File(["x"], "logo.png", { type: "image/png" }), CODE_FILE_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "logo.png"), CODE_FILE_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "model.glb"), CODE_FILE_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "Brand.woff2", { type: "font/woff2" }), CODE_FILE_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "brief.pdf", { type: "application/pdf" }), CODE_FILE_ACCEPT)).toBe(false);
    expect(fileMatchesAccept(new File(["x"], "notes.txt", { type: "text/plain" }), CODE_FILE_ACCEPT)).toBe(false);
    expect(fileMatchesAccept(new File(["x"], "clip.html", { type: "text/html" }), HTML_IMPORT_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "pack.dionysus-html.zip", { type: "application/zip" }), HTML_IMPORT_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "clip.html"), HTML_IMPORT_ACCEPT)).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "photo.jpg"), "video/*,image/*")).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "drone.mp4", { type: "video/mp4" }), "video/*,image/*")).toBe(true);
    expect(fileMatchesAccept(new File(["x"], "brief.pdf", { type: "application/pdf" }), "video/*,image/*")).toBe(false);
  });

  it("detects a Files drag from dataTransfer.types", () => {
    expect(hasFileDrag({ dataTransfer: { types: ["Files"] } as unknown as DataTransfer })).toBe(true);
    expect(hasFileDrag({ dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer })).toBe(false);
    expect(hasFileDrag({ dataTransfer: null })).toBe(false);
  });
});

function Probe({ onFiles }: { onFiles: (files: FileList) => void }) {
  const { over, handlers } = useFileDrag(onFiles);
  return <div data-testid="zone" data-over={over ? "1" : "0"} {...handlers}><span>child</span></div>;
}

function fire(el: Element, type: string, files: File[] = []) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { dataTransfer: { types: ["Files"], files, dropEffect: "none" } });
  el.dispatchEvent(ev);
  return ev;
}

describe("useFileDrag", () => {
  it("highlights while dragging and does not flicker off when entering a child", () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const got: File[] = [];
    const r = createRoot(el); roots.push(r);
    act(() => { r.render(<Probe onFiles={(f) => { got.push(...Array.from(f)); }} />); });
    const zone = el.querySelector('[data-testid="zone"]')!;
    const child = zone.querySelector("span")!;
    act(() => { fire(zone, "dragenter"); });
    expect(zone.getAttribute("data-over")).toBe("1");
    act(() => { fire(child, "dragenter"); });
    expect(zone.getAttribute("data-over")).toBe("1");
    act(() => { fire(child, "dragleave"); });
    expect(zone.getAttribute("data-over")).toBe("1");
    act(() => { fire(zone, "dragleave"); });
    expect(zone.getAttribute("data-over")).toBe("0");
    const f = new File(["x"], "logo.png", { type: "image/png" });
    act(() => { fire(zone, "dragenter"); fire(zone, "drop", [f]); });
    expect(zone.getAttribute("data-over")).toBe("0");
    expect(got.map((x) => x.name)).toEqual(["logo.png"]);
  });
});
