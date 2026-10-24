import type { ReactNode } from "react";
import { Ic } from "../Icon";

export type InspectorTab = { id: string; label: string; icon?: string; render: () => ReactNode };

/**
 * V2-106 right-hand contextual inspector frame (CapCut / Premiere "Properties").
 * The editor decides the tabs for the current selection; this only renders header, tab strip and body.
 */
export function Inspector({ icon, title, subtitle, tabs, tab, onTab, actions, onDone }: {
  icon: string; title: string; subtitle?: string; tabs: InspectorTab[]; tab?: string; onTab: (id: string) => void; actions?: ReactNode; onDone?: () => void;
}) {
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  return (
    <aside className="v2-inspect" aria-label="Inspector">
      <header className="v2-inspect-head">
        <span className="v2-inspect-icon" aria-hidden><Ic g={icon} size={18} /></span>
        <span className="v2-inspect-title"><strong title={title}>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
        {actions}
        {onDone && <button className="v2-icon v2-inspect-done" aria-label="Done" title="Deselect (Esc)" onClick={onDone}><Ic g="✓" size={18} /><span className="v2-sr">Done</span></button>}
      </header>
      {tabs.length > 1 && (
        <nav className="v2-inspect-tabs" role="tablist" aria-label={`${title} settings`}>
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === cur?.id} className={`v2-inspect-tab ${t.id === cur?.id ? "is-active" : ""}`} onClick={() => onTab(t.id)}>
              {t.icon && <Ic g={t.icon} size={15} />}<span>{t.label}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="v2-inspect-body" role={tabs.length > 1 ? "tabpanel" : undefined} aria-label={cur?.label}>{cur?.render()}</div>
    </aside>
  );
}
