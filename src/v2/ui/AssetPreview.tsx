import { useEffect, useRef, useState } from "react";
import { HtmlLivePreview } from "./CodeEditor";
import { Ic } from "./Icon";
import { decodePeaks, type Peaks } from "./media";

export type PreviewKind = "video" | "image" | "audio" | "html";

/** Blob text, with a FileReader fallback for engines without Blob.text(). */
export const blobText = (b: Blob): Promise<string> => typeof b.text === "function" ? b.text() : new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsText(b); });

/** A blob loaded for preview: an object URL (video / image / audio) or the text (html). Revoked on change/unmount. */
export function usePreviewBlob(load: (() => Promise<Blob | undefined>) | undefined, kind: PreviewKind, key: string) {
  const [state, setState] = useState<{ url?: string; html?: string; blob?: Blob; missing?: boolean }>({});
  useEffect(() => {
    let live = true, url: string | undefined;
    setState({});
    if (!load) return;
    load().then(async (b) => {
      if (!live) return;
      if (!b) { setState({ missing: true }); return; }
      if (kind === "html") { const html = await blobText(b); if (live) setState({ html, blob: b }); return; }
      url = URL.createObjectURL(b);
      setState({ url, blob: b });
    }).catch(() => live && setState({ missing: true }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind]);
  return state;
}

/** Decoded waveform peaks of an audio blob (undefined while decoding or where decoding isn't available). */
export function usePeaks(blob: Blob | undefined): Peaks | undefined {
  const [peaks, setPeaks] = useState<Peaks>();
  useEffect(() => {
    let live = true;
    setPeaks(undefined);
    if (blob) decodePeaks(blob).then((p) => { if (live) setPeaks(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [blob]);
  return peaks;
}

/**
 * The whole waveform of an audio file, with an optional selected range (dimmed outside) and play head, in seconds.
 * Without peaks (still decoding, or no Web Audio) it draws a flat line so the layout doesn't jump.
 */
export function WaveStrip({ peaks, durSec, height = 56, from, to, at, label = "Waveform" }: {
  peaks?: Peaks; durSec: number; height?: number; from?: number; to?: number; at?: number; label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    const w = Math.max(1, c.clientWidth || 320), dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const n = Math.max(1, Math.floor(w / 3)), d = Math.max(0.01, durSec);
    const x = (s: number) => (s / d) * w;
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * d, t1 = ((i + 1) / n) * d;
      let v = 0.02;
      if (peaks) { const a = Math.floor(t0 * peaks.perSecond), z = Math.max(a + 1, Math.ceil(t1 * peaks.perSecond)); for (let j = a; j < z && j < peaks.data.length; j++) v = Math.max(v, peaks.data[j]); }
      const inside = from === undefined || to === undefined || (t1 > from && t0 < to);
      g.fillStyle = inside ? "rgba(140,200,255,.9)" : "rgba(255,255,255,.28)";
      const h = Math.max(1, v * height * 0.9);
      g.fillRect(i * 3, height / 2 - h / 2, 2, h);
    }
    if (at !== undefined) { g.fillStyle = "#fff"; g.fillRect(Math.min(w - 2, x(at)), 0, 2, height); }
  }, [peaks, durSec, height, from, to, at]);
  return <canvas ref={ref} className="v2-wavestrip" style={{ height }} role="img" aria-label={label} data-testid="wavestrip" />;
}

/**
 * P2C (item 7): a playable preview of one asset version: video and audio play (audio with its waveform), images show,
 * HTML (code) clips play live in the same sandbox as the timeline (params at their defaults unless given).
 */
export function AssetPreview({ kind, load, cacheKey, name, durationSec, width, height }: {
  kind: PreviewKind; load: () => Promise<Blob | undefined>; cacheKey: string; name: string;
  durationSec?: number; width?: number; height?: number;
}) {
  const st = usePreviewBlob(load, kind, cacheKey);
  const peaks = usePeaks(kind === "audio" ? st.blob : undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(durationSec ?? 0);
  if (st.missing) return <p className="v2-hint v2-preview-missing" role="note"><Ic g="alert" size={14} /> This file is missing from this device.</p>;
  if (!st.url && st.html === undefined) return <div className="v2-asset-preview is-loading" aria-busy="true"><span className="v2-hint">Loading preview…</span></div>;
  return (
    <div className={`v2-asset-preview kind-${kind}`} data-testid="asset-preview" data-kind={kind}>
      {kind === "video" && <video src={st.url} controls playsInline preload="metadata" aria-label={`Preview of ${name}`} />}
      {kind === "image" && <img src={st.url} alt={name} />}
      {kind === "audio" && (
        <>
          <WaveStrip peaks={peaks} durSec={dur || 1} at={at} label={`Waveform of ${name}`} />
          <audio ref={audio} src={st.url} controls preload="metadata" aria-label={`Preview of ${name}`}
            onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d); }}
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} />
        </>
      )}
      {kind === "html" && st.html !== undefined && (
        <HtmlLivePreview html={st.html} duration={Math.max(0.5, durationSec ?? 5)} width={width || 1920} height={height || 1080} transparent={false} collapsed={false} onError={noop} />
      )}
    </div>
  );
}
const noop = () => undefined;
