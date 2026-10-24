import { useCallback, useRef } from "react";

/** Which edges of a horizontal scroller have hidden content: "l", "r", "lr" or "" (1px slack for subpixel widths). */
export function fadeEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): "" | "l" | "r" | "lr" {
  const l = scrollLeft > 1, r = scrollLeft + clientWidth < scrollWidth - 1;
  return l && r ? "lr" : l ? "l" : r ? "r" : "";
}

/**
 * V2-111: scroll cue for overflowing rows (mobile toolbar, inspector tabs). Sets `data-fade` on the element so CSS can
 * mask the edge(s) that hide more items; updates on scroll, resize and when the items change.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const cleanup = useRef<() => void>();
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = undefined;
    if (!el) return;
    const update = () => { const f = fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth); if (el.dataset.fade !== f) el.dataset.fade = f; };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    ro?.observe(el);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : undefined;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    cleanup.current = () => { el.removeEventListener("scroll", update); ro?.disconnect(); mo?.disconnect(); };
  }, []);
}
