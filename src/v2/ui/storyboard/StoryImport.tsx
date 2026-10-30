import { useEffect, useMemo, useRef, useState } from "react";
import { exampleStoryboardJson, roundtrip, runtimeAiLinks, story, storyboardShortPrompt, storyboardSystemPrompt, type DiffItem, type Storyboard, type StoryDiff, type StoryDoc, type StoryParseResult } from "../../domain";
import { ConfirmDialog } from "../Timeline";
import { Ic } from "../Icon";
import { copyText } from "./clipboard";
import { storyAgent } from "../../domain";

function downloadJson(doc: StoryDoc, text = JSON.stringify({ ...doc, assets: doc.assets.filter((a) => !a.implicit) }, null, 2)) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${doc.meta.title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "storyboard"}.storyboard.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Blob.text() is missing on older Safari; FileReader works everywhere. */
function readFileText(f: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });
}

/** Copy button that confirms for 2 s. */
export function CopyButton({ text, label, primary, testId }: { text: () => string; label: string; primary?: boolean; testId?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  useEffect(() => { if (state === "idle") return; const t = setTimeout(() => setState("idle"), 2000); return () => clearTimeout(t); }, [state]);
  return (
    <button className={`v2-btn v2-sb-btn ${primary ? "primary" : ""}`} data-testid={testId} title={`${label} to the clipboard`} onClick={() => void copyText(text()).then((ok) => setState(ok ? "ok" : "fail"))}>
      <Ic g={state === "ok" ? "✓" : "⎘"} size={16} /> {state === "ok" ? "Copied" : state === "fail" ? "Copy failed — select the text" : label}
    </button>
  );
}

/**
 * Step 1: the prompt for the user's own AI (no AI calls from the app). "Short" links to the published guide; "Full"
 * inlines it for AIs that can't open links (V2-SB-114).
 */
export function PromptPanel() {
  const [kind, setKind] = useState<"short" | "full">("short");
  // Links follow the deployment the app runs on (V2-OPS-LINKS), not a hard-coded host.
  const links = useMemo(runtimeAiLinks, []);
  const short = useMemo(() => storyboardShortPrompt(links), [links]);
  const full = useMemo(storyboardSystemPrompt, []);
  const prompt = kind === "short" ? short : full;
  return (
    <section className="v2-sb-panel" aria-label="AI prompt">
      <p className="v2-sb-lead">Paste this into the chat where you agreed the story (ChatGPT, Gemini, Claude, Grok…). It makes the AI reply with a storyboard JSON that Dionysus can import.</p>
      <div className="v2-sb-seg" role="radiogroup" aria-label="Prompt length">
        <button role="radio" aria-checked={kind === "short"} className={kind === "short" ? "on" : ""} data-testid="prompt-short" onClick={() => setKind("short")}><b>Short prompt</b><em>Links to the Dionysus guide</em></button>
        <button role="radio" aria-checked={kind === "full"} className={kind === "full" ? "on" : ""} data-testid="prompt-full" onClick={() => setKind("full")}><b>Full prompt</b><em>Everything inline, for AIs that can't open links</em></button>
      </div>
      <div className="v2-sb-actions">
        <CopyButton key={kind} text={() => prompt} label={kind === "short" ? "Copy AI prompt" : "Copy full prompt"} primary testId="copy-prompt" />
        <CopyButton text={() => exampleStoryboardJson()} label="Copy example JSON" />
        <a className="v2-btn v2-sb-btn" href={links.guideHtml} target="_blank" rel="noopener noreferrer" title="Open the storyboard guide the short prompt links to"><Ic g="link" size={16} /> Open guide</a>
      </div>
      <textarea className="v2-sb-code" aria-label="AI system prompt" readOnly value={prompt} rows={14} onFocus={(e) => e.currentTarget.select()} />
      {kind === "short" && <p className="v2-hint">If your AI says it can't open the link, choose Full prompt and paste that instead.</p>}
    </section>
  );
}

/** Step 2: paste or choose a file, validate live, preview, then create. */
/** P4C: `base` is the current board; JSON that is one part of a storyboard ("part", or no "meta") is merged into it by id. */
export function ImportPanel({ onCreate, replacing, diffFor, onMerge, base }: { onCreate?: (doc: StoryDoc) => void; replacing?: boolean; diffFor?: (doc: StoryDoc) => StoryDiff; onMerge?: (doc: StoryDoc, diff: StoryDiff) => void; base?: StoryDoc }) {
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState<"merge" | "replace">();
  const [file, setFile] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  /** V2-SB-R14: an error jumps to (selects) the part of the JSON it is about. */
  const jump = (r?: { start: number; end: number }) => {
    const ta = area.current;
    if (!ta || !r) return;
    ta.focus();
    ta.setSelectionRange(r.start, Math.max(r.start, r.end));
    const line = text.slice(0, r.start).split("\n").length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (line - 2) * lh);
  };
  const part = useMemo(() => (text.trim() ? storyAgent.parseStoryPart(text, base) : undefined), [text, base]);
  const result = useMemo((): StoryParseResult | undefined => {
    if (!text.trim()) return undefined;
    if (part) return part.result;
    if (!base && looksLikePart(text)) return { ok: false, warnings: [], errors: [{ path: "", message: 'This JSON is one part of a storyboard (it has "part", or no "meta"). Import the first part, the one with "meta" and the assets, first; then import this part to add its shots.' }] };
    return story.parseStoryboard(text);
  }, [text, part, base]);
  // Paths in a merged part point into the merged board, not the pasted text, so they aren't linked.
  const locs = useMemo(() => (result && !part ? (result.ok ? result.warnings : result.errors).map((e) => story.locateIssue(text, e)) : []), [result, text, part]);
  const diff = useMemo(() => (result?.ok && diffFor ? diffFor(result.doc) : undefined), [result, diffFor]);
  const pick = async (f?: File) => { if (!f) return; setFile(f.name); setText(await readFileText(f)); };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) { setFile(undefined); setText(t); } } catch { /* permission denied: user can long-press paste */ } };
  return (
    <section className="v2-sb-panel" aria-label="Import storyboard JSON">
      <div className="v2-sb-actions">
        <button className="v2-btn v2-sb-btn" title="Paste the AI's reply from the clipboard" onClick={() => void paste()}><Ic g="📋" size={16} /> Paste</button>
        <button className="v2-btn v2-sb-btn" title="Import a .json file" onClick={() => input.current?.click()}><Ic g="json" size={16} /> Choose file</button>
        <input ref={input} type="file" accept=".json,application/json,.txt,text/plain" hidden aria-label="Storyboard JSON file" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
        {!text && <button className="v2-btn v2-sb-btn" title="Fill in the example storyboard to see how import works" onClick={() => { setFile(undefined); setText(exampleStoryboardJson()); }}><Ic g="board" size={16} /> Load example</button>}
        {text && <button className="v2-btn v2-sb-btn" title="Clear" onClick={() => { setText(""); setFile(undefined); }}><Ic g="✕" size={16} /> Clear</button>}
      </div>
      <textarea ref={area} className="v2-sb-code" aria-label="Storyboard JSON" placeholder={'Paste the AI\'s reply here — the whole message is fine, Dionysus finds the JSON.\n\n{ "format": "dionysus.storyboard/1", … }'} value={text} rows={10} spellCheck={false} onChange={(e) => { setFile(undefined); setText(e.target.value); }} />
      {file && <p className="v2-hint">From {file}</p>}
      {result && !result.ok && (
        <div className="v2-sb-errors" role="alert" data-testid="story-errors">
          <h4><Ic g="alert" size={16} /> {result.errors.length} problem{result.errors.length === 1 ? "" : "s"} to fix</h4>
          <p className="v2-hint">Tap a problem to select it in the JSON and fix it here, or copy the list back to your AI and ask it to correct the JSON.</p>
          <ul>{result.errors.map((e, i) => {
            const body = <>{e.path && <code>{e.path}</code>} {e.message}</>;
            return <li key={i}>{locs[i] ? <button className="v2-sb-errlink" title="Select this in the JSON" onClick={() => jump(locs[i])}>{body}</button> : body}</li>;
          })}</ul>
          <CopyButton text={() => `Please fix these problems in the storyboard JSON and reply with the full corrected JSON only:\n${result.errors.map((e) => `- ${e.path ? e.path + ": " : ""}${e.message}`).join("\n")}`} label="Copy fix-up request" />
        </div>
      )}
      {result?.ok && (
        <div className="v2-sb-preview" data-testid="story-preview">
          <h4><Ic g="ok" size={16} /> {result.doc.meta.title}</h4>
          {part?.counts && <p className="v2-sb-part" data-testid="story-part">Storyboard part{partLabel(text)}: {partText(part.counts)}, merged into the current board by id. Below is the whole board after the merge.</p>}
          <p className="v2-sb-sum">{story.storySummary(result.doc)}</p>
          {result.warnings.length > 0 && <ul className="v2-sb-warn" data-testid="story-warnings">{result.warnings.map((w, i) => {
            const body = <>{w.path && <code>{w.path}</code>} {w.message}</>;
            return <li key={i}><Ic g="⚠" size={14} /> {locs[i] ? <button className="v2-sb-errlink" title="Select this in the JSON" onClick={() => jump(locs[i])}>{body}</button> : body}</li>;
          })}</ul>}
          <ol className="v2-sb-shotlist">
            {result.doc.shots.map((s) => (
              <li key={s.id}><b>{s.title}</b> <span className="v2-muted">{s.durationSec}s · {s.assets.length} asset{s.assets.length === 1 ? "" : "s"}</span>
                {s.assets.some((a) => result.doc.assets.find((x) => x.id === a)?.source.type === "lastFrame") && <span className="v2-sb-tag"><Ic g="link" size={12} /> last frame</span>}</li>
            ))}
          </ol>
          <div className="v2-sb-actions v2-sb-preview-actions">
            <button className="v2-btn v2-sb-btn" title="Save the checked, normalised storyboard as a .json file" onClick={() => downloadJson(result.doc)}><Ic g="⇩" size={16} /> Download .json</button>
          </div>
          {diff && onMerge ? <>
            <MergePreview diff={diff} />
            <div className="v2-sb-actions v2-sb-merge-actions">
              <button className="v2-btn primary v2-sb-btn" data-testid="merge-apply" disabled={diff.same} onClick={() => (diff.assets.removed.length || diff.shots.removed.length ? setConfirm("merge") : onMerge(result.doc, diff))}><Ic g="ok" size={16} /> {diff.same ? "No changes" : "Apply changes"}</button>
              {onCreate && !part && <button className="v2-btn v2-sb-btn v2-sb-danger" title="Start over from this JSON: drops every upload, pick and check on the board" onClick={() => setConfirm("replace")}><Ic g="json" size={16} /> Replace instead…</button>}
            </div>
            <p className="v2-hint">Apply keeps uploads, version picks, trims and checks for every asset and shot whose id is unchanged. Undo reverts it.</p>
          </> : <>
            {onCreate && <button className="v2-btn primary v2-sb-btn" onClick={() => onCreate(result.doc)}>{replacing ? "Replace storyboard" : "Create storyboard"}</button>}
            {replacing && <p className="v2-hint">Replacing keeps nothing from the current storyboard; Undo brings it back.</p>}
          </>}
        </div>
      )}
      {confirm === "merge" && result?.ok && diff && onMerge && <ConfirmDialog title="Remove from the storyboard?" confirm="Apply changes"
        message={`${removedText(diff)} ${diff.assets.removed.length + diff.shots.removed.length > 1 ? "are" : "is"} not in the new JSON and will be removed. Uploaded versions stay in the media library. Undo brings everything back.`}
        onCancel={() => setConfirm(undefined)} onConfirm={() => { setConfirm(undefined); onMerge(result.doc, diff); }} />}
      {confirm === "replace" && result?.ok && onCreate && <ConfirmDialog title="Replace the whole storyboard?" confirm="Replace"
        message="Every shot, asset, version pick and check is replaced by this JSON; nothing is matched by id. Undo brings the current one back."
        onCancel={() => setConfirm(undefined)} onConfirm={() => { setConfirm(undefined); onCreate(result.doc); }} />}
    </section>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
function looksLikePart(text: string): boolean { try { return storyAgent.isStoryPart(JSON.parse(story.extractJson(text))); } catch { return false; } }
function partLabel(text: string): string {
  try { const p = (JSON.parse(story.extractJson(text)) as { part?: { index?: unknown; of?: unknown } }).part; return typeof p?.index === "number" ? ` ${p.index}${typeof p.of === "number" ? ` of ${p.of}` : ""}` : ""; } catch { return ""; }
}
function partText(c: { shots: number; assets: number; audio: number; connections: number; removed: number }): string {
  return [c.shots && plural(c.shots, "shot"), c.assets && plural(c.assets, "asset"), c.audio && plural(c.audio, "audio cue"), c.connections && plural(c.connections, "connection"), c.removed && `${c.removed} removed`].filter(Boolean).join(", ") || "nothing";
}
function removedText(d: StoryDiff): string {
  const parts = [d.shots.removed.length && plural(d.shots.removed.length, "shot"), d.assets.removed.length && plural(d.assets.removed.length, "asset")].filter(Boolean);
  return parts.join(" and ");
}
const FIELD_NAMES: Record<string, string> = { meta: "title and settings", order: "shot order", connections: "connections", audio: "audio cues" };

/** P2A: what a re-import adds, changes and removes, by id (the confirm step before Apply). */
export function MergePreview({ diff }: { diff: StoryDiff }) {
  if (diff.same) return <p className="v2-sb-sum" data-testid="merge-same">Same as the current storyboard: nothing to apply.</p>;
  const group = (kind: "added" | "changed" | "removed", label: string, g: string) => {
    const items: (DiffItem & { what: string })[] = [...diff.shots[kind].map((x) => ({ ...x, what: "Shot" })), ...diff.assets[kind].map((x) => ({ ...x, what: "Asset" }))];
    if (!items.length) return null;
    return (
      <div className={`v2-sb-diff v2-sb-diff-${kind}`} data-testid={`merge-${kind}`}>
        <h5><Ic g={g} size={14} /> {label} · {items.length}</h5>
        <ul>{items.map((x) => (
          <li key={`${x.what}:${x.id}`}><span className="v2-sb-diff-kind">{x.what}</span> <b>{x.name}</b> <code>{x.id}</code>
            {x.fields && <span className="v2-muted"> · {x.fields.join(", ")}</span>}
            {!!x.uploads && <span className="v2-muted"> · {plural(x.uploads, "upload")} stay in the library</span>}</li>
        ))}</ul>
      </div>
    );
  };
  return (
    <div className="v2-sb-merge" data-testid="merge-preview" aria-label="Changes to apply">
      <h4><Ic g="board" size={16} /> Changes to the current storyboard</h4>
      {group("added", "New", "+")}
      {group("changed", "Changed", "✎")}
      {group("removed", "Removed", "✕")}
      {diff.other.length > 0 && <p className="v2-sb-sum">Also updated: {diff.other.map((k) => FIELD_NAMES[k] ?? k).join(", ")}.</p>}
    </div>
  );
}

/** P2A: the current board (with every edit) as storyboard JSON, to download or copy back to the AI. */
export function ExportPanel({ board }: { board: Storyboard }) {
  const doc = useMemo(() => roundtrip.storyboardToDoc(board), [board]);
  const text = useMemo(() => story.storyDocJson(doc), [doc]);
  return (
    <section className="v2-sb-panel" aria-label="Export storyboard JSON">
      <p className="v2-sb-lead">This is your storyboard as it is now, edits included, in the same JSON format your AI writes. Give it back to your AI to revise, then import its reply here: assets and shots that keep their ids keep their uploads, picks and checks.</p>
      <div className="v2-sb-actions v2-sb-export-actions">
        <button className="v2-btn primary v2-sb-btn" data-testid="export-download" title="Save the storyboard as a .json file" onClick={() => downloadJson(doc, text)}><Ic g="⇩" size={16} /> Download .json</button>
        <CopyButton text={() => text} label="Copy JSON" testId="export-copy" />
      </div>
      <p className="v2-sb-sum">{story.storySummary(doc)}</p>
      <textarea className="v2-sb-code" aria-label="Storyboard JSON export" readOnly value={text} rows={14} onFocus={(e) => e.currentTarget.select()} />
      <p className="v2-hint">Uploaded versions, picks and checks stay in Dionysus; they are not part of the JSON.</p>
    </section>
  );
}
