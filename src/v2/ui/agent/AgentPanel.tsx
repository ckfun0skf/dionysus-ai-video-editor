/** P4C: "AI agent" (WebMCP) panel in the storyboard, and the app-wide "AI is editing" pill. */
import { useEffect, useSyncExternalStore } from "react";
import { storyAgent } from "../../domain";
import type { Engine } from "../../engine";
import { Ic } from "../Icon";
import { agentStore, type AgentState } from "./webMcp";
import "./agent.css";

export const useAgentState = (): AgentState => useSyncExternalStore(agentStore.subscribe, agentStore.get);

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function AgentPanel() {
  const s = useAgentState();
  useEffect(() => { agentStore.redetect(); }, []);
  const native = s.api !== "none";
  return (
    <section className="v2-sb-panel v2-agent" aria-label="AI agent access">
      <p className="v2-sb-lead">Let an AI agent in this browser build the storyboard step by step through WebMCP tools: add and change assets, shots, layers and audio cues, check the board and update the timeline. Every change is checked by the same rules as Import, shows here live and can be undone.</p>
      <label className="v2-agent-toggle">
        <input type="checkbox" role="switch" data-testid="agent-toggle" checked={s.enabled} onChange={(e) => agentStore.setEnabled(e.target.checked)} />
        <span><b>Allow AI agent access</b><em>{s.enabled ? (native ? `On · ${s.registered} tools available to agents on this page` : "On · waiting for a browser with WebMCP") : "Off · agents can't see or change this project"}</em></span>
      </label>
      <p className={`v2-agent-status ${native ? "is-ok" : "is-none"}`} data-testid="agent-api">
        <Ic g={native ? "ok" : "alert"} size={16} />
        {native ? <span>WebMCP found ({s.api}).</span>
          : <span>This browser doesn't offer WebMCP yet. It is an early preview: desktop Chrome or Edge with <code>chrome://flags/#enable-webmcp-testing</code> turned on, plus an agent extension such as the Model Context Tool Inspector. Safari, Firefox and iPhone browsers don't support it. Without it, use the AI prompt and import JSON in parts.</span>}
      </p>
      {s.error && <p className="v2-hint v2-agent-err">{s.error}</p>}
      <details className="v2-agent-tools">
        <summary>{storyAgent.STORY_TOOLS.length} tools</summary>
        <ul>{storyAgent.STORY_TOOLS.map((t) => <li key={t.name}><code>{t.name}</code> {t.readOnly && <span className="v2-muted">read-only</span>} <span>{t.description}</span></li>)}</ul>
      </details>
      <div className="v2-agent-loghead">
        <h4>Activity</h4>
        <button className="v2-btn v2-sb-btn v2-agent-clear" data-testid="agent-clear" disabled={!s.log.length} onClick={() => agentStore.clearLog()}>Clear</button>
      </div>
      {s.log.length ? (
        <ol className="v2-agent-log" data-testid="agent-log" aria-live="polite">
          {s.log.map((e) => (
            <li key={e.n} className={e.ok ? (e.changed ? "is-change" : "is-read") : "is-error"}>
              <span className="v2-agent-when">{time(e.at)}</span> <code>{e.tool}</code> <span className="v2-agent-res">{e.ok ? (e.changed ? "changed" : "ok") : "rejected"}</span>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      ) : <p className="v2-hint" data-testid="agent-log-empty">No agent calls yet.</p>}
    </section>
  );
}

/** Shown while an agent edits (a few seconds after each change), anywhere in the app. */
export function AgentIndicator({ engine }: { engine: Engine }) {
  const s = useAgentState();
  if (!s.enabled || !s.editing) return null;
  return (
    <div className="v2-agent-pill" role="status" data-testid="agent-editing">
      <span className="v2-agent-dot" aria-hidden="true" />
      <span>AI is editing · <code>{s.editing.tool}</code></span>
      <button className="v2-agent-pill-btn" onClick={() => engine.undo()}>Undo</button>
      <button className="v2-agent-pill-btn" title="Turn agent access off" onClick={() => agentStore.setEnabled(false)}>Stop</button>
    </div>
  );
}
