import { useEffect, useRef } from "react";
import { Ic } from "../Icon";
import { SHORTCUT_GROUPS } from "./shortcuts";

/** V2-107: "?" keyboard-shortcut sheet. Esc, the close button or a backdrop click dismisses it. */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="v2-kbd-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v2-kbd-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || e.key === "?") { e.preventDefault(); onClose(); } }}>
        <header className="v2-kbd-head">
          <Ic g="keyboard" size={18} /><h2>Keyboard shortcuts</h2>
          <button ref={ref} className="v2-dtool" aria-label="Close shortcuts" title="Close (Esc)" onClick={onClose}><Ic g="✕" size={16} /></button>
        </header>
        <div className="v2-kbd-cols">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>{g.items.map((s) => (
                <div key={s.label} className="v2-kbd-row"><dt>{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{s.label}</dd></div>
              ))}</dl>
            </section>
          ))}
        </div>
        <p className="v2-kbd-foot">Tip: right-click a clip or an empty track for more actions.</p>
      </div>
    </div>
  );
}
