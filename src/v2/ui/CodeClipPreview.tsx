import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { HTML_SANDBOX, withRuntime } from "../render";
import type { Placement } from "../domain";
import { Ic } from "./Icon";
import { clipLocalToTicks, paintMixFrame, type MixFrame, type MixUnderlayFn } from "./codeClipMix";

/** Forwards the clip's errors (window errors, rejections and the runtime's console.error) to the editor. */
const REPORTER = `<script>(()=>{const post=(m,s)=>{try{parent.postMessage({type:"dionysus:error",message:String(m),stack:String(s||"")},"*")}catch(_){}};`
  + `addEventListener("error",(e)=>post(e.message,(e.error&&e.error.stack)||(e.lineno?"about:srcdoc:"+e.lineno+":"+e.colno:"")));`
  + `addEventListener("unhandledrejection",(e)=>{const r=e.reason;post(r&&r.message||r,r&&r.stack)});`
  + `const ce=console.error.bind(console);console.error=(...a)=>{const x=a.find((v)=>v instanceof Error);post(x?x.message:a.map(String).join(" "),x&&x.stack);ce(...a)}})()</script>`;

/** The preview document and the doc line where the clip's module script starts (to map error lines back). */
export function previewDoc(html: string): { doc: string; scriptLine: number } {
  const page = withRuntime(html);
  const m = /^\s*<!doctype[^>]*>/i.exec(page);
  const doc = m ? m[0] + REPORTER + page.slice(m[0].length) : REPORTER + page;
  const at = doc.lastIndexOf('<script type="module">');
  return { doc, scriptLine: at < 0 ? -1 : doc.slice(0, at).split("\n").length };
}

