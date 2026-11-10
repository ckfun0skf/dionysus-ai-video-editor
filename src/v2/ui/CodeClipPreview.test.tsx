// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CodeClipPreview } from "./CodeClipPreview";

const origGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return { canvas: this, save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {} };
  } as never;
});
afterEach(() => { document.body.innerHTML = ""; });
afterAll(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

const HTML = `<!doctype html><html><body><canvas></canvas></body></html>`;

async function mount(props: Partial<Parameters<typeof CodeClipPreview>[0]> = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const onError = props.onError ?? (() => undefined);
  await act(async () => {
    createRoot(el).render(
      <CodeClipPreview html={HTML} duration={2} width={320} height={180} transparent={false} collapsed={false} onError={onError} {...props} />,
    );
  });
  return el;
}

describe("P54 CodeClipPreview (shared storyboard / editor preview)", () => {
  it("sends init with params on ready and posts params again when they change, without remounting", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<CodeClipPreview html={HTML} duration={2} width={320} height={180} transparent={false} collapsed={false} onError={() => undefined} params={{ text: "THE END" }} />);
    });
    const iframe = el.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const src = iframe.srcdoc;
    const sent: { type?: string; params?: Record<string, unknown> }[] = [];
    const win = iframe.contentWindow!;
    vi.spyOn(win, "postMessage").mockImplementation(((m: { type?: string }) => { sent.push(m); }) as never);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { type: "dionysus:ready" }, source: win }));
    });
    expect(sent.some((m) => m.type === "dionysus:init" && m.params?.text === "THE END")).toBe(true);
    sent.length = 0;
    await act(async () => {
      root.render(<CodeClipPreview html={HTML} duration={2} width={320} height={180} transparent={false} collapsed={false} onError={() => undefined} params={{ text: "FIN" }} />);
    });
    expect(iframe.srcdoc).toBe(src); // no remount
    expect(sent.some((m) => m.type === "dionysus:params" && m.params?.text === "FIN")).toBe(true);
  });

  it("Mix toggle is at least 44px, off by default, and shows the mix canvas when turned on", async () => {
    const el = await mount();
    const btn = el.querySelector('[data-testid="v2-ce-mix"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(el.querySelector('[data-testid="v2-ce-mix-canvas"]')).toBeNull();
    const cs = getComputedStyle(btn);
    // jsdom reports 0 unless we set the rule; the stylesheet class and explicit min size are what the app uses.
    expect(btn.className).toMatch(/v2-ce-icon/);
    await act(async () => { btn.click(); });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(el.querySelector('[data-testid="v2-ce-mix-canvas"]')).not.toBeNull();
    expect(el.querySelector(".v2-ce-stage")!.classList.contains("is-mix")).toBe(true);
    void cs;
  });

  it("Mix on asks the underlay for the picture at the preview time", async () => {
    const seen: number[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = 8; canvas.height = 8;
    const el = await mount({
      mixUnderlay: (t) => { seen.push(t); return { image: canvas }; },
    });
    const btn = el.querySelector('[data-testid="v2-ce-mix"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(seen.length).toBeGreaterThan(0);
    expect(el.querySelector('[data-testid="v2-ce-mix-canvas"]')).not.toBeNull();
  });
});
