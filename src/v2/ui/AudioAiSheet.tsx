/**
 * P36 Audio → "Create with AI": describe the sound, copy a prompt for any AI chat (dionysus.audioclip/1 format), paste
 * its JSON reply, preview-check it and add it to the timeline at the playhead (rendered to WAV; one undo step).
 */
import { useState } from "react";
import { audioClipPrompt, runtimeAiLinks, type AudioClip } from "../domain";
import { AudioClipImport } from "./AudioEditor";
import { Ic } from "./Icon";

export function AudioAiSheet({ onAdd, onClose }: { onAdd: (clip: AudioClip) => Promise<void> | void; onClose: () => void }) {
  const [step, setStep] = useState<"describe" | "paste">("describe");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [len, setLen] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const sec = Number(len);
  const prompt = () => audioClipPrompt({ name: name.trim() || "Sound", brief: brief.trim(), durationSec: sec > 0 ? sec : undefined, specUrl: runtimeAiLinks().audioClipSpec });
  const copy = async () => { try { await navigator.clipboard.writeText(prompt()); } catch { /* the prompt is shown below to copy by hand */ } setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="v2-subimport v2-audioai" role="dialog" aria-label="Create audio with AI" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header className="v2-subimport-head">
        <button className="v2-icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={onClose}><Ic g="✕" /></button>
        <h3>Create audio with AI</h3>
        <span />
      </header>
      <ol className="v2-pi-steps" aria-label="Steps"><li className={step === "describe" ? "on" : "done"}>1. Describe & copy</li><li className={step === "paste" ? "on" : ""}>2. Paste</li></ol>
      {step === "describe" ? <>
        <label className="v2-sb-field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rain on the window" maxLength={60} /></label>
        <label className="v2-sb-field">What should it sound like?<textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Mood, instruments or sounds, tempo…" maxLength={800} /></label>
        <label className="v2-sb-field">Length (seconds, optional)<input inputMode="decimal" value={len} onChange={(e) => setLen(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 8" /></label>
        <div className="v2-subimport-foot">
          <span className="v2-muted">Your AI replies with a dionysus.audioclip/1 JSON block.</span>
          <button className="v2-btn" disabled={!brief.trim()} onClick={() => void copy()}><Ic g="⎘" size={16} /> {copied ? "Copied" : "Copy prompt"}</button>
          <button className="v2-btn primary" disabled={!brief.trim()} onClick={() => setStep("paste")}>Paste answer</button>
        </div>
      </> : <>
        <AudioClipImport busy={busy} label="Add to timeline" onAdd={async (c) => { setBusy(true); try { await onAdd({ ...c, name: c.name || name.trim() || "Audio clip" }); } finally { setBusy(false); } }} />
        <div className="v2-subimport-foot"><button className="v2-btn" onClick={() => setStep("describe")}>Back</button></div>
      </>}
    </div>
  );
}
