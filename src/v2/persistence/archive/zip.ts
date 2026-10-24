/**
 * Minimal streaming ZIP (PKWARE APPNOTE 6.3) for project archives. The writer stores entries uncompressed (STORE),
 * takes each entry's bytes as a stream of chunks and adds ZIP64 records only when a size or offset needs them. The
 * reader works from the central directory and hands back Blob slices of the archive, so a large archive is never
 * read into memory as a whole. Deflated entries (an archive re-zipped by another tool) are inflated with
 * DecompressionStream where the browser has it.
 */
import { crc32 } from "./sha256";

export class ZipError extends Error {}

/** Where archive bytes go: a File System Access / OPFS writable, or an in-memory list of parts. */
export interface ZipSink { write(data: Uint8Array): Promise<void> }

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const utf8 = new TextEncoder();

interface Written { name: Uint8Array; crc: number; size: number; offset: number }

function dosDateTime(d: Date): [number, number] {
  const y = Math.max(1980, d.getFullYear());
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

class Bytes {
  readonly u8: Uint8Array;
  private dv: DataView;
  private p = 0;
  constructor(n: number) { this.u8 = new Uint8Array(n); this.dv = new DataView(this.u8.buffer); }
  u16(v: number) { this.dv.setUint16(this.p, v, true); this.p += 2; return this; }
  u32(v: number) { this.dv.setUint32(this.p, v >>> 0, true); this.p += 4; return this; }
  u64(v: number) { this.u32(v % 0x100000000); this.u32(Math.floor(v / 0x100000000)); return this; }
  raw(b: Uint8Array) { this.u8.set(b, this.p); this.p += b.length; return this; }
}

export class ZipWriter {
  private offset = 0;
  private entries: Written[] = [];
  private readonly time: number;
  private readonly date: number;
  constructor(private sink: ZipSink, now = new Date()) { [this.time, this.date] = dosDateTime(now); }

  /** Bytes written so far. */
  get length() { return this.offset; }

  private async out(b: Uint8Array) { await this.sink.write(b); this.offset += b.length; }

  /** Add a small entry held in memory (JSON). */
  async addBytes(name: string, data: Uint8Array) {
    await this.add(name, { size: data.length, crc: crc32(0, data) }, (async function* () { yield data; })());
  }

  /**
   * Add an entry whose size and CRC-32 are already known (computed in an earlier pass), streaming its bytes from
   * `chunks`. Throws if the stream doesn't match, e.g. the media changed in between.
   */
  async add(name: string, info: { size: number; crc: number }, chunks: AsyncIterable<Uint8Array>, onBytes?: (n: number) => void) {
    const nm = utf8.encode(name);
    const offset = this.offset;
    const big = info.size >= MAX32;
    const extra = big ? new Bytes(20).u16(1).u16(16).u64(info.size).u64(info.size).u8 : new Uint8Array(0);
    await this.out(new Bytes(30 + nm.length + extra.length)
      .u32(0x04034b50).u16(big ? 45 : 20).u16(0x0800).u16(0).u16(this.time).u16(this.date)
      .u32(info.crc).u32(big ? MAX32 : info.size).u32(big ? MAX32 : info.size).u16(nm.length).u16(extra.length).raw(nm).raw(extra).u8);
    let n = 0, crc = 0;
    for await (const c of chunks) {
      crc = crc32(crc, c);
      n += c.length;
      await this.out(c);
      onBytes?.(c.length);
    }
    if (n !== info.size || crc !== info.crc) throw new ZipError(`${name} changed while it was being written; try again.`);
    this.entries.push({ name: nm, crc: info.crc, size: info.size, offset });
  }

  /** Write the central directory and end records. */
  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const zs = e.size >= MAX32, zo = e.offset >= MAX32;
      const fields = (zs ? 2 : 0) + (zo ? 1 : 0);
      const ex = new Bytes(fields ? 4 + fields * 8 : 0);
      if (fields) { ex.u16(1).u16(fields * 8); if (zs) ex.u64(e.size).u64(e.size); if (zo) ex.u64(e.offset); }
      const need = fields ? 45 : 20;
      await this.out(new Bytes(46 + e.name.length + ex.u8.length)
        .u32(0x02014b50).u16(need).u16(need).u16(0x0800).u16(0).u16(this.time).u16(this.date)
        .u32(e.crc).u32(zs ? MAX32 : e.size).u32(zs ? MAX32 : e.size).u16(e.name.length).u16(ex.u8.length).u16(0)
        .u16(0).u16(0).u32(0).u32(zo ? MAX32 : e.offset).raw(e.name).raw(ex.u8).u8);
    }
    const size = this.offset - start, count = this.entries.length;
    const z64 = count >= MAX16 || size >= MAX32 || start >= MAX32;
    if (z64) {
      const at = this.offset;
      await this.out(new Bytes(56).u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(count).u64(count).u64(size).u64(start).u8);
      await this.out(new Bytes(20).u32(0x07064b50).u32(0).u64(at).u32(1).u8);
    }
    await this.out(new Bytes(22).u32(0x06054b50).u16(0).u16(0).u16(z64 ? MAX16 : count).u16(z64 ? MAX16 : count)
      .u32(z64 ? MAX32 : size).u32(z64 ? MAX32 : start).u16(0).u8);
  }
}

