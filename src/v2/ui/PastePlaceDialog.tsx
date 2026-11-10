import { useEffect, useRef } from "react";
import { chain } from "../domain";

/**
 * P51/P52: paste asks where the clipboard should land and which track receives it.
 * Cancel (button, Esc, or the backdrop) applies nothing. All placements are one undo step in the caller.
 * "Insert after current clip" is disabled when there is no current main-track clip (see domain/chain.ts).
 * "At the playhead" is disabled when the clipboard would overlap a clip on the chosen track.
 */
export function PastePlaceDialog({
  canAfter,
  canPlayhead,
  playheadTitle,
  tracks,
  trackId,
  onTrackChange,
  newTrackLabel,
  onChoose,
  onCancel,
}: {
  canAfter: boolean;
  canPlayhead: boolean;
  playheadTitle?: string;
  tracks: { id: string; label: string }[];
  trackId: string;
  onTrackChange: (id: string) => void;
  newTrackLabel?: string;
  onChoose: (where: chain.PasteWhere) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div ref={ref} className="v2-confirm v2-paste-place" role="dialog" aria-modal="true" aria-label="Paste clip" tabIndex={-1} data-testid="paste-place"
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}>
        <h4>Paste clip</h4>
        <p>Where should it go? Insert after and the end of the chain move later clips on the receiving track. At the playhead places it in a free gap without moving anything.</p>
        <label className="v2-field v2-paste-track">
          <span>Track</span>
          <select aria-label="Paste onto track" value={trackId} onChange={(e) => onTrackChange(e.target.value)}>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value={chain.NEW_PASTE_TRACK}>{newTrackLabel ?? "New track"}</option>
          </select>
        </label>
        <div className="v2-confirm-actions">
          <button type="button" className="v2-btn" disabled={!canAfter} title={canAfter ? "Put it just after the current main-track clip" : "No current clip — select a main-track clip, or move the playhead onto one"} onClick={() => onChoose("after")}>Insert after current clip</button>
          <button type="button" className="v2-btn primary" autoFocus title="Put it where the current run of main-track clips ends" onClick={() => onChoose("end")}>At the end of the current chain</button>
          <button type="button" className="v2-btn" disabled={!canPlayhead} title={playheadTitle ?? (canPlayhead ? "Place it at the playhead without moving other clips" : "A clip already occupies the playhead on this track")} onClick={() => onChoose("playhead")}>At the playhead</button>
          <button type="button" className="v2-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
