import { useEffect, useRef, useState } from "react";
import { HTML_LIBRARIES } from "../render";
import { Sheet } from "./Sheet";

export const filterLibraries = (q: string) => {
  const s = q.trim().toLowerCase();
  return HTML_LIBRARIES.filter((l) => !s || `${l.name} ${l.id} ${l.specifier}`.toLowerCase().includes(s));
};

/** Multi-select combobox: "Libraries ▾" + removable chips; dropdown on desktop, bottom sheet on mobile. */
export function LibraryPicker({ value, onChange, mobile }: { value: string[]; onChange: (v: string[]) => void; mobile: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || mobile) return;
    const h = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open, mobile]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const list = filterLibraries(q);
  const panel = (
    <div className="v2-libpick-panel">
      <input className="v2-input" type="search" autoFocus={!mobile} placeholder="Search libraries" aria-label="Search libraries" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      <div role="listbox" aria-multiselectable="true" aria-label="Libraries">
        {list.length === 0 && <div className="v2-muted">No libraries match “{q}”.</div>}
        {list.map((l) => {
          const on = value.includes(l.id);
          return (
            <button key={l.id} role="option" aria-selected={on} className={`v2-libpick-opt ${on ? "is-on" : ""}`} title={`Self-hosted ${l.name} ${l.version}, pinned by SRI. Import as "${l.specifier}".`} onClick={() => toggle(l.id)}>
              <span className="v2-libpick-check">{on ? "✓" : ""}</span>{l.name} <span className="v2-muted">{l.version}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div className="v2-libpick" ref={box}>
      <button className="v2-libpick-trigger" aria-haspopup="listbox" aria-expanded={open} title="Choose libraries for this clip" onClick={() => setOpen((o) => !o)}>Libraries ▾</button>
      {value.length === 0 && <span className="v2-muted">None</span>}
      {value.map((id) => {
        const l = HTML_LIBRARIES.find((x) => x.id === id);
        return (
          <span key={id} className="v2-chip">{l?.name ?? id}
            <button aria-label={`Remove ${l?.name ?? id}`} title={`Remove ${l?.name ?? id}`} onClick={() => onChange(value.filter((x) => x !== id))}>✕</button>
          </span>
        );
      })}
      {open && (mobile ? <Sheet label="Libraries" className="v2-libpick-sheet" onClose={() => setOpen(false)}>{panel}</Sheet> : <div className="v2-libpick-drop">{panel}</div>)}
    </div>
  );
}
