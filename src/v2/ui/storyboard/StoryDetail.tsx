import { useEffect, useRef, useState, type ReactNode } from "react";
import { board, type AssetSlot, type MediaKind, type Project, type Shot } from "../../domain";
import { cmd, type Command, type Engine } from "../../engine";
import { importFile } from "../../persistence";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { Sheet } from "../Sheet";
import { type BoardTarget, LengthWarn, Thumb, TYPE_ICON, Warn } from "./BoardView";
import { extractLastFrame } from "./lastFrame";
import { CopyButton } from "./StoryImport";

const ACCEPT: Partial<Record<MediaKind, string>> = { image: "image/*", video: "video/*", audio: "audio/*" };
const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

/** Details for one shot or asset slot: versions (pick one), upload, prompt to copy, last-frame extraction. */
export function StoryDetail({ project, target, thumbs, engine, blobs, mobile, onClose, onOpen, inline, head }: {
  project: Project; target: BoardTarget; thumbs: Record<string, string>; engine: Engine; blobs: BlobStore; mobile: boolean;
  onClose: () => void; onOpen: (t: BoardTarget) => void;
  /** Production wizard: render in place (no sheet / side panel) under `head`. */
  inline?: boolean; head?: ReactNode;
}) {
  const b = project.storyboard!;
  const isSlot = "slot" in target;
  const owner: AssetSlot | Shot | undefined = isSlot ? b.slots[target.slot] : b.shots[target.shot];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [model, setModel] = useState("");
  const [swapNote, setSwapNote] = useState<string>();
  useEffect(() => { if (!swapNote) return; const t = setTimeout(() => setSwapNote(undefined), 6000); return () => clearTimeout(t); }, [swapNote]);
  if (!owner) return null;
  const shotNo = (id: string) => b.order.indexOf(id) + 1;
  const slot = isSlot ? (owner as AssetSlot) : undefined;
  const shot = isSlot ? undefined : (owner as Shot);
  const kind: MediaKind = slot ? board.kindForSlot(slot.type) : "video";
  const versions = board.versionsOf(project, owner);
  const selected = board.selectedOf(project, owner);
  const status = board.storyStatus(project);
  const st = isSlot ? status.slots[owner.id] : status.shots[owner.id];
  const title = slot ? slot.name : `Shot ${shotNo(owner.id)} · ${shot!.title}`;
  const icon = slot ? TYPE_ICON[slot.type] ?? "image" : "▭";
  const lf = slot?.source.type === "lastFrame" ? slot.source.shotId : undefined;
  const lfShot = lf ? b.shots[lf] : undefined;
  const lfVersion = lfShot ? board.selectedOf(project, lfShot) : undefined;

  /** Change the version in use; when linked timeline clips change length, say so (V2-SB-R01). */
  const swap = (c: Command) => {
    const before = engine.getState().project;
    engine.dispatch(c);
    const after = engine.getState().project;
    const nb = after.storyboard, o = nb && (isSlot ? nb.slots[owner.id] : nb.shots[owner.id]);
    const changes = o?.assetId ? board.linkedLengthChanges(before, after, o.assetId) : [];
    if (!changes.length || !o?.assetId) return;
    const a = after.assets[o.assetId];
    const vNo = a.versions.findIndex((v) => v.id === a.selectedVersionId) + 1;
    const sec = (t: number) => `${Math.round(t / 12_000) / 10} s`;
    const { fromTicks, toTicks } = changes[0];
    setSwapNote(`${shot ? `Shot ${shotNo(owner.id)}` : slot!.name} on timeline updated to v${vNo} (${sec(toTicks)}, was ${sec(fromTicks)})${changes.length > 1 ? ` · ${changes.length} clips` : ""}`);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setErr(undefined); setBusy(label);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(undefined); }
  };
  const upload = (f: File) => run("Adding…", async () => {
    const a = await importFile(f, blobs);
    if (!a) throw new Error("That file type isn't supported.");
    const media = a.versions[0].media;
    if (a.kind !== kind) { await blobs.delete(media.blobKey).catch(() => undefined); throw new Error(`This needs ${kind === "image" ? "an image" : `a ${kind} file`}, but “${f.name}” is ${a.kind === "image" ? "an image" : `a ${a.kind} file`}.`); }
    swap(cmd.addStoryVersion(target, media, model.trim() ? { model: model.trim() } : {}));
  });
  const useLastFrame = () => run("Taking the last frame…", async () => {
    const v = lfShot && board.versionsOf(project, lfShot).find((x) => x.id === lfVersion);
    if (!v || !lf) throw new Error("Shot has no clip yet.");
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The clip's file is missing from this device.");
    const fr = await extractLastFrame(blob);
    const key = `lastframe/${owner.id}/${v.id}/${Date.now()}`;
    await blobs.put(key, fr.blob);
    engine.dispatch(cmd.addStoryVersion(target, { blobKey: key, mime: "image/png", width: fr.width, height: fr.height }, { derivedFrom: { shotId: lf, versionId: v.id } }));
  });

  const body = (
    <div className="v2-sb-detail-body">
      {head}
      {(inline || !mobile) && <div className="v2-sb-detail-head"><Ic g={icon} size={18} /><h3>{title}</h3>{!inline && <button className="v2-icon v2-sb-icon" aria-label="Close details" title="Close (Esc)" onClick={onClose}><Ic g="✕" size={18} /></button>}</div>}
      {shot && <p className="v2-sb-detail-desc">{shot.durationSec}s · {shot.description}</p>}
      {st?.stale && <div className="v2-sb-warnbox" role="note"><Warn st={st} /><ul>{st.reasons.map((r) => <li key={r}>{r}</li>)}</ul><p>Upload a new version made with the current assets, or keep this one if it still looks right.</p></div>}

      <Section title={versions.length ? `Versions (${versions.length})` : "Versions"}>
        {versions.length ? (
          <ul className="v2-sb-versions" aria-label="Versions">
            {versions.map((v, i) => {
              const on = v.id === selected;
              const info = b.versions[v.id];
              return (
                <li key={v.id}>
                  <button className={`v2-sb-version ${on ? "on" : ""}`} aria-pressed={on} title={on ? "In use" : "Use this version"}
                    onClick={() => { if (!on && owner.assetId) swap(cmd.selectStoryVersion(owner.assetId, v.id)); }}>
                    <Thumb src={thumbs[v.id]} icon={icon} count={0} />
                    <span><b>v{i + 1}{on && <Ic g="ok" size={13} />}</b><em>{info?.derivedFrom ? `Frame of shot ${shotNo(info.derivedFrom.shotId)}` : fmtDate(v.createdAt)}</em>{info?.model && <em title="Made with">{info.model}</em>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="v2-hint">{lf ? `Nothing yet. Use the last frame of shot ${shotNo(lf)} once it has a clip, or upload an image.` : `Nothing yet. ${slot?.source.type === "upload" ? "Upload your file" : "Generate it in your AI tool with the prompt below"}, then add it here.`}</p>}
        {shot && board.shotLengthMismatch(project, shot) && <p className="v2-sb-lenline"><LengthWarn project={project} shot={shot} /></p>}
        <div className="v2-sb-actions">
          {lf && (
            <button className="v2-btn primary v2-sb-btn" disabled={!lfVersion || !!busy} onClick={useLastFrame} title={lfVersion ? "Grab the final frame of the selected clip" : `Shot ${shotNo(lf)} needs a clip first`}>
              <Ic g="link" size={16} /> Use last frame of shot {shotNo(lf)}
            </button>
          )}
          {!lf && <input className="v2-sb-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Made with (optional), e.g. Veo 3" aria-label="AI tool or model used (saved with the upload)" maxLength={60} />}
          <button className={`v2-btn v2-sb-btn ${lf ? "" : "primary"}`} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Ic g="⇪" size={16} /> {versions.length ? "Upload new version" : shot ? "Upload clip" : "Upload"}
          </button>
          <input ref={fileRef} type="file" hidden accept={ACCEPT[kind]} aria-label={`Upload ${kind} for ${title}`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </div>
        {lf && !lfVersion && <p className="v2-hint">Shot {shotNo(lf)} needs a clip first. <button className="v2-linkbtn" onClick={() => onOpen({ shot: lf })}>Open shot {shotNo(lf)}</button></p>}
        {swapNote && <p className="v2-sb-swapnote" role="status"><Ic g="to-timeline" size={14} /> {swapNote}</p>}
        {busy && <p className="v2-hint" role="status">{busy}</p>}
        {err && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> {err}</p>}
      </Section>

      {owner.prompt && (
        <Section title={shot ? "Clip prompt" : "Prompt"} extra={<CopyButton text={() => owner.prompt} label="Copy prompt" />}>
          <p className="v2-sb-prompt">{owner.prompt}</p>
        </Section>
      )}
      {shot && (shot.camera || shot.dialogue) && <Section title="Direction">{shot.camera && <p className="v2-sb-kv"><b>Camera</b> {shot.camera}</p>}{shot.dialogue && <p className="v2-sb-kv"><b>Dialogue</b> {shot.dialogue}</p>}</Section>}
      {shot && shot.slotIds.length > 0 && <Section title="Assets in this shot"><Chips ids={shot.slotIds} project={project} thumbs={thumbs} onOpen={onOpen} /></Section>}
      {slot && slot.references.length > 0 && <Section title="Made using"><Chips ids={slot.references} project={project} thumbs={thumbs} onOpen={onOpen} /></Section>}
      {slot && <UsedIn slot={slot} project={project} onOpen={onOpen} />}
      {owner.qa.length > 0 && <Checks owner={owner} selected={selected} project={project} engine={engine} />}
      <div className="v2-sb-actions">
        <button className="v2-btn v2-sb-btn" aria-pressed={!!owner.skipped} title={owner.skipped ? "Put this back on the production list" : "Not needed — leave it off the production list"} onClick={() => engine.dispatch(cmd.setStorySkipped(target, !owner.skipped))}>
          <Ic g={owner.skipped ? "↶" : "skip"} size={16} /> {owner.skipped ? "Include again" : "Skip this"}
        </button>
      </div>
      {slot?.notes && <Section title="Notes"><p className="v2-sb-prompt">{slot.notes}</p></Section>}
    </div>
  );
  if (inline) return <section className="v2-sb-inline" aria-label={title}>{body}</section>;
  return mobile
    ? <Sheet label={title} onClose={onClose} className="v2-sb-sheet" initial={2}>{body}</Sheet>
    : <aside className="v2-sb-detail" role="dialog" aria-label={title}>{body}</aside>;
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return <section className="v2-sb-sec"><div className="v2-sb-sec-head"><h4>{title}</h4>{extra}</div>{children}</section>;
}

function Chips({ ids, project, thumbs, onOpen }: { ids: string[]; project: Project; thumbs: Record<string, string>; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  return (
    <ul className="v2-sb-slots">
      {ids.map((id) => b.slots[id]).filter(Boolean).map((s) => {
        const v = board.selectedOf(project, s);
        return <li key={s.id}><button className="v2-sb-slot" onClick={() => onOpen({ slot: s.id })}><Thumb src={v && thumbs[v]} icon={TYPE_ICON[s.type] ?? "image"} count={0} /><span className="v2-sb-slot-text"><b>{s.name}</b><em>{board.versionsOf(project, s).length ? `${board.versionsOf(project, s).length} version${board.versionsOf(project, s).length > 1 ? "s" : ""}` : "Not added yet"}</em></span></button></li>;
      })}
    </ul>
  );
}

function UsedIn({ slot, project, onOpen }: { slot: AssetSlot; project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const shots = b.order.filter((id) => b.shots[id]?.slotIds.includes(slot.id));
  if (!shots.length) return null;
  return <Section title="Used in"><div className="v2-sb-actions">{shots.map((id) => <button key={id} className="v2-btn v2-sb-btn" onClick={() => onOpen({ shot: id })}><Ic g="▭" size={14} /> Shot {b.order.indexOf(id) + 1}</button>)}</div></Section>;
}

/** QA checklist for the version in use: pass / fail per check, saved with that version (V2-CUT-10). */
function Checks({ owner, selected, project, engine }: { owner: AssetSlot | Shot; selected?: string; project: Project; engine: Engine }) {
  const res = (selected && project.storyboard!.versions[selected]?.qa) || {};
  const done = owner.qa.filter((q) => res[q.id] === "pass").length;
  return (
    <Section title={selected ? `Checks · ${done}/${owner.qa.length} passed` : "Checks"}>
      {!selected && <p className="v2-hint">Upload a version, then tick these off.</p>}
      <ul className="v2-sb-qa">
        {owner.qa.map((q) => {
          const r = res[q.id];
          const set = (v: "pass" | "fail") => selected && engine.dispatch(cmd.setQaResult(selected, q.id, r === v ? undefined : v));
          return (
            <li key={q.id} className={r ?? ""}>
              <span className="v2-sb-qa-text"><Ic g={r === "pass" ? "ok" : r === "fail" ? "alert" : "☑"} size={14} /> {q.text}</span>
              {selected && <span className="v2-sb-qa-btns" role="group" aria-label={`Check: ${q.text}`}>
                <button className={`v2-sb-qa-btn ${r === "pass" ? "on" : ""}`} aria-pressed={r === "pass"} title="Looks right" onClick={() => set("pass")}>Pass</button>
                <button className={`v2-sb-qa-btn fail ${r === "fail" ? "on" : ""}`} aria-pressed={r === "fail"} title="Needs another version" onClick={() => set("fail")}>Fail</button>
              </span>}
            </li>
          );
        })}
      </ul>
      {owner.qa.some((q) => res[q.id] === "fail") && <p className="v2-hint">Failed? Generate it again and upload it as a new version — the old one stays here.</p>}
    </Section>
  );
}
