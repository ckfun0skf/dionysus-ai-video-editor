// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClipAssetEditor from "./ClipAssetEditor";

let container: HTMLDivElement;
let root: Root;

function setValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

describe("ClipAssetEditor", () => {
  it("creates an empty Clip with title, pixel dimensions, and duration", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onSave = vi.fn();
    const onClose = vi.fn();

    act(() => root.render(<ClipAssetEditor onSave={onSave} onClose={onClose} />));
    setValue(container.querySelector<HTMLInputElement>('[aria-label="Clip title"]')!, "Intro card");
    setValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas width"]')!, "1080");
    setValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas height"]')!, "1920");
    setValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "7.5");

    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Create empty Clip"));
    expect(save).toBeDefined();
    expect((save as HTMLButtonElement).disabled).toBe(false);
    act(() => save!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onSave).toHaveBeenCalledWith({
      name: "Intro card",
      canvasWidth: 1080,
      canvasHeight: 1920,
      duration: 7.5,
    });
  });

  it("does not allow a non-positive duration", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onSave = vi.fn();
    act(() => root.render(<ClipAssetEditor onSave={onSave} onClose={vi.fn()} />));
    setValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "0");
    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Create empty Clip"));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
