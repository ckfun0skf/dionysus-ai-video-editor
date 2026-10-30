/**
 * P4C: WebMCP bridge. When the user allows agent access (off by default) and the browser exposes WebMCP
 * (`document.modelContext`, or the older `navigator.modelContext`), the storyboard tools from domain/storyAgent are
 * registered on the page. Each mutating call is validated by the importer's rules and applied as ONE undoable engine
 * step; the board re-renders live, the "AI is editing" pill shows, and the call goes into the activity log.
 * Turning access off (or closing the page) unregisters every tool.
 */
import { board, roundtrip, runtimeAiLinks, storyAgent, storyboardGuideMarkdown, type StoryDoc } from "../../domain";
import { cmd, type Engine } from "../../engine";

/** The shape of a WebMCP tool result (MCP content). */
export interface ToolResponse { content: { type: "text"; text: string }[]; isError?: boolean }
interface ToolDef {
  name: string; title?: string; description: string; inputSchema: object;
  execute: (input: Record<string, unknown>, client?: unknown) => Promise<ToolResponse>;
  annotations?: { readOnlyHint?: boolean };
}
/** Draft API: `registerTool(tool, { signal })`. Older previews returned `{ unregister }` or had `unregisterTool(name)`. */
export interface ModelContextLike {
  registerTool: (tool: ToolDef, options?: { signal?: AbortSignal }) => unknown;
  unregisterTool?: (name: string) => void;
}

export type AgentApi = "document.modelContext" | "navigator.modelContext" | "none";
/** Feature detection: the spec's `document.modelContext` first, then the deprecated `navigator.modelContext` alias. */
export function detectModelContext(): { api: AgentApi; mc?: ModelContextLike } {
  const ok = (x: unknown): x is ModelContextLike => !!x && typeof (x as ModelContextLike).registerTool === "function";
  const d = typeof document !== "undefined" ? (document as unknown as { modelContext?: unknown }).modelContext : undefined;
  if (ok(d)) return { api: "document.modelContext", mc: d };
  const n = typeof navigator !== "undefined" ? (navigator as unknown as { modelContext?: unknown }).modelContext : undefined;
  if (ok(n)) return { api: "navigator.modelContext", mc: n };
  return { api: "none" };
}

export interface AgentLogEntry { n: number; at: number; tool: string; ok: boolean; text: string; changed: boolean }
export interface AgentState { enabled: boolean; api: AgentApi; registered: number; log: AgentLogEntry[]; editing?: { tool: string; until: number }; error?: string }

const KEY = "v2.agentAccess";
const readEnabled = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
let state: AgentState = { enabled: readEnabled(), api: detectModelContext().api, registered: 0, log: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<AgentState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const agentStore = {
  get: () => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  setEnabled(on: boolean) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ } set({ enabled: on }); },
  clearLog() { set({ log: [] }); },
  /** Re-run feature detection (e.g. after an extension injected a polyfill). */
  redetect() { set({ api: detectModelContext().api }); },
  /** Tests. */
  reset() { state = { enabled: readEnabled(), api: detectModelContext().api, registered: 0, log: [] }; listeners.forEach((l) => l()); },
};

const LOG_MAX = 200, EDITING_MS = 2500;
let logN = 0, editTimer: ReturnType<typeof setTimeout> | undefined;
function log(tool: string, ok: boolean, text: string, changed: boolean) {
  const entry: AgentLogEntry = { n: ++logN, at: Date.now(), tool, ok, text: text.length > 600 ? `${text.slice(0, 600)}…` : text, changed };
  const patch: Partial<AgentState> = { log: [entry, ...state.log].slice(0, LOG_MAX) };
  if (changed) {
    patch.editing = { tool, until: Date.now() + EDITING_MS };
    clearTimeout(editTimer); editTimer = setTimeout(() => set({ editing: undefined }), EDITING_MS);
  }
  set(patch);
}

const currentDoc = (engine: Engine): StoryDoc | undefined => { const sb = engine.getState().project.storyboard; return sb ? roundtrip.storyboardToDoc(sb) : undefined; };
const guide = () => storyboardGuideMarkdown(runtimeAiLinks().site);

/** Run one tool call against the engine (also what the WebMCP `execute` callbacks do). */
export function callAgentTool(engine: Engine, name: string, args: unknown): ToolResponse {
  if (!state.enabled) return { content: [{ type: "text", text: "Agent access is off in Dionysus (Storyboard → AI agent)." }], isError: true };
  const res = storyAgent.runStoryTool(name, args, currentDoc(engine), { guide });
  let text = res.text, changed = false;
  if (res.ok && res.doc) {
    changed = engine.dispatch(cmd.mergeStoryboardDoc(res.doc), res.label);
    if (!changed) text = `No change: the storyboard already looks like that. ${text}`;
  } else if (res.ok && res.send) {
    const p = engine.getState().project, plan = board.sendPlan(p);
    const placed = plan.some((x) => x.state === "placed"), missing = plan.filter((x) => x.state === "missing").length;
    changed = engine.dispatch(placed ? cmd.updateStoryTimeline() : cmd.sendStoryToTimeline(), res.label);
    const after = board.sendPlan(engine.getState().project).filter((x) => x.state === "placed").length;
    text = changed ? `Timeline updated: ${after} shot${after === 1 ? "" : "s"} on the timeline.${missing ? ` ${missing} shot${missing === 1 ? " has" : "s have"} no clip yet (the user uploads clips in Production).` : ""}`
      : `Nothing to send: ${after ? "the timeline is up to date" : "no shot has a clip yet (the user uploads clips in Production)"}.`;
  }
  log(name, res.ok, text, changed);
  return { content: [{ type: "text", text }], ...(res.ok ? {} : { isError: true }) };
}

/** Register every tool on `mc`; the returned function unregisters them. */
export function registerAgentTools(engine: Engine, mc: ModelContextLike): () => void {
  const ac = new AbortController(), handles: unknown[] = [];
  for (const t of storyAgent.STORY_TOOLS) {
    const def: ToolDef = {
      name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
      annotations: { readOnlyHint: t.readOnly },
      execute: async (input) => callAgentTool(engine, t.name, input),
    };
    try { handles.push(mc.registerTool(def, { signal: ac.signal })); } catch (e) { set({ error: `Couldn't register ${t.name}: ${(e as Error).message}` }); }
  }
  set({ registered: handles.length });
  return () => {
    ac.abort();
    for (const [i, h] of handles.entries()) {
      try { if (h && typeof (h as { unregister?: () => void }).unregister === "function") (h as { unregister: () => void }).unregister(); else mc.unregisterTool?.(storyAgent.STORY_TOOLS[i].name); } catch { /* already gone */ }
    }
    set({ registered: 0 });
  };
}

/** Keep the tools registered exactly while access is on and WebMCP exists. Call once per engine (V2App). */
export function connectAgentBridge(engine: Engine): () => void {
  let off: (() => void) | undefined, busy = false;
  const sync = () => {
    if (busy) return;
    busy = true;
    try { step(); } finally { busy = false; }
  };
  const step = () => {
    const { api, mc } = detectModelContext();
    if (api !== state.api) set({ api });
    if (state.enabled && mc && !off) off = registerAgentTools(engine, mc);
    else if ((!state.enabled || !mc) && off) { off(); off = undefined; }
  };
  sync();
  const unsub = agentStore.subscribe(sync);
  return () => { unsub(); off?.(); off = undefined; };
}
