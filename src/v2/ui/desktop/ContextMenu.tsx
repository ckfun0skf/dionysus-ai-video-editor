import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ic } from "../Icon";

export type MenuItem = { label: string; icon?: string; shortcut?: string; onSelect: () => void; disabled?: boolean; danger?: boolean } | "sep";

/** V2-107: right-click menu. Keyboard: ↑/↓/Home/End move, Enter activates, Esc or click outside closes. Stays inside the viewport. */
export function ContextMenu({ x, y, items, label, onClose }: { x: number; y: number; items: MenuItem[]; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const blur = () => onClose();
    window.addEventListener("pointerdown", down, true); window.addEventListener("resize", blur); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("resize", blur); window.removeEventListener("blur", blur); };
  }, [onClose]);
  const key = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => { e.preventDefault(); btns[(n + btns.length) % btns.length]?.focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(btns.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(); }
  };
  return (
    <div ref={ref} className="v2-cmenu" role="menu" aria-label={label} style={pos} onKeyDown={key} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === "sep" ? <div key={`s${i}`} className="v2-cmenu-sep" role="separator" /> : (
        <button key={it.label} role="menuitem" className={`v2-cmenu-item ${it.danger ? "is-danger" : ""}`} disabled={it.disabled}
          onClick={() => { onClose(); it.onSelect(); }}>
          <span className="v2-cmenu-ic" aria-hidden>{it.icon ? <Ic g={it.icon} size={15} /> : null}</span>
          <span className="v2-cmenu-label">{it.label}</span>
          {it.shortcut && <kbd className="v2-cmenu-kbd">{it.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
