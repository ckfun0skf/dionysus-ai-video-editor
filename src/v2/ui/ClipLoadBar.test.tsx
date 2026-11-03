// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClipLoadBar } from "./Timeline";

describe("ClipLoadBar (P29-CLIP-LOADING)", () => {
  it("shows a progress bar when progress is known", () => {
    const h = renderToStaticMarkup(<ClipLoadBar load={{ progress: 0.42 }} />);
    expect(h).toContain('aria-valuenow="42"');
    expect(h).toContain("width:42%");
  });
  it("shows a spinner when progress is unknown", () => {
    const h = renderToStaticMarkup(<ClipLoadBar load={{}} />);
    expect(h).toContain("is-unknown");
    expect(h).toContain("v2-clip-spin");
  });
});
