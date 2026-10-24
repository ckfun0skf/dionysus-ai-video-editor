/**
 * V2-TL-TRANS: CapCut-style transition picker for one cut (the junction before `placementId`). Search, category tabs
 * (Saved, Popular, then the registry's categories), a None tile and a grid of tiles that each loop the transition on
 * the two clips around this cut, drawn with the same look renderer the player and export use. A tap applies the
 * transition (one undo step) and asks the host to play the cut; the duration slider, Apply to all and Save act on
 * the current choice. Mobile hosts it in a bottom sheet, desktop in the inspector.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { transitions, TICKS_PER_SECOND, type Composition, type Placement, type Track } from "../domain";
import { drawWithLook } from "../render";
import { getPreset } from "../registry";
import { drawSample } from "./EffectPicker";
import { Ic } from "./Icon";
import { SheetDone } from "./Sheet";
import { useEdgeFade } from "./useEdgeFade";

const FAV_KEY = "v2.transitions.saved";
const CYCLE_MS = 1700, HOLD_MS = 300;
const MIN_TICKS = Math.round(TICKS_PER_SECOND / 10);
export const SAVED_TAB = "Saved", POPULAR_TAB = "Popular";

export function loadSaved(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function storeSaved(ids: string[]) { try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch { /* private mode */ } }

/** The cut ending at `id`: its track, the outgoing clip and the incoming clip (undefined when `id` starts no cut). */
export function cutOf(comp: Composition, id: string): { track: Track; prev: Placement; next: Placement } | undefined {
  for (const track of comp.tracks) {
    const next = track.placements.find((p) => p.id === id);
    if (!next) continue;
    const prev = transitions.previousAdjacent(track, next);
    return prev && track.kind === "video" ? { track, prev, next } : undefined;
  }
  return undefined;
}

/** Search and tab filter (pure, for tests). Search ignores the tab and matches name, category or description. */
export function filterKinds(kinds: transitions.TransitionKind[], tab: string, query: string, saved: string[], describe: (id: string) => string = () => "") {
  const q = query.trim().toLowerCase();
  if (q) return kinds.filter((k) => `${k.label} ${k.category} ${k.id} ${describe(k.id)}`.toLowerCase().includes(q));
  if (tab === SAVED_TAB) return saved.map((id) => kinds.find((k) => k.id === id)).filter((k): k is transitions.TransitionKind => !!k);
  if (tab === POPULAR_TAB) return kinds.filter((k) => k.popular);
  return kinds.filter((k) => k.category === tab);
}

