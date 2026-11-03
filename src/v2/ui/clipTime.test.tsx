// @vitest-environment jsdom
/** P29-CLIP-TIME: clip-relative time helpers and the playhead label. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import type { Placement } from "../domain";
import { secondsToTicks as s } from "../domain/time";
import { clipTimeAt, clipTimeText, REL_MODE_KEY } from "./clipTime";
import { RelTag } from "./Timeline";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
// Clip at timeline 3 s, 4 s long, source in at 5 s.
const clip = (extra: Partial<Placement> = {}) => ({ id: "A", clipType: "video", startTicks: s(3), durationTicks: s(4), sourceInTicks: s(5), source: { assetId: "v", versionId: "v1" }, ...extra }) as unknown as Placement;

describe("clipTimeAt", () => {
  it("gives clip and source time inside the clip", () => {
    const c = clipTimeAt(clip(), s(4))!;
    expect(clipTimeText(c)).toBe("Clip 1.0s · Source 6.0s");
  });
  it("is undefined outside the clip", () => {
    expect(clipTimeAt(clip(), s(2.9))).toBeUndefined();
    expect(clipTimeAt(clip(), s(7))).toBeUndefined();
    expect(clipTimeAt(undefined, s(4))).toBeUndefined();
  });
  it("accounts for speed, freeze and reverse", () => {
    expect(clipTimeText(clipTimeAt(clip({ speed: 2 }), s(4))!)).toBe("Clip 1.0s · Source 7.0s");
    expect(clipTimeText(clipTimeAt(clip({ freeze: true }), s(4))!)).toBe("Clip 1.0s · Source 5.0s");
    expect(clipTimeText(clipTimeAt(clip({ reverse: true }), s(4))!)).toBe("Clip 1.0s · Source 8.0s");
  });
});

describe("RelTag", () => {
  it("shows +1.0s, toggles to source time and remembers the choice", () => {
    localStorage.removeItem(REL_MODE_KEY);
    const el = document.createElement("div"); document.body.appendChild(el);
    const r = createRoot(el);
    act(() => r.render(<RelTag time={s(4)} placement={clip()} left={10} />));
    const b = () => el.querySelector<HTMLButtonElement>("[data-testid=clip-time-tag]");
    expect(b()!.textContent).toBe("+1.0s");
    act(() => b()!.click());
    expect(b()!.textContent).toBe("src 6.0s");
    expect(localStorage.getItem(REL_MODE_KEY)).toBe("src");
    act(() => r.render(<RelTag time={s(8)} placement={clip()} left={10} />));
    expect(b()).toBeNull();
    act(() => r.unmount());
    const r2 = createRoot(el);
    act(() => r2.render(<RelTag time={s(4)} placement={clip()} left={10} />));
    expect(b()!.textContent).toBe("src 6.0s");
    act(() => r2.unmount());
  });
});
