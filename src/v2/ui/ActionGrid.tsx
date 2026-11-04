import { Ic } from "./Icon";

/** P32: one action in a sheet grid (More / Trim / Audio). `active` marks a toggle that is on (background only). */
export type GridAction = { key: string; icon: string; label: string; title?: string; run: () => void; active?: boolean; danger?: boolean };

/** P32: grouped grid of 44px+ icon buttons with short labels, used by the clip bar's More, Trim and Audio sheets. */
export function ActionGrid({ groups }: { groups: { title: string; items: GridAction[] }[] }) {
  return <div className="v2-agrid">
    {groups.map((g) => <section key={g.title} aria-label={g.title}>
      <h4>{g.title}</h4>
      <div className="v2-agrid-row">
        {g.items.map((a) => <button key={a.key} className={`v2-agrid-btn ${a.active ? "is-active" : ""} ${a.danger ? "is-danger" : ""}`} data-tool={a.key} title={a.title ?? a.label}
          aria-pressed={a.active === undefined ? undefined : a.active} onClick={a.run}><b aria-hidden><Ic g={a.icon} /></b><span>{a.label}</span></button>)}
      </div>
    </section>)}
  </div>;
}