/* ---------- tile animation: one shared rAF loop for the tiles that are on screen ---------- */
type TileDraw = (now: number) => void;
const visible = new Set<TileDraw>();
let raf = 0, last = 0;
function loop(now: number) {
  raf = 0;
  if (!visible.size) return;
  if (now - last >= 32) { last = now; for (const d of visible) d(now); } // ~30 fps is plenty for thumbnails
  raf = requestAnimationFrame(loop);
}
function show(d: TileDraw) { visible.add(d); if (!raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(loop); }
function hide(d: TileDraw) { visible.delete(d); }

type Pic = HTMLImageElement | undefined;
function usePic(url: string | undefined): Pic {
  const [img, setImg] = useState<Pic>();
  useEffect(() => {
    if (!url || typeof Image === "undefined") { setImg(undefined); return; }
    const el = new Image(); let alive = true;
    el.onload = () => { if (alive) setImg(el); };
    el.src = url;
    return () => { alive = false; };
  }, [url]);
  return img;
}

/** Second sample picture (night city) so the two sides of a cut are told apart without media. */
function drawSampleB(g: CanvasRenderingContext2D, w: number, h: number) {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#1e1b4b"); sky.addColorStop(1, "#7c3aed");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = "#f8fafc"; g.beginPath(); g.arc(w * 0.25, h * 0.28, h * 0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#0f172a";
  for (let i = 0; i < 6; i += 1) { const bw = w / 6, bh = h * (0.3 + ((i * 37) % 5) / 12); g.fillRect(i * bw, h - bh, bw - 2, bh); }
  g.fillStyle = "#facc15"; for (let i = 0; i < 6; i += 1) g.fillRect(i * (w / 6) + 4, h * 0.8, 4, 4);
}

/** Cover-fit a picture (or the sample) into the tile. */
function paintPic(g: CanvasRenderingContext2D, w: number, h: number, img: Pic, fallback: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  if (!img || !img.naturalWidth) { fallback(g, w, h); return; }
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * s, ih = img.naturalHeight * s;
  g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

/** One looping tile: A holds, the transition plays, B holds. Drawn only while on screen. */
function TransitionTile({ id, label, active, a, b, onPick }: { id: string; label: string; active: boolean; a: Pic; b: Pic; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pics = useRef({ a, b }); pics.current = { a, b };
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    const kind = id === "none" ? undefined : transitions.transitionKind(id);
    const t0 = performance.now();
    const draw: TileDraw = (now) => {
      const W = c.width, H = c.height, { a: pa, b: pb } = pics.current;
      const ms = (now - t0) % CYCLE_MS, p = Math.max(0, Math.min(1, (ms - HOLD_MS) / (CYCLE_MS - 2 * HOLD_MS)));
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
      if (!kind) { (p < 0.5 ? paintPic(g, W, H, pa, drawSample) : paintPic(g, W, H, pb, drawSampleB)); return; }
      const m = kind.mix(p), look = kind.look(p);
      drawWithLook(g, W, H, look.out, (x) => { x.save(); x.globalAlpha = m.out; paintPic(x as CanvasRenderingContext2D, W, H, pa, drawSample); x.restore(); });
      drawWithLook(g, W, H, look.in, (x) => { x.save(); x.globalAlpha = m.in; paintPic(x as CanvasRenderingContext2D, W, H, pb, drawSampleB); x.restore(); });
    };
    draw(t0 + HOLD_MS + (CYCLE_MS - 2 * HOLD_MS) * 0.45); // a still mid-transition frame before the first tick
    const el = btn.current;
    if (typeof IntersectionObserver === "undefined" || !el) { show(draw); return () => hide(draw); }
    const io = new IntersectionObserver((es) => { for (const e of es) (e.isIntersecting ? show : hide)(draw); });
    io.observe(el);
    return () => { io.disconnect(); hide(draw); };
  }, [id]);
  return (
    <button ref={btn} className={`v2-ptile v2-ttile ${active ? "is-active" : ""}`} role="radio" aria-checked={active} aria-label={label} data-transition={id}
      title={id === "none" ? "No transition (a plain cut)" : `${label}: tap to apply`} onClick={onPick}>
      <canvas ref={ref} width={112} height={112} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function TransitionPicker({ engine, comp, placementId, thumbs, onPreview, onDone, onToast }: {
  engine: Engine; comp: Composition; placementId: string; thumbs: Record<string, string>;
  /** Play the cut: from about 1 s before to 1 s after the junction at `at` (ticks) with a `durationTicks` transition. */
  onPreview?: (at: number, durationTicks: number) => void;
  /** Present on mobile: renders the header ✓. */ onDone?: () => void;
  onToast?: (msg: string) => void;
}) {
  const tabsFade = useEdgeFade<HTMLDivElement>();
  const cut = cutOf(comp, placementId);
  const kinds = useMemo(() => transitions.transitionKinds(), []);
  const cats = useMemo(() => [...new Set(kinds.map((k) => k.category))], [kinds]);
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [tab, setTab] = useState<string>(POPULAR_TAB);
  const [query, setQuery] = useState("");
  const a = usePic(cut ? thumbs[cut.prev.source.assetId] : undefined);
  const b = usePic(cut ? thumbs[cut.next.source.assetId] : undefined);
  if (!cut) return <p className="v2-empty-hint">Transitions go between two clips that touch on the same video track.</p>;
  const { prev, next } = cut;
  const cur = next.transitionIn;
  const max = Math.max(MIN_TICKS, transitions.maxTransition(prev, next));
  const dur = cur ? Math.min(cur.durationTicks, max) : Math.min(transitions.DEFAULT_TRANSITION_TICKS, max);
  const list = filterKinds(kinds, tab, query, saved, (id) => getPreset("transition", id)?.description ?? "");
  const pick = (id: string) => {
    if (id === "none") { if (cur) engine.dispatch(cmd.setTransition(next.id, undefined)); onPreview?.(next.startTicks, 0); return; }
    if (cur?.kind !== id) engine.dispatch(cmd.setTransition(next.id, { kind: id, durationTicks: dur }));
    onPreview?.(next.startTicks, dur);
  };
  const isSaved = !!cur && saved.includes(cur.kind);
  const toggleSave = () => {
    if (!cur) return;
    const n = isSaved ? saved.filter((x) => x !== cur.kind) : [cur.kind, ...saved];
    setSaved(n); storeSaved(n);
  };
  const applyAll = () => {
    const cuts = transitions.cutsOnTrack(comp, next.id).length;
    if (engine.dispatch(cmd.setTransitionAll(next.id, cur ? { kind: cur.kind, durationTicks: dur } : undefined))) onToast?.(cur ? `${transitions.transitionKind(cur.kind)?.label ?? "Transition"} applied to ${cuts === 1 ? "the 1 cut" : `all ${cuts} cuts`} on this track` : `Transitions removed from ${cuts === 1 ? "the 1 cut" : `all ${cuts} cuts`}`);
  };
  const secs = (t: number) => `${(t / TICKS_PER_SECOND).toFixed(1)}s`;
  return (
    <div className="v2-anim v2-transpick">
      <div className={`v2-trans-head ${onDone ? "v2-sheet-head" : ""}`}>
        <label className="v2-trans-search"><Ic g="⤢" size={16} /><input type="search" aria-label="Search transitions" placeholder="Search transitions" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" /></label>
        {onDone && <SheetDone onClick={onDone} />}
      </div>
      {!query && <div ref={tabsFade} className="v2-tp-tabs" role="tablist" aria-label="Transition category">
        {[SAVED_TAB, POPULAR_TAB, ...cats].map((c) => (
          <button key={c} role="tab" aria-selected={c === tab} aria-label={c === SAVED_TAB ? "Saved transitions" : undefined} title={c === SAVED_TAB ? "Your saved transitions" : undefined} className={`v2-tp-tab ${c === tab ? "is-active" : ""}`} onClick={() => setTab(c)}>
            {c === SAVED_TAB ? <Ic g="bookmark" size={18} /> : c}
          </button>
        ))}
      </div>}
      <div className="v2-ptiles v2-ttiles" role="radiogroup" aria-label="Transitions">
        <TransitionTile id="none" label="None" active={!cur} a={a} b={b} onPick={() => pick("none")} />
        {list.map((k) => <TransitionTile key={k.id} id={k.id} label={k.label} active={cur?.kind === k.id} a={a} b={b} onPick={() => pick(k.id)} />)}
      </div>
      {!list.length && <p className="v2-empty-hint">{query ? "No transitions match." : tab === SAVED_TAB ? "Nothing saved yet: pick a transition, then tap Save." : "No transitions here."}</p>}
      <div className="v2-trans-controls">
        <label className="v2-tp-row" title="How long the transition takes; each clip gives at most half of itself">Duration <output>{secs(cur ? dur : 0)}</output>
          <input type="range" aria-label="Transition duration" min={MIN_TICKS} max={max} step={Math.round(TICKS_PER_SECOND / 10)} value={dur} disabled={!cur}
            onPointerDown={() => engine.beginGesture()} onPointerUp={() => { engine.endGesture(); onPreview?.(next.startTicks, dur); }} onKeyUp={() => onPreview?.(next.startTicks, dur)} onBlur={() => engine.endGesture()}
            onChange={(e) => cur && engine.dispatch(cmd.setTransition(next.id, { kind: cur.kind, durationTicks: Math.min(max, Math.max(MIN_TICKS, Number(e.target.value))) }))} />
        </label>
        <div className="v2-trans-actions">
          <button className="v2-btn v2-btn-sm" onClick={applyAll} title="Use this transition (or none) on every cut of this track">Apply to all</button>
          <button className={`v2-btn v2-btn-sm ${isSaved ? "is-active" : ""}`} aria-pressed={isSaved} disabled={!cur} onClick={toggleSave} title="Keep this transition on the Saved tab">
            <Ic g={isSaved ? "bookmarked" : "bookmark"} size={16} /> {isSaved ? "Saved" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
