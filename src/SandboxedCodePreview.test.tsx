// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import SandboxedCodePreview from "./SandboxedCodePreview";
import type { Asset } from "./types";

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

describe("SandboxedCodePreview image references", () => {
  it("exposes only explicitly referenced image Assets through the sandbox image map", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const image: Asset = {
      id: "reference-image-1",
      name: "Character reference",
      kind: "image",
      path: "data:image/png;base64,AA=="
    };
    const hidden: Asset = {
      id: "unreferenced-image",
      name: "Unreferenced",
      kind: "image",
      path: "data:image/png;base64,BB=="
    };
    await act(async () => {
      root.render(<SandboxedCodePreview title="Code" assets={[image, hidden]} referencedImageAssetIds={[image.id]} js={'const url = window.DIONYSUS_IMAGES["reference-image-1"];'} />);
      await Promise.resolve();
    });
    const frame = container.querySelector<HTMLIFrameElement>("iframe");
    expect(frame).toBeTruthy();
    const srcDoc = frame!.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("window.DIONYSUS_IMAGES");
    expect(srcDoc).toContain("reference-image-1");
    expect(srcDoc).toContain("data:image/png;base64,AA==");
    expect(srcDoc).not.toContain("unreferenced-image");
    expect(frame!.getAttribute("sandbox")).toBe("allow-scripts");
  });
});
