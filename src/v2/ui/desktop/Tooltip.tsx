import { useEffect, useState } from "react";

/**
 * V2-107: styled hover tooltips for the desktop shell. Delegates on every [title] inside `.v2-app.is-desktop`:
 * after a short delay shows a dark-token bubble (flipped to stay on screen) and suppresses the native one while hovered.
 * The title attribute is restored on leave, so accessibility names and tests are unchanged.
 */
export function DesktopTooltips({ delay = 450 }: { delay?: number }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean }>();
  useEffect(() => {
    let el: HTMLElement | undefined, timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      if (el?.dataset.v2tip !== undefined) { if (!el.hasAttribute("title")) el.setAttribute("title", el.dataset.v2tip); delete el.dataset.v2tip; }
      el = undefined; setTip(undefined);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const t = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[title]");
      if (t === el) return;
      restore();
      if (!t || !t.closest(".v2-app.is-desktop") || t.matches("input[type=text], .v2-title")) return;
      const text = t.getAttribute("title") ?? "";
      if (!text.trim()) return;
      el = t; t.dataset.v2tip = text; t.removeAttribute("title");
      timer = window.setTimeout(() => {
        if (!el?.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 44 < window.innerHeight;
        setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 12), window.innerWidth - 12), y: below ? r.bottom + 6 : r.top - 6, below });
      }, delay);
    };
    const out = (e: PointerEvent) => { if (el && !el.contains(e.relatedTarget as Node | null)) restore(); };
    window.addEventListener("pointerover", over, true);
    window.addEventListener("pointerout", out, true);
    for (const ev of ["pointerdown", "keydown", "wheel", "blur"]) window.addEventListener(ev, restore, true);
    return () => {
      restore();
      window.removeEventListener("pointerover", over, true);
      window.removeEventListener("pointerout", out, true);
      for (const ev of ["pointerdown", "keydown", "wheel", "blur"]) window.removeEventListener(ev, restore, true);
    };
  }, [delay]);
  if (!tip) return null;
  return <div className={`v2-tip ${tip.below ? "is-below" : "is-above"}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
}
