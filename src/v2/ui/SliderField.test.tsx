// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SliderField, parseNum, snapToStep } from "./SliderField";
import { VolumeHold, HOLD_MS, HOLD_TRAVEL_PX } from "./VolumeHold";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { vi.useRealTimers(); });

function mount(props: Partial<React.ComponentProps<typeof SliderField>> = {}) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const calls: number[] = []; const log: string[] = [];
  let value = props.value ?? 0.5;
  const render = () => root.render(<SliderField label="Opacity" min={0} max={1} step={0.01} unit="%" scale={100} {...props} value={value}
    onChange={(v) => { calls.push(v); value = v; render(); }} onBegin={() => log.push("begin")} onEnd={() => log.push("end")} />);
  return { el, calls, log, render, q: (s: string) => el.querySelector(s) as HTMLElement };
}
const typeIn = (input: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const ptr = (type: string, init: PointerEventInit = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }) as MouseEvent & { pointerId: number };
  Object.defineProperty(e, "pointerId", { value: 1 }); return e;
};

describe("snapToStep / parseNum", () => {
  it("clamps and snaps to the step", () => {
    expect(snapToStep(1.7, 0, 1, 0.01)).toBe(1);
    expect(snapToStep(-3, -1, 1, 0.005)).toBe(-1);
    expect(snapToStep(0.123, 0, 1, 0.05)).toBe(0.1);
    expect(snapToStep(0.30000000004, 0, 1, 0.1)).toBe(0.3);
  });
  it("reads a comma as a decimal point", () => {
    expect(parseNum("1,5")).toBe(1.5); expect(parseNum(" ")).toBeNaN(); expect(parseNum("abc")).toBeNaN();
  });
});

describe("SliderField", () => {
  it("renders [−] slider [+] and a decimal numeric field with the unit", async () => {
    const m = mount(); await act(async () => m.render());
    const num = m.q('input[aria-label="Opacity value"]') as HTMLInputElement;
    expect(num.getAttribute("inputmode")).toBe("decimal");
    expect(num.value).toBe("50");
    expect(m.q(".v2-sf-unit").textContent).toBe("%");
    expect(m.q('button[aria-label="Decrease Opacity"]')).toBeTruthy();
    expect(m.q('button[aria-label="Increase Opacity"]')).toBeTruthy();
  });
  it("commits a typed value on Enter, clamped, as one begin/end", async () => {
    const m = mount(); await act(async () => m.render());
    const num = m.q('input[aria-label="Opacity value"]') as HTMLInputElement;
    await act(async () => { num.focus(); typeIn(num, "150"); });
    expect(m.calls).toEqual([]);
    await act(async () => { num.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(m.calls).toEqual([1]);
    expect(m.log.slice(0, 2)).toEqual(["begin", "end"]);
    expect(num.value).toBe("100");
  });
  it("commits on blur, accepts a comma, reverts junk and Esc", async () => {
    const m = mount({ step: 0.001, scale: 1, unit: undefined }); await act(async () => m.render());
    const num = m.q('input[aria-label="Opacity value"]') as HTMLInputElement;
    await act(async () => { num.focus(); typeIn(num, "0,25"); num.blur(); });
    expect(m.calls).toEqual([0.25]);
    await act(async () => { num.focus(); typeIn(num, "zz"); num.blur(); });
    expect(m.calls).toEqual([0.25]); expect(num.value).toBe("0.250");
    await act(async () => { num.focus(); typeIn(num, "0.9"); num.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(num.value).toBe("0.250");
  });
  it("+ / − step once on press and repeat while held", async () => {
    vi.useFakeTimers();
    const m = mount(); await act(async () => m.render());
    const plus = m.q('button[aria-label="Increase Opacity"]');
    await act(async () => { plus.dispatchEvent(ptr("pointerdown")); });
    expect(m.calls).toEqual([0.51]);
    await act(async () => { vi.advanceTimersByTime(400 + 70 * 3); });
    expect(m.calls.length).toBe(4);
    await act(async () => { plus.dispatchEvent(ptr("pointerup")); vi.advanceTimersByTime(1000); });
    expect(m.calls.length).toBe(4);
    expect(m.calls[3]).toBeCloseTo(0.54);
    expect(m.log).toEqual(["begin", "end"]);
    const minus = m.q('button[aria-label="Decrease Opacity"]');
    await act(async () => { minus.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
    expect(m.calls[4]).toBeCloseTo(0.53);
  });
});

describe("VolumeHold", () => {
  it("press-and-hold shows the meter and vertical drag sets the volume in one gesture", async () => {
    vi.useFakeTimers();
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); const calls: number[] = []; const log: string[] = []; let v = 0.5;
    const render = () => root.render(<VolumeHold value={v} onChange={(x) => { calls.push(x); v = x; render(); }} onBegin={() => log.push("b")} onEnd={() => log.push("e")} />);
    await act(async () => render());
    const label = el.querySelector(".v2-volume") as HTMLElement;
    (label as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    await act(async () => { label.dispatchEvent(ptr("pointerdown", { clientY: 300 })); vi.advanceTimersByTime(HOLD_MS + 10); });
    expect(document.querySelector('[data-testid="volume-meter"]')?.textContent).toContain("50%");
    const tm = new Event("touchmove", { cancelable: true }); label.dispatchEvent(tm);
    expect(tm.defaultPrevented).toBe(true);
    await act(async () => { label.dispatchEvent(ptr("pointermove", { clientY: 300 - HOLD_TRAVEL_PX / 4 })); });
    expect(calls.at(-1)).toBeCloseTo(0.75);
    expect(document.querySelector('[data-testid="volume-meter"]')?.textContent).toContain("75%");
    await act(async () => { label.dispatchEvent(ptr("pointerup")); });
    expect(document.querySelector('[data-testid="volume-meter"]')).toBeNull();
    expect(log).toEqual(["b", "e"]);
  });
  it("a tap does not open the meter or block scroll", async () => {
    vi.useFakeTimers();
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<VolumeHold value={1} onChange={() => {}} />));
    const label = el.querySelector(".v2-volume") as HTMLElement;
    await act(async () => { label.dispatchEvent(ptr("pointerdown", { clientY: 10 })); label.dispatchEvent(ptr("pointerup")); vi.advanceTimersByTime(1000); });
    expect(document.querySelector('[data-testid="volume-meter"]')).toBeNull();
    const tm = new Event("touchmove", { cancelable: true }); label.dispatchEvent(tm);
    expect(tm.defaultPrevented).toBe(false);
  });
});
