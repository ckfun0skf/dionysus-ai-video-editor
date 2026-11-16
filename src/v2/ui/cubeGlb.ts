/** A tiny axis-aligned cube .glb (8 vertices, 12 triangles) for tests and screenshots. */
export function makeCubeGlb(): Uint8Array {
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0, 1, 5, 6, 1, 6, 2, 4, 0, 3, 4, 3, 7,
  ]);
  const bin = new Uint8Array(96 + 72);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(indices.buffer), 96);
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 96, target: 34962 },
      { buffer: 0, byteOffset: 96, byteLength: 72, target: 34963 },
    ],
    buffers: [{ byteLength: 168 }],
  });
  const jsonBytes = new TextEncoder().encode(json);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = jsonBytes.length + jsonPad;
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = bin.length + binPad;
  const total = 12 + 8 + jsonChunk + 8 + binChunk;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out[0] = 0x67; out[1] = 0x6c; out[2] = 0x54; out[3] = 0x46;
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk, true);
  view.setUint32(16, 0x4E4F534A, true);
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20;
  const binAt = 20 + jsonChunk;
  view.setUint32(binAt, binChunk, true);
  view.setUint32(binAt + 4, 0x004E4942, true);
  out.set(bin, binAt + 8);
  return out;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * P75: a small animated .glb for tests and screenshots: a robot made of boxes ("Body", "Head", "Arm" under "Bot")
 * with three node animations: "Wave" (the arm, 1 s), "Spin" (the body turns once, 2 s) and "Bounce" (up and down,
 * 0.8 s). Lit (normals) and coloured (materials), no textures.
 */
export function makeAnimatedGlb(): Uint8Array {
  const parts: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const add = (data: Float32Array | Uint16Array, acc: Record<string, unknown>, target?: number): number => {
    const bytes = new Uint8Array(data.buffer.slice(0));
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    parts.push(bytes, new Uint8Array(pad));
    offset += bytes.length + pad;
    accessors.push({ bufferView: views.length - 1, ...acc });
    return accessors.length - 1;
  };
  // A unit cube with per-face normals (24 vertices).
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  faces.forEach(([n, u, v], f) => {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(...[0, 1, 2].map((k) => 0.5 * (n[k] + a * u[k] + b * v[k])));
      nor.push(...n);
    }
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  const P = add(new Float32Array(pos), { componentType: 5126, count: 24, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, 34962);
  const N = add(new Float32Array(nor), { componentType: 5126, count: 24, type: "VEC3" }, 34962);
  const I = add(new Uint16Array(idx), { componentType: 5123, count: 36, type: "SCALAR" }, 34963);
  const times = (ts: number[]) => add(new Float32Array(ts), { componentType: 5126, count: ts.length, type: "SCALAR", min: [ts[0]], max: [ts[ts.length - 1]] });
  const vals = (vs: number[][], type: "VEC3" | "VEC4") => add(new Float32Array(vs.flat()), { componentType: 5126, count: vs.length, type });
  const yq = (deg: number) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
  const zq = (deg: number) => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];
  const waveT = times([0, 0.25, 0.5, 0.75, 1]), waveV = vals([0, 70, 20, 70, 0].map(zq), "VEC4");
  const spinT = times([0, 0.5, 1, 1.5, 2]), spinV = vals([0, 90, 180, 270, 360].map(yq), "VEC4");
  const bounceT = times([0, 0.4, 0.8]), bounceV = vals([[0, 0, 0], [0, 0.35, 0], [0, 0, 0]], "VEC3");
  const json = {
    asset: { version: "2.0", generator: "dionysus test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Bot", children: [1] },
      { name: "Body", mesh: 0, translation: [0, 0.6, 0], scale: [0.8, 1.2, 0.5], children: [2, 3] },
      { name: "Head", mesh: 1, translation: [0, 0.72, 0], scale: [0.7, 0.4, 0.9] },
      { name: "Arm", mesh: 2, translation: [0.55, 0.3, 0], scale: [0.2, 0.7, 0.3] },
    ],
    meshes: [0, 1, 2].map((m) => ({ primitives: [{ attributes: { POSITION: P, NORMAL: N }, indices: I, material: m }] })),
    materials: [[0.35, 0.82, 0.78, 1], [0.95, 0.95, 0.95, 1], [1, 0.42, 0.29, 1]].map((c) => ({ pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0.1, roughnessFactor: 0.6 } })),
    animations: [
      { name: "Wave", samplers: [{ input: waveT, output: waveV }], channels: [{ sampler: 0, target: { node: 3, path: "rotation" } }] },
      { name: "Spin", samplers: [{ input: spinT, output: spinV }], channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }] },
      { name: "Bounce", samplers: [{ input: bounceT, output: bounceV }], channels: [{ sampler: 0, target: { node: 0, path: "translation" } }] },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) { bin.set(p, at); at += p.length; }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = jsonBytes.length + jsonPad;
  const total = 12 + 8 + jsonChunk + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20;
  const binAt = 20 + jsonChunk;
  view.setUint32(binAt, bin.length, true); view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(bin, binAt + 8);
  return out;
}
