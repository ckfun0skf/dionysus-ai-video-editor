import { cmd, type Engine } from "../../engine";
import type { Project } from "../../domain";
import { Ic } from "../Icon";
import { SeriesSelect } from "../series/SeriesLibrary";
import { setProjectSeries, useSeries } from "../series/seriesStore";
import { ASPECTS, aspectOf, BACKGROUNDS, FPS_CHOICES } from "./layout";

/** V2-106: shown in the inspector when nothing is selected. Every change is one undo step. */
export function ProjectSettings({ engine, project, extra, onSeries }: { engine: Engine; project: Project; extra?: React.ReactNode; /** P5: open the Series library. */ onSeries?: () => void }) {
  const s = project.settings;
  const aspect = aspectOf(s);
  const bg = s.background ?? "#000000";
  const series = useSeries(project.seriesId);
  return (
    <div className="v2-psettings">
      <section aria-label="Canvas">
        <h4>Canvas</h4>
        <div className="v2-aspects" role="radiogroup" aria-label="Aspect ratio">
          {ASPECTS.map((a) => {
            const k = 26 / Math.max(a.width, a.height);
            return (
              <button key={a.id} role="radio" aria-checked={aspect === a.id} className={`v2-aspect ${aspect === a.id ? "is-active" : ""}`} title={`${a.label} · ${a.width}×${a.height} — ${a.hint}`}
                onClick={() => aspect !== a.id && engine.dispatch(cmd.setProjectSettings({ width: a.width, height: a.height }, `Aspect ${a.label}`))}>
                <span className="v2-aspect-box" style={{ width: a.width * k, height: a.height * k }} aria-hidden />
                <span>{a.label}</span>
              </button>
            );
          })}
        </div>
        <p className="v2-abnote">{s.width}×{s.height}{aspect ? "" : " (custom)"} · clips keep their relative position and scale.</p>
      </section>
      <section aria-label="Frame rate">
        <h4>Frame rate</h4>
        <div className="v2-seg" role="radiogroup" aria-label="Frame rate">
          {FPS_CHOICES.map((f) => <button key={f} role="radio" aria-checked={s.fps === f} className={`v2-seg-btn ${s.fps === f ? "is-active" : ""}`} title={`${f} frames per second`} onClick={() => s.fps !== f && engine.dispatch(cmd.setProjectSettings({ fps: f }, `${f} fps`))}>{f}</button>)}
        </div>
      </section>
      <section aria-label="Background">
        <h4>Background</h4>
        <div className="v2-swatches" role="radiogroup" aria-label="Background colour">
          {BACKGROUNDS.map((c) => <button key={c} role="radio" aria-checked={bg.toLowerCase() === c} aria-label={`Background ${c}`} title={c} className={`v2-swatch ${bg.toLowerCase() === c ? "is-active" : ""}`} style={{ background: c }} onClick={() => engine.dispatch(cmd.setProjectSettings({ background: c }, "Background colour"))} />)}
          <label className="v2-swatch v2-swatch-custom" title="Custom colour"><Ic g="✎" size={14} />
            <input type="color" aria-label="Custom background colour" value={bg} onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setProjectSettings({ background: e.target.value }, "Background colour"))} />
          </label>
        </div>
        <p className="v2-abnote">Shows wherever no clip covers the canvas — in the preview and the export.</p>
      </section>
      <section aria-label="Series">
        <h4>Series</h4>
        <SeriesSelect value={project.seriesId} onChange={(id) => setProjectSeries(engine, id)} label="Project series" />
        {onSeries && <button className="v2-btn v2-series-open" onClick={onSeries}><Ic g="library" size={16} /> Series library</button>}
        <p className="v2-abnote">{series ? `Episode of “${series.name}” · ${Object.keys(series.assets).length} shared asset(s).` : "Share characters, props, locations and styles between episodes."}</p>
      </section>
      {extra}
      <p className="v2-empty-hint"><Ic g="⤧" size={14} /> Select a clip on the timeline to edit it here.</p>
    </div>
  );
}
