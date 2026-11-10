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
