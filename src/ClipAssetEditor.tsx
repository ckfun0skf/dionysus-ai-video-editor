import { useMemo, useState } from "react";
import { AudioLines, Code2, Film, Plus, Trash2 } from "lucide-react";
import type { Asset, CompositionLayer } from "./types";
import CodePlayground, { type CodePlaygroundSource } from "./CodePlayground";

type Props = {
  assets: Asset[];
  onSave: (clip: { name: string; versions: Array<{ name: string; duration: number; layers: CompositionLayer[] }> }) => void;
  onClose: () => void;
};

const makeId = () => "clip-layer-" + Math.random().toString(36).slice(2, 10);

export default function ClipAssetEditor({ assets, onSave, onClose }: Props) {
  const [name, setName] = useState("New clip asset");
  const [duration, setDuration] = useState(5);
  const [versionName, setVersionName] = useState("Version A");
  const [savedVersions, setSavedVersions] = useState<Array<{ name: string; duration: number; layers: CompositionLayer[] }>>([]);
  const [layerType, setLayerType] = useState<"video" | "audio" | "code">("video");
  const [assetId, setAssetId] = useState("");
  const [layers, setLayers] = useState<CompositionLayer[]>([]);
  const [codeDraft, setCodeDraft] = useState<CodePlaygroundSource>({
    html: '<canvas id="scene" style="display:block;width:100%;height:100%"></canvas>',
    css: "html, body { margin: 0; width: 100%; height: 100%; background: transparent; }",
    js: "// Build your clip here. Three.js can render into #scene."
  });
  const [codeName, setCodeName] = useState("Code layer");
  const choices = useMemo(() => assets.filter(asset =>
    layerType === "audio" ? asset.kind === "audio" :
    layerType === "code" ? asset.kind === "script" :
    asset.kind === "video" || asset.kind === "image"
  ), [assets, layerType]);

  const addSelectedAsset = () => {
    const asset = choices.find(item => item.id === assetId);
    if (!asset) return;
    const start = layers.length ? Math.max(...layers.map(layer => layer.start + layer.duration)) : 0;
    const layer: CompositionLayer = {
      id: makeId(), name: asset.name,
      kind: asset.kind === "audio" ? "audio" : asset.kind === "script" ? "procedural" : asset.kind === "image" ? "image" : "video",
      start, duration: Math.max(0.1, duration - start), assetId: asset.kind === "script" ? undefined : asset.id,
      ...(asset.kind === "script" ? { html: asset.html ?? "", css: asset.css ?? "", code: asset.js ?? "" } : {}),
      ...(asset.kind === "audio" ? { volume: 1 } : {})
    };
    setLayers(current => [...current, layer]);
    setAssetId("");
  };
  const addCodeLayer = () => {
    const start = layers.length ? Math.max(...layers.map(layer => layer.start + layer.duration)) : 0;
    setLayers(current => [...current, {
      id: makeId(), name: codeName.trim() || "Code layer", kind: "procedural",
      start, duration: Math.max(0.1, duration - start), html: codeDraft.html, css: codeDraft.css, code: codeDraft.js,
      x: 0, y: 0, width: 100, height: 100
    }]);
  };
  const updateLayer = (layerId: string, patch: Partial<CompositionLayer>) => setLayers(current => current.map(layer => layer.id === layerId ? { ...layer, ...patch } : layer));
  const addVersion = () => {
    if (!layers.length) return;
    setSavedVersions(current => [...current, { name: versionName.trim() || "Version " + String(current.length + 1), duration, layers: layers.map(layer => ({ ...layer })) }]);
    setLayers([]);
    setDuration(5);
    setVersionName("Version " + String(savedVersions.length + 2));
  };

  return <div className="settings-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-dialog clip-asset-editor" role="dialog" aria-modal="true" aria-labelledby="clip-asset-title">
      <header><div><span className="inspector-kicker">ASSET LIBRARY</span><h2 id="clip-asset-title">Create clip asset</h2><p className="settings-dialog-description">Combine reusable video, audio, and code layers into one clip asset.</p></div><button className="button button-quiet button-small" onClick={onClose}>Close</button></header>
      <div className="settings-dialog-grid">
        <label className="field-label">Clip name<input className="text-field" value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="field-label">Clip duration (seconds)<input className="text-field" type="number" min="0.1" max="600" step="0.1" value={duration} onChange={event => setDuration(Math.max(0.1, Number(event.target.value) || 0.1))} /></label>
      </div>
      <div className="clip-asset-version-bar"><label className="field-label">Current version<input className="text-field" value={versionName} onChange={event => setVersionName(event.target.value)} /></label><button className="button button-quiet button-small" disabled={!layers.length} onClick={addVersion}><Plus size={14}/> Save version & start another</button></div>
      {savedVersions.length > 0 && <div className="clip-asset-saved-versions"><strong>Saved versions</strong>{savedVersions.map((version, index) => <div key={version.name + index}><span>{version.name}</span><small>{version.duration.toFixed(1)}s · {version.layers.length} layers</small><button className="button button-quiet button-small danger-action" onClick={() => setSavedVersions(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div>)}</div>}
      <div className="clip-asset-add-row">
        <select className="text-field" aria-label="New clip layer type" value={layerType} onChange={event => { setLayerType(event.target.value as "video"|"audio"|"code"); setAssetId(""); }}>
          <option value="video">Video / image asset</option><option value="audio">Audio asset</option><option value="code">Code asset</option>
        </select>
        <select className="text-field" aria-label="Select asset for clip layer" value={assetId} onChange={event => setAssetId(event.target.value)}>
          <option value="">Choose existing asset…</option>{choices.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        <button className="button button-quiet button-small" disabled={!assetId} onClick={addSelectedAsset}><Plus size={14}/> Add asset</button>
      </div>
      {layerType === "code" && <div className="clip-asset-code-entry"><label className="field-label">New code layer name<input className="text-field" value={codeName} onChange={event => setCodeName(event.target.value)} /></label><CodePlayground title={codeName} {...codeDraft} onChange={patch => setCodeDraft(current => ({ ...current, ...patch }))}/><div className="inline-actions"><button className="button button-quiet button-small" onClick={addCodeLayer}><Plus size={14}/> Add code layer</button></div></div>}
      <div className="clip-asset-layer-list"><div className="clip-asset-layer-heading"><strong>Clip layers</strong><span>{layers.length} layers</span></div>
        {layers.length === 0 && <div className="asset-picker-empty">Add video, audio, or code layers. A clip can contain code and audio without any video shot.</div>}
        {layers.map(layer => <div className="clip-asset-layer-row" key={layer.id}>
          <span className="clip-asset-layer-icon">{layer.kind === "audio" ? <AudioLines size={15}/> : layer.kind === "procedural" || layer.kind === "script" ? <Code2 size={15}/> : <Film size={15}/>}</span>
          <div className="clip-asset-layer-main"><strong>{layer.name}</strong><small>{layer.kind === "audio" ? "Audio" : layer.kind === "procedural" || layer.kind === "script" ? "Code" : "Video / image"}</small></div>
          <label>Start <input aria-label={layer.name + " start"} type="number" min="0" step="0.1" value={layer.start} onChange={event => updateLayer(layer.id, { start: Math.max(0, Number(event.target.value) || 0) })}/></label>
          <label>Duration <input aria-label={layer.name + " duration"} type="number" min="0.1" step="0.1" value={layer.duration} onChange={event => updateLayer(layer.id, { duration: Math.max(0.1, Number(event.target.value) || 0.1) })}/></label>
          <button className="icon-button danger-action" aria-label={"Remove " + layer.name} onClick={() => setLayers(current => current.filter(item => item.id !== layer.id))}><Trash2 size={14}/></button>
        </div>)}
      </div>
      <footer><button className="button button-quiet button-small" onClick={onClose}>Cancel</button><button className="button button-primary button-small" disabled={!name.trim() || (!layers.length && !savedVersions.length)} onClick={() => { const clean = (version: { name: string; duration: number; layers: CompositionLayer[] }) => ({ ...version, layers: version.layers.map(layer => ({ ...layer, duration: Math.min(layer.duration, Math.max(0.1, version.duration - layer.start)) })).filter(layer => layer.start < version.duration) }); onSave({ name: name.trim(), versions: [...savedVersions, ...(layers.length ? [{ name: versionName.trim() || "Version " + String(savedVersions.length + 1), duration, layers }] : [])].map(clean) }); }}>Save clip to Assets</button></footer>
    </section>
  </div>;
}
