/**
 * Read what a scene needs from a `.glb` without three.js (P75, Phase 2 step 2.2): its animation clips (name and length)
 * and its nodes (count and names, for showing or hiding parts). Pure: bytes in, facts out, so validation and the Scene tab can name the clips
 * a model has. Lengths come from the `max` of each sampler's input accessor, which glTF 2.0 requires.
 */
export interface GlbAnimation { name: string; duration: number }
export interface GlbInfo { animations: GlbAnimation[]; meshes: number; nodes: number; skinned: boolean; nodeNames: string[] }

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The glTF JSON of a binary glTF, or undefined when the bytes are not a GLB. */
export function glbJson(bytes: Uint8Array): Record<string, unknown> | undefined {
  if (bytes.length < 20) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return undefined;
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + len > bytes.length) return undefined;
  try {
    const j: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
    return isObj(j) ? j : undefined;
  } catch { return undefined; }
}

/** Animations (unnamed ones are called "Animation <n>", as three.js's GLTFLoader names them), meshes, nodes. */
export function glbInfoFromJson(j: Record<string, unknown>): GlbInfo {
  const arr = (k: string) => (Array.isArray(j[k]) ? (j[k] as unknown[]) : []);
  const accessors = arr("accessors");
  const animations = arr("animations").map((a, i): GlbAnimation => {
    const an = isObj(a) ? a : {};
    const samplers = Array.isArray(an.samplers) ? an.samplers : [];
    let duration = 0;
    for (const s of samplers) {
      const acc = isObj(s) && typeof s.input === "number" ? accessors[s.input] : undefined;
      const max = isObj(acc) && Array.isArray(acc.max) ? acc.max[0] : undefined;
      if (typeof max === "number" && Number.isFinite(max)) duration = Math.max(duration, max);
    }
    return { name: typeof an.name === "string" && an.name ? an.name : `Animation ${i}`, duration };
  });
  const nodeNames = arr("nodes").map((n) => (isObj(n) && typeof n.name === "string" ? n.name : "")).filter(Boolean);
  return { animations, meshes: arr("meshes").length, nodes: arr("nodes").length, skinned: arr("skins").length > 0, nodeNames };
}

export function glbInfo(bytes: Uint8Array): GlbInfo | undefined {
  const j = glbJson(bytes);
  return j ? glbInfoFromJson(j) : undefined;
}

/** Bytes of a base64 (or percent-encoded) data: URL; undefined when it is not one. */
export function dataUrlToBytes(url: string): Uint8Array | undefined {
  const m = /^data:([^,]*?),([\s\S]*)$/.exec(url);
  if (!m) return undefined;
  try {
    const raw = /;base64/i.test(m[1]) ? atob(m[2]) : decodeURIComponent(m[2]);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch { return undefined; }
}

const infoCache = new Map<string, GlbInfo | null>();
/** `glbInfo` of a data: URL (a small cache, keyed by the URL, so validating on every edit stays cheap). */
export function glbInfoOfDataUrl(url: string): GlbInfo | undefined {
  if (infoCache.has(url)) return infoCache.get(url) ?? undefined;
  const bytes = dataUrlToBytes(url);
  const info = bytes ? glbInfo(bytes) ?? null : null;
  if (infoCache.size >= 16) infoCache.delete(infoCache.keys().next().value as string);
  infoCache.set(url, info);
  return info ?? undefined;
}