/** A runtime error's line in the Script tab, from its stack (about:srcdoc:LINE:COL), when it points into the script. */
export function scriptLineOf(stack: string, scriptLine: number): number | undefined {
  if (scriptLine < 0) return undefined;
  const m = /about:srcdoc:(\d+):\d+/.exec(stack);
  if (!m) return undefined;
  const l = Number(m[1]) - scriptLine;
  return l >= 1 ? l : undefined;
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export interface HtmlClipPreviewHost {
  post: (time: number, extraInputs?: Record<string, unknown>) => void;
  ready: RefObject<boolean>;
}

/**
 * Shared hook: drive a sandboxed clip iframe the same way the timeline does (init + params + frames).
 * Param changes are posted as `dionysus:params` without reloading the page.
 */
export function useHtmlClipPreview({
  frame, doc, duration, width, height, params, inputs, scriptLine, onError, onBitmap, getTime,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  doc: string;
  duration: number;
  width: number;
  height: number;
  params?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  scriptLine: number;
  onError: (e: { message: string; line?: number } | null) => void;
  onBitmap?: (bmp: ImageBitmap) => void;
  getTime: () => number;
}): HtmlClipPreviewHost {
  const ready = useRef(false);
  const seq = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onBitmapRef = useRef(onBitmap);
  onBitmapRef.current = onBitmap;
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;

  const post = useCallback((time: number, extraInputs?: Record<string, unknown>) => {
    if (!ready.current) return;
    const ins = extraInputs ?? inputsRef.current;
    frame.current?.contentWindow?.postMessage({
      type: "dionysus:frame", seq: ++seq.current, t: time, duration, ...(ins ? { inputs: ins } : {}),
    }, "*");
  }, [duration, frame]);

  useLayoutEffect(() => { ready.current = false; }, [doc]);

  useEffect(() => {
    onErrorRef.current(null);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object") return;
      const d = e.data as { type?: string; bmp?: ImageBitmap; message?: string; stack?: string; messages?: unknown };
      if (d.type === "dionysus:ready") {
        ready.current = true;
        frame.current?.contentWindow?.postMessage({
          type: "dionysus:init", width, height, duration, params: paramsRef.current,
        }, "*");
        post(getTimeRef.current());
      }
      if (d.type === "dionysus:frame") {
        if (d.bmp && onBitmapRef.current) onBitmapRef.current(d.bmp);
        else d.bmp?.close?.();
      } else {
        d.bmp?.close?.();
      }
      if (d.type === "dionysus:error") {
        onErrorRef.current({ message: String(d.message ?? "Error"), line: scriptLineOf(String(d.stack ?? ""), scriptLine) });
      }
      if (d.type === "dionysus:asset-error") {
        const text = Array.isArray(d.messages) ? d.messages.map(String).filter(Boolean).join(" ") : "";
        if (text) onErrorRef.current({ message: text });
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, [doc, scriptLine, post, frame, width, height, duration]);

  const paramSig = JSON.stringify(params ?? null);
  useEffect(() => {
    if (!ready.current) return;
    frame.current?.contentWindow?.postMessage({ type: "dionysus:params", params: params ?? {} }, "*");
    post(getTimeRef.current());
    // params object identity is captured via paramSig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSig, post, frame]);

  return useMemo(() => ({ post, ready }), [post]);
}

export interface CodeClipPreviewProps {
  html: string;
  duration: number;
  width: number;
  height: number;
  transparent: boolean;
  background?: string;
  collapsed: boolean;
  /** Mobile: show/hide the stage (the transport stays). */
  onToggle?: () => void;
  onError: (e: { message: string; line?: number } | null) => void;
  /** Resolved per-use values (defaults ⊕ overrides). Posted as init/params and updated live. */
  params?: Record<string, unknown>;
  /** ctx.inputs (graphic / audio / tracker) when the parent already has them. */
  inputs?: Record<string, unknown>;
  /** Hide the Mix toggle (tests / thumbnails). Default: show it. */
  showMix?: boolean;
  mix?: boolean;
  onMixChange?: (on: boolean) => void;
  /** Picture (and inputs) under this clip at clip-local seconds t. */
  mixUnderlay?: MixUnderlayFn;
  /** Placement used to paint the clip on Mix (transform, opacity, blend, fade). */
  mixPlacement?: Placement;
}

/**
 * Live preview in the same sandbox, CSP and runtime as the timeline. Plays (looping over the
 * clip's length) or shows the scrubbed time. Sends the use's param values and updates them live.
 * Mix (off by default) composites the clip over the underlying main/overlay picture.
 */
export function CodeClipPreview({
  html, duration, width, height, transparent, background, collapsed, onError, onToggle,
  params, inputs, showMix = true, mix: mixProp, onMixChange, mixUnderlay, mixPlacement,
}: CodeClipPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const mixCanvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [mixOn, setMixOn] = useState(false);
  const mix = mixProp ?? mixOn;
  const setMix = (on: boolean) => { setMixOn(on); onMixChange?.(on); };
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const mixUnderlayRef = useRef(mixUnderlay);
  mixUnderlayRef.current = mixUnderlay;
  const mixPlacementRef = useRef(mixPlacement);
  mixPlacementRef.current = mixPlacement;
  const underlayRef = useRef<CanvasImageSource | undefined>();
  const mixInputsRef = useRef<Record<string, unknown> | undefined>();
  const bmpRef = useRef<ImageBitmap | undefined>();
  const { doc, scriptLine } = useMemo(() => previewDoc(html), [html]);

  const paint = useCallback(() => {
    const c = mixCanvas.current;
    if (!c || !mixRef.current) return;
    const under = underlayRef.current;
    const uw = under && "width" in under ? Number((under as { width: number }).width) : 0;
    const uh = under && "height" in under ? Number((under as { height: number }).height) : 0;
    const cw = uw || width || 1920, ch = uh || height || 1080;
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    const g = c.getContext("2d");
    if (!g) return;
    const pl = mixPlacementRef.current;
    const at = pl ? clipLocalToTicks(pl, tRef.current) : undefined;
    paintMixFrame(g, under, bmpRef.current, pl, at);
  }, [width, height]);

  const onBitmap = useCallback((bmp: ImageBitmap) => {
    if (mixRef.current) {
      bmpRef.current?.close?.();
      bmpRef.current = bmp;
      paint();
    } else {
      bmp.close?.();
    }
  }, [paint]);

  const host = useHtmlClipPreview({
    frame, doc, duration, width, height, params, inputs, scriptLine, onError, onBitmap,
    getTime: () => tRef.current,
  });

  const runAt = useCallback((time: number) => {
    const load = mixUnderlayRef.current;
    if (mixRef.current && load) {
      const u = load(time);
      const apply = (f: MixFrame | undefined) => {
        if (f?.image) underlayRef.current = f.image;
        if (f?.inputs) mixInputsRef.current = f.inputs;
        host.post(time, f?.inputs ?? mixInputsRef.current);
        paint();
      };
      if (u && typeof (u as Promise<MixFrame | undefined>).then === "function") {
        void (u as Promise<MixFrame | undefined>).then(apply);
        return;
      }
      apply(u as MixFrame | undefined);
      return;
    }
    host.post(time);
    if (mixRef.current) paint();
  }, [host, paint]);

  useEffect(() => () => { bmpRef.current?.close?.(); bmpRef.current = undefined; }, [doc]);

  useEffect(() => {
    if (!playing) { runAt(tRef.current); return; }
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const len = Math.max(0.1, duration);
      tRef.current = (tRef.current + Math.max(0, now - last) / 1000) % len;
      last = now;
      setT(tRef.current);
      runAt(tRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, doc, runAt]);

  useEffect(() => { if (mix) runAt(tRef.current); }, [mix, runAt]);

  const scrub = (v: number) => { setPlaying(false); tRef.current = v; setT(v); runAt(v); };
  return (
    <div className="v2-ce-preview" data-testid="code-clip-preview">
      <div className={`v2-ce-stage ${transparent ? "is-transparent" : ""} ${mix ? "is-mix" : ""}`} hidden={collapsed}
        style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(var(--ce-stage-max) * ${(width / Math.max(1, height)).toFixed(4)}))`, background: transparent ? undefined : background }}>
        <iframe ref={frame} title="Live preview" sandbox={HTML_SANDBOX} srcDoc={doc} />
        {mix && <canvas ref={mixCanvas} className="v2-ce-mix" data-testid="v2-ce-mix-canvas" aria-label="Mixed preview" />}
      </div>
      <div className="v2-ce-transport">
        <button type="button" className="v2-btn v2-ce-icon" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying(!playing)}><Ic g={playing ? "❚❚" : "▶"} /></button>
        <input type="range" aria-label="Preview time" min={0} max={duration} step={0.01} value={Math.min(t, duration)} onChange={(e) => scrub(Number(e.target.value))} />
        <span className="v2-ce-time" aria-live="off">{fmtTime(t)} / {fmtTime(duration)}</span>
        {showMix && (
          <button type="button" className={`v2-btn v2-ce-icon ${mix ? "is-on" : ""}`} data-testid="v2-ce-mix"
            aria-label={mix ? "Mix on: clip composited over the clips underneath" : "Mix off: show this clip alone"}
            aria-pressed={mix}
            title="Mix: composite this clip over the clips underneath, matching export. Off shows the clip alone."
            onClick={() => setMix(!mix)}>
            <Ic g="⧓" />
          </button>
        )}
        {onToggle && <button type="button" className="v2-btn v2-ce-icon" aria-label={collapsed ? "Show preview" : "Hide preview"} aria-expanded={!collapsed} onClick={onToggle}><Ic g={collapsed ? "eye" : "eye-off"} /></button>}
      </div>
    </div>
  );
}

/** Alias kept for existing imports; both surfaces share `CodeClipPreview`. */
export const HtmlLivePreview = CodeClipPreview;