// ---------------------------------------------------------------- reader

export interface ZipEntry { name: string; method: number; crc: number; compressedSize: number; size: number; localOffset: number }

export function readBlobBytes(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer().then((x) => new Uint8Array(x));
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
}

/** Read a Blob in slices of `chunk` bytes, so only one slice is in memory at a time. */
export async function* blobChunks(b: Blob, chunk = 4 * 1024 * 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < b.size; i += chunk) yield await readBlobBytes(b.slice(i, Math.min(b.size, i + chunk)));
}

const u64 = (dv: DataView, p: number) => dv.getUint32(p, true) + dv.getUint32(p + 4, true) * 0x100000000;
const NOT_ZIP = "This file is not a zip archive, or it is damaged.";

/** The archive's entries by name, read from the central directory only. */
export async function readZipIndex(file: Blob): Promise<Map<string, ZipEntry>> {
  if (file.size < 22) throw new ZipError(NOT_ZIP);
  const tailStart = Math.max(0, file.size - 65557);
  const tail = await readBlobBytes(file.slice(tailStart));
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let e = -1;
  for (let p = tail.length - 22; p >= 0; p--) if (tv.getUint32(p, true) === 0x06054b50) { e = p; break; }
  if (e < 0) throw new ZipError(NOT_ZIP);
  let count = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cdOffset = tv.getUint32(e + 16, true);
  if (count === MAX16 || cdSize === MAX32 || cdOffset === MAX32) {
    const loc = e - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) throw new ZipError(NOT_ZIP);
    const at = u64(tv, loc + 8);
    const z = await readBlobBytes(file.slice(at, at + 56));
    const zv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    if (z.length < 56 || zv.getUint32(0, true) !== 0x06064b50) throw new ZipError(NOT_ZIP);
    count = u64(zv, 32); cdSize = u64(zv, 40); cdOffset = u64(zv, 48);
  }
  if (cdOffset + cdSize > file.size) throw new ZipError("The archive is incomplete (it may not have finished downloading).");
  const cd = await readBlobBytes(file.slice(cdOffset, cdOffset + cdSize));
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const out = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== 0x02014b50) throw new ZipError(NOT_ZIP);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const ent: ZipEntry = {
      name: dec.decode(cd.subarray(p + 46, p + 46 + nameLen)), method: dv.getUint16(p + 10, true), crc: dv.getUint32(p + 16, true),
      compressedSize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true), localOffset: dv.getUint32(p + 42, true),
    };
    for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
      const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (ent.size === MAX32) { ent.size = u64(dv, q); q += 8; }
        if (ent.compressedSize === MAX32) { ent.compressedSize = u64(dv, q); q += 8; }
        if (ent.localOffset === MAX32) ent.localOffset = u64(dv, q);
      }
      x += 4 + len;
    }
    out.set(ent.name, ent);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** An entry's (uncompressed) bytes as a Blob; a slice of `file` for stored entries, so nothing is copied. */
export async function zipEntryBlob(file: Blob, e: ZipEntry): Promise<Blob> {
  const h = await readBlobBytes(file.slice(e.localOffset, e.localOffset + 30));
  const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new ZipError(`${e.name} is damaged in the archive.`);
  const start = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  if (start + e.compressedSize > file.size) throw new ZipError(`${e.name} is cut short; the archive is incomplete.`);
  const raw = file.slice(start, start + e.compressedSize);
  if (e.method === 0) return raw;
  if (e.method === 8 && typeof DecompressionStream === "function") {
    try {
      return await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat))).blob();
    } catch { throw new ZipError(`${e.name} is damaged in the archive.`); }
  }
  throw new ZipError(`${e.name} uses a compression this browser can't read. Re-create the file with Export project file.`);
}
