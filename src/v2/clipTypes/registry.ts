import type { ClipTypeCore } from "./types";

const TRACK_KINDS = ["video", "audio", "text", "effect"];
const CAP_FLAGS = ["sourceTime", "still", "sound", "visual", "keyable", "thumb"] as const;
export const CLIP_TYPE_ID = /^[a-z][a-z0-9-]*$/;

/** Problems with one core definition (empty = valid). Pure: does not look at other registered types. */
export function checkClipType(c: unknown): string[] {
  const out: string[] = [];
  const t = c as Partial<ClipTypeCore> | undefined;
  if (!t || typeof t !== "object") return ["not an object (default-export defineClipType({…}))"];
  if (typeof t.id !== "string" || !CLIP_TYPE_ID.test(t.id)) out.push(`id must match ${CLIP_TYPE_ID} (got ${JSON.stringify(t.id)})`);
  if (!Number.isInteger(t.version) || (t.version as number) < 1) out.push("version must be an integer ≥ 1");
  if (typeof t.description !== "string" || !t.description.trim()) out.push("description is required");
  if (!TRACK_KINDS.includes(t.trackKind as string)) out.push(`trackKind must be one of ${TRACK_KINDS.join(", ")}`);
  if (!t.caps || typeof t.caps !== "object") out.push("caps is required");
  else {
    for (const k of CAP_FLAGS) if (typeof t.caps[k] !== "boolean") out.push(`caps.${k} must be a boolean`);
    if (t.caps.asset !== "media" && t.caps.asset !== "none") out.push('caps.asset must be "media" or "none"');
  }
  if (t.variant && (typeof t.variant.of !== "string" || typeof t.variant.field !== "string")) out.push("variant needs `of` and `field`");
  if (t.accepts !== undefined) {
    const a = t.accepts as Partial<NonNullable<ClipTypeCore["accepts"]>>;
    if (!Array.isArray(a.ext) || a.ext.some((e) => typeof e !== "string" || e !== e.toLowerCase() || e.startsWith("."))) out.push("accepts.ext must be lower-case extensions without the dot");
    if (!a.mimeByExt || typeof a.mimeByExt !== "object") out.push("accepts.mimeByExt is required");
  }
  if (t.agent !== undefined) {
    const ag = t.agent as Partial<NonNullable<ClipTypeCore["agent"]>>;
    if (ag.tools !== undefined && (!Array.isArray(ag.tools) || ag.tools.some((x) => !x || typeof x.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(x.name)))) out.push("agent.tools need snake_case names");
    if (ag.tools?.length && typeof ag.run !== "function") out.push("agent.tools need agent.run");
    if (ag.rules !== undefined && (!Array.isArray(ag.rules) || ag.rules.some((r) => !r || typeof r.key !== "string" || typeof r.text !== "string"))) out.push("agent.rules must be { key, text }");
    for (const k of ["clipTools", "props"] as const) if (ag[k] !== undefined && (!Array.isArray(ag[k]) || ag[k]!.some((x) => typeof x !== "string"))) out.push(`agent.${k} must be a list of names`);
  }
  if (t.story !== undefined) {
    const st = t.story as Partial<NonNullable<ClipTypeCore["story"]>>;
    if (!Array.isArray(st.assetTypes)) out.push("story.assetTypes must be an array");
    if (!["planned", "still", "media"].includes(st.sendLength as string)) out.push('story.sendLength must be "planned", "still" or "media"');
    if (!["video", "image", "html"].includes(st.layerType as string)) out.push('story.layerType must be "video", "image" or "html"');
    for (const k of ["layer", "takes", "params"] as const) if (typeof st[k] !== "boolean") out.push(`story.${k} must be a boolean`);
  }
  return out;
}

export interface ClipTypeRegistry {
  core(id: string): ClipTypeCore | undefined;
  list(): ClipTypeCore[];
  /** Validates and adds a type; throws on an invalid definition or a duplicate id. */
  register(core: ClipTypeCore): void;
  /**
   * P84: replace the runtime (third-party plugin) types with `cores` in one step: ids must start with `x-` and may not
   * shadow a built-in; unchanged entries (same object) are kept. Subscribers are told once if anything changed.
   */
  setRuntime(cores: readonly ClipTypeCore[]): boolean;
  /** P84: the runtime types now registered. */
  runtime(): ClipTypeCore[];
  /** P84: called after the runtime types change. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
  /** P84: increases on every change (for caches and `useSyncExternalStore`). */
  revision(): number;
  /** P84: tell subscribers something about the runtime types changed without changing the list (plugin issues). */
  notify(): void;
}

/** P84: runtime (plugin) type ids start with `x-` (decision 13); built-ins never do. */
export const RUNTIME_CLIP_TYPE_ID = /^x-[a-z0-9][a-z0-9-]*$/;

export function createClipTypeRegistry(): ClipTypeRegistry {
  const byId = new Map<string, ClipTypeCore>();
  const runtime = new Map<string, ClipTypeCore>();
  const subs = new Set<() => void>();
  let rev = 0;
  return {
    core: (id) => byId.get(id) ?? runtime.get(id),
    list: () => [...byId.values(), ...runtime.values()],
    register(core) {
      const problems = checkClipType(core);
      if (problems.length) throw new Error(`clip type ${JSON.stringify(core?.id)}: ${problems.join("; ")}`);
      if (byId.has(core.id) || runtime.has(core.id)) throw new Error(`clip type "${core.id}" is already registered`);
      byId.set(core.id, core);
      rev += 1;
    },
    setRuntime(cores) {
      const next = new Map<string, ClipTypeCore>();
      for (const c of cores) {
        const problems = checkClipType(c);
        if (!RUNTIME_CLIP_TYPE_ID.test(c?.id ?? "")) problems.push(`runtime clip type ids start with "x-" (got ${JSON.stringify(c?.id)})`);
        if (problems.length) throw new Error(`clip type ${JSON.stringify(c?.id)}: ${problems.join("; ")}`);
        if (byId.has(c.id)) throw new Error(`clip type "${c.id}" is built in`);
        if (next.has(c.id)) throw new Error(`clip type "${c.id}" is listed twice`);
        next.set(c.id, c);
      }
      const same = next.size === runtime.size && [...next].every(([id, c]) => runtime.get(id) === c);
      if (same) return false;
      runtime.clear();
      for (const [id, c] of next) runtime.set(id, c);
      rev += 1;
      for (const fn of [...subs]) fn();
      return true;
    },
    runtime: () => [...runtime.values()],
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    revision: () => rev,
    notify() { rev += 1; for (const fn of [...subs]) fn(); },
  };
}
