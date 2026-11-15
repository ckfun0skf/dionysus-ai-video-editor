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
  return out;
}

export interface ClipTypeRegistry {
  core(id: string): ClipTypeCore | undefined;
  list(): ClipTypeCore[];
  /** Validates and adds a type; throws on an invalid definition or a duplicate id. */
  register(core: ClipTypeCore): void;
}

export function createClipTypeRegistry(): ClipTypeRegistry {
  const byId = new Map<string, ClipTypeCore>();
  return {
    core: (id) => byId.get(id),
    list: () => [...byId.values()],
    register(core) {
      const problems = checkClipType(core);
      if (problems.length) throw new Error(`clip type ${JSON.stringify(core?.id)}: ${problems.join("; ")}`);
      if (byId.has(core.id)) throw new Error(`clip type "${core.id}" is already registered`);
      byId.set(core.id, core);
    },
  };
}
