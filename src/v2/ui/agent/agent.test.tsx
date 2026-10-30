// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProject, EXAMPLE_STORYBOARD, story, roundtrip, type StoryDoc } from "../../domain";
import { cmd, Engine } from "../../engine";
import { storyAgent } from "../../domain";
import { agentStore, callAgentTool, connectAgentBridge, type ToolResponse } from "./webMcp";
import { AgentIndicator, AgentPanel } from "./AgentPanel";
import { ImportPanel } from "../storyboard/StoryImport";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
type Def = { name: string; inputSchema: unknown; execute: (a: unknown) => Promise<ToolResponse> };
let registered: Map<string, Def>, aborted: number;
function fakeModelContext() {
  registered = new Map(); aborted = 0;
  (document as unknown as { modelContext: unknown }).modelContext = {
    registerTool(t: Def, o?: { signal?: AbortSignal }) { registered.set(t.name, t); o?.signal?.addEventListener("abort", () => { registered.delete(t.name); aborted++; }); },
  };
}
beforeEach(() => { localStorage.clear(); delete (document as unknown as { modelContext?: unknown }).modelContext; agentStore.reset(); });
afterEach(() => { document.body.innerHTML = ""; });

const doc = (() => { const r = story.validateStoryboard(JSON.parse(JSON.stringify(EXAMPLE_STORYBOARD))); if (!r.ok) throw new Error("bad"); return r.doc; })();
const setup = () => { const e = new Engine(createProject("t")); e.dispatch(cmd.createStoryboard(doc)); return e; };
const shot = (id: string) => ({ id, title: `Shot ${id}`, durationSec: 4, prompt: "A slow push in", qa: ["a", "b"] });
const shotIds = (e: Engine) => e.getState().project.storyboard!.order;
async function render(node: React.ReactNode) {
  const el = document.createElement("div"); el.className = "v2-app"; document.body.appendChild(el);
  await act(async () => createRoot(el).render(node));
  return el;
}

describe("AI agent access (P4C)", () => {
  it("is off by default; tools are registered only while it is on and WebMCP exists", async () => {
    fakeModelContext(); agentStore.reset();
    const e = setup();
    const stop = connectAgentBridge(e);
    expect(agentStore.get().enabled).toBe(false);
    expect(registered.size).toBe(0);
    act(() => agentStore.setEnabled(true));
    expect([...registered.keys()]).toEqual(storyAgent.STORY_TOOLS.map((t) => t.name));
    expect(agentStore.get().registered).toBe(storyAgent.STORY_TOOLS.length);
    expect(localStorage.getItem("v2.agentAccess")).toBe("1");
    act(() => agentStore.setEnabled(false));
    expect(registered.size).toBe(0);
    expect(aborted).toBe(storyAgent.STORY_TOOLS.length);
    stop();
  });

  it("an agent call edits the board live as one undo step, shows the indicator and is logged", async () => {
    fakeModelContext(); agentStore.reset();
    const e = setup();
    const stop = connectAgentBridge(e);
    act(() => agentStore.setEnabled(true));
    const el = await render(<><AgentIndicator engine={e} /><AgentPanel /></>);
    expect(el.querySelector('[data-testid="agent-editing"]')).toBeNull();
    expect(el.querySelector('[data-testid="agent-api"]')!.textContent).toContain("WebMCP found");
    const before = [...shotIds(e)];
    let res!: ToolResponse;
    await act(async () => { res = await registered.get("add_shot")!.execute({ shot: shot("n1"), after: "s1" }); });
    expect(res.isError).toBeUndefined();
    expect(shotIds(e)).toEqual(["s1", "n1", ...before.slice(1)]);
    const pill = el.querySelector('[data-testid="agent-editing"]')!;
    expect(pill.textContent).toContain("AI is editing");
    expect(pill.textContent).toContain("add_shot");
    expect(el.querySelector('[data-testid="agent-log"]')!.textContent).toContain("add_shot");
    await act(async () => ([...pill.querySelectorAll("button")].find((b) => b.textContent === "Undo")!).click());
    expect(shotIds(e)).toEqual(before);
    // A rejected call changes nothing and is logged as rejected.
    await act(async () => { res = await registered.get("update_shot")!.execute({ id: "s1", patch: { assets: ["ghost"] } }); });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Rejected, nothing changed");
    expect(shotIds(e)).toEqual(before);
    expect(el.querySelector(".v2-agent-log li.is-error")).not.toBeNull();
    stop();
  });

  it("refuses calls while access is off and explains a missing WebMCP", async () => {
    const e = setup();
    expect(callAgentTool(e, "add_shot", { shot: shot("n1") }).isError).toBe(true);
    expect(shotIds(e)).not.toContain("n1");
    const el = await render(<AgentPanel />);
    const toggle = el.querySelector('[data-testid="agent-toggle"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(el.querySelector('[data-testid="agent-api"]')!.textContent).toContain("doesn't offer WebMCP");
    expect(el.querySelector('[data-testid="agent-log-empty"]')).not.toBeNull();
  });

  it("send_to_timeline reports that no shot has a clip yet", () => {
    const e = setup();
    act(() => agentStore.setEnabled(true));
    const r = callAgentTool(e, "send_to_timeline", {});
    expect(r.content[0].text).toMatch(/no shot has a clip yet|Timeline updated/);
  });
});

describe("Import merges a storyboard part (P4C)", () => {
  it("shows the part, the diff, and applies it into the existing board", async () => {
    const e = setup();
    let merged: StoryDoc | undefined;
    const base = roundtrip.storyboardToDoc(e.getState().project.storyboard!);
    const el = await render(<ImportPanel base={base} replacing onCreate={() => {}} diffFor={(d) => roundtrip.storyDiff(e.getState().project, d)} onMerge={(d) => { merged = d; }} />);
    const area = el.querySelector("textarea") as HTMLTextAreaElement;
    const text = JSON.stringify({ format: "dionysus.storyboard/1", part: { index: 2, of: 3, after: "s1" }, shots: [shot("s10"), shot("s11")] });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text); area.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelector('[data-testid="story-part"]')!.textContent).toContain("part 2 of 3: 2 shots");
    const apply = el.querySelector('[data-testid="merge-apply"]') as HTMLButtonElement;
    await act(async () => apply.click());
    expect(merged!.shots.map((s) => s.id).slice(0, 3)).toEqual(["s1", "s10", "s11"]);
    expect(merged!.shots.length).toBe(doc.shots.length + 2);
  });

  it("a part with no board asks for part 1 first", async () => {
    const el = await render(<ImportPanel onCreate={() => {}} />);
    const area = el.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, JSON.stringify({ shots: [shot("s10")] })); area.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.querySelector('[data-testid="story-errors"]')!.textContent).toContain("Import the first part");
  });
});

describe("agent log Clear button", () => {
  it("is a 44px touch target on every viewport", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/v2/ui/agent/agent.css", "utf8");
    expect(css).toMatch(/\.v2-agent-loghead \.v2-agent-clear \{[^}]*min-height: 44px/);
    expect(css).not.toMatch(/@media[^{]*\{[^}]*v2-agent-clear/);
  });
});
