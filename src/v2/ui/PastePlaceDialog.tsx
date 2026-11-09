import { useEffect, useRef } from "react";

/**
 * P51: paste asks where the clipboard should land. Cancel (button, Esc, or the backdrop) applies nothing.
 * Both placements are one undo step in the caller. "Insert after current clip" is disabled when there is no current
 * main-track clip (see domain/chain.ts).
 */
export function PastePlaceDialog({ canAfter, onChoose, onCancel }: {
  canAfter: boolean;
  onChoose: (where: "after" | "end") => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div ref={ref} className="v2-confirm v2-paste-place" role="dialog" aria-modal="true" aria-label="Paste clip" tabIndex={-1} data-testid="paste-place"
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
        <h4>Paste clip</h4>
        <p>Where should it go? Later clips move up, and linked layers and subtitles stay with their clips.</p>
        <div className="v2-confirm-actions">
          <button type="button" className="v2-btn" disabled={!canAfter} title={canAfter ? "Put it just after the current main-track clip" : "No current clip — select a main-track clip, or move the playhead onto one"} onClick={() => onChoose("after")}>Insert after current clip</button>
          <button type="button" className="v2-btn primary" autoFocus title="Put it where the current run of main-track clips ends" onClick={() => onChoose("end")}>At the end of the current chain</button>
          <button type="button" className="v2-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
