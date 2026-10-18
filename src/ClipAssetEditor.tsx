import { Film, X } from "lucide-react";
import { useState } from "react";

type Props = {
  onSave: (clip: { name: string; canvasWidth: number; canvasHeight: number; duration: number }) => void;
  onClose: () => void;
};

export default function ClipAssetEditor({ onSave, onClose }: Props) {
  const [name, setName] = useState("New clip");
  const [canvasWidth, setCanvasWidth] = useState(1920);
  const [canvasHeight, setCanvasHeight] = useState(1080);
  const [duration, setDuration] = useState(5);

  const save = () => {
    const cleanName = name.trim();
    if (!cleanName || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) ||
        canvasWidth < 1 || canvasHeight < 1 || !Number.isFinite(duration) || duration <= 0) return;
    onSave({
      name: cleanName,
      canvasWidth: Math.round(canvasWidth),
      canvasHeight: Math.round(canvasHeight),
      duration: Math.max(0.1, duration),
    });
  };

  return <div className="settings-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog clip-asset-editor" role="dialog" aria-modal="true" aria-labelledby="clip-asset-title">
      <header>
        <div>
          <span className="inspector-kicker">ASSET LIBRARY</span>
          <h2 id="clip-asset-title">Create clip asset</h2>
          <p className="settings-dialog-description">Create an empty, editable clip. Add Shots, Code, audio, images, and nested Clips later in its Timeline Editor.</p>
        </div>
        <button className="icon-button" aria-label="Close create clip dialog" onClick={onClose}><X size={15}/></button>
      </header>
      <label className="field-label">Clip title
        <input className="text-field" aria-label="Clip title" value={name} onChange={event => setName(event.target.value)} autoFocus />
      </label>
      <div className="settings-dialog-grid">
        <label className="field-label">Canvas width (px)
          <input className="text-field" aria-label="Clip canvas width" type="number" min="1" max="16384" step="1" value={canvasWidth} onChange={event => setCanvasWidth(Number(event.target.value))} />
        </label>
        <label className="field-label">Canvas height (px)
          <input className="text-field" aria-label="Clip canvas height" type="number" min="1" max="16384" step="1" value={canvasHeight} onChange={event => setCanvasHeight(Number(event.target.value))} />
        </label>
        <label className="field-label">Duration (seconds)
          <input className="text-field" aria-label="Clip duration" type="number" min="0.1" max="36000" step="0.1" value={duration} onChange={event => setDuration(Number(event.target.value))} />
        </label>
      </div>
      <div className="asset-empty-clip-note"><Film size={16}/><span>This Clip starts empty with Version A. Its contents can be built and edited on the Timeline.</span></div>
      <footer>
        <button className="button button-quiet button-small" onClick={onClose}>Cancel</button>
        <button className="button button-primary button-small" disabled={!name.trim() || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth < 1 || canvasHeight < 1 || !Number.isFinite(duration) || duration <= 0} onClick={save}>Create empty Clip</button>
      </footer>
    </section>
  </div>;
}
