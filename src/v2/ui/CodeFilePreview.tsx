import { useEffect, useRef, useState } from "react";
import { dataUrlBytes, decodeTextDataUrl, formatBytes, kindLabel, mimeOf, objectUrlFromDataUrl, previewKind } from "./codeFilePreview";
import { GlbViewer } from "./GlbViewer";
import { Ic } from "./Icon";

export function CodeFilePreview({ name, data, files, names, mobile, onClose, onShow }: {
  name: string;
  data: string;
  files: Record<string, string>;
  names: string[];
  mobile: boolean;
  onClose: () => void;
  onShow: (name: string) => void;
}) {
  const kind = previewKind(name, data);
  const mime = mimeOf(name, data);
  const size = formatBytes(dataUrlBytes(data));
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [dims, setDims] = useState("");
  const [stats, setStats] = useState("");
  const [text, setText] = useState("");
  const closeBtn = useRef<HTMLButtonElement>(null);
  const idx = names.indexOf(name);
  const prev = idx > 0 ? names[idx - 1] : undefined;
  const next = idx >= 0 && idx < names.length - 1 ? names[idx + 1] : undefined;

  useEffect(() => {
    setError(""); setDims(""); setStats(""); setText(""); setUrl("");
    if (kind === "text") {
      try { setText(decodeTextDataUrl(data)); }
      catch { setError("Couldn't read this file as text."); }
      return;
    }
    if (kind === "other") return;
    let href = "";
    try { href = objectUrlFromDataUrl(data); setUrl(href); }
    catch { setError("Couldn't read this file."); }
    return () => { if (href) URL.revokeObjectURL(href); };
  }, [name, data, kind]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowLeft" && prev) { e.preventDefault(); onShow(prev); }
      else if (e.key === "ArrowRight" && next) { e.preventDefault(); onShow(next); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onShow, prev, next]);

  const meta = [
    kindLabel(kind),
    mime,
    size,
    dims,
    stats,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`v2-ce-fprev-back${mobile ? " is-sheet" : ""}`} data-testid="v2-ce-fprev" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v2-ce-fprev" role="dialog" aria-modal="true" aria-label="File preview" onPointerDown={(e) => e.stopPropagation()}>
        <header className="v2-ce-fprev-head">
          {names.length > 1 && (
            <button type="button" className="v2-btn v2-ce-icon" aria-label="Previous file" disabled={!prev} onClick={() => prev && onShow(prev)}><Ic g="prev" /></button>
          )}
          <div className="v2-ce-fprev-title">
            <b title={name}>{name}</b>
            <span className="v2-muted" data-testid="v2-ce-fprev-meta">{meta}</span>
          </div>
          {names.length > 1 && (
            <button type="button" className="v2-btn v2-ce-icon" aria-label="Next file" disabled={!next} onClick={() => next && onShow(next)}><Ic g="next" /></button>
          )}
          <button ref={closeBtn} type="button" className="v2-btn v2-ce-icon" aria-label="Close preview" title="Close" onClick={onClose}><Ic g="✕" /></button>
        </header>
        <div className="v2-ce-fprev-body">
          {error && <p className="v2-ce-error" role="alert" data-testid="v2-ce-fprev-error">{error}</p>}
          {!error && kind === "image" && url && (
            <img className="v2-ce-fprev-media" data-testid="v2-ce-fprev-image" src={url} alt=""
              onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) setDims(`${i.naturalWidth} × ${i.naturalHeight}`); }}
              onError={() => setError("Couldn't load this image.")} />
          )}
          {!error && kind === "video" && url && (
            <video className="v2-ce-fprev-media" data-testid="v2-ce-fprev-video" src={url} controls playsInline
              onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setDims(`${v.videoWidth} × ${v.videoHeight}`); }}
              onError={() => setError("Couldn't load this video.")} />
          )}
          {!error && kind === "audio" && url && (
            <audio className="v2-ce-fprev-media v2-ce-fprev-audio" data-testid="v2-ce-fprev-audio" src={url} controls
              onError={() => setError("Couldn't load this audio.")} />
          )}
          {!error && kind === "model" && url && (
            <GlbViewer url={url} name={name} data={data} files={files}
              onStats={(s) => setStats(`${s.meshes} ${s.meshes === 1 ? "mesh" : "meshes"} · ${s.triangles} ${s.triangles === 1 ? "triangle" : "triangles"}`)}
              onError={setError} />
          )}
          {!error && kind === "text" && <pre className="v2-ce-fprev-text" data-testid="v2-ce-fprev-text">{text}</pre>}
          {!error && kind === "other" && (
            <p className="v2-muted v2-ce-fprev-other" data-testid="v2-ce-fprev-other">No preview for this type. {name} · {size} · {mime}</p>
          )}
        </div>
      </div>
    </div>
  );
}
