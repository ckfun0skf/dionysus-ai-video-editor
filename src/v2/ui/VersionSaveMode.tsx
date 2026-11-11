import type { VersionSaveMode } from "../domain";

export function VersionSaveModeChoice({
  mode, onChange, otherCount = 0, canReplace = true, compact,
}: {
  mode: VersionSaveMode;
  onChange: (mode: VersionSaveMode) => void;
  /** Other timeline clips that already show the current take (they will update if the user replaces). */
  otherCount?: number;
  canReplace?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`v2-vsave ${compact ? "is-compact" : ""}`} data-testid="version-save-mode">
      <div className="v2-vsave-opts" role="radiogroup" aria-label="How to save this version">
        <button type="button" role="radio" aria-checked={mode === "new"} className={`v2-vsave-opt ${mode === "new" ? "is-on" : ""}`} data-testid="save-mode-new" onClick={() => onChange("new")}>
          <b>Save as new version</b>
          <span>Keep the current take and add this as another version of the shot.</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === "replace"} className={`v2-vsave-opt ${mode === "replace" ? "is-on" : ""}`} data-testid="save-mode-replace" disabled={!canReplace} onClick={() => canReplace && onChange("replace")}>
          <b>Replace current version</b>
          <span>Overwrite this take in place (same version name). Other clips using it will update.</span>
        </button>
      </div>
      {mode === "replace" && otherCount > 0 && (
        <p className="v2-vsave-note" data-testid="save-mode-others">
          {otherCount === 1 ? "1 other clip uses" : `${otherCount} other clips use`} this take and will show the updated media.
        </p>
      )}
    </div>
  );
}
