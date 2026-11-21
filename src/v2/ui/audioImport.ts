import { midiToAudioClip, musicXmlToAudioClip, parseAudioClip, parseMidi, type AudioClip, type ClipIssue } from "../domain";
import { readBlobBytes, readZipIndex, zipEntryBlob } from "../persistence";

/**
 * P91: the Audio editor's Import: a dionysus.audioclip/1 .json, a Standard MIDI File (.mid/.midi), MusicXML
 * (.musicxml/.xml) or compressed MusicXML (.mxl, read with the project archive's ZIP reader). The kind is sniffed from
 * the bytes, so a wrong extension still imports.
 */
export const AUDIO_IMPORT_ACCEPT = ".json,application/json,.mid,.midi,audio/midi,audio/x-midi,.musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml";

export type AudioImport = { ok: true; clip: AudioClip; issues: ClipIssue[] } | { ok: false; issues: ClipIssue[] };

const fail = (path: string, message: string): AudioImport => ({ ok: false, issues: [{ path, message, level: "error" }] });
const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
const decodeText = (b: Uint8Array) => new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");

/** The rootfile of a compressed MusicXML (.mxl) archive: META-INF/container.xml, else the first score in it. */
async function mxlText(file: Blob): Promise<string> {
  const index = await readZipIndex(file);
  let path: string | undefined;
  const container = index.get("META-INF/container.xml");
  if (container) path = /full-path\s*=\s*"([^"]+)"/.exec(decodeText(await readBlobBytes(await zipEntryBlob(file, container))))?.[1];
  if (!path || !index.has(path)) path = [...index.keys()].find((k) => !k.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(k));
  if (!path) throw new Error("No MusicXML score inside the .mxl archive.");
  return decodeText(await readBlobBytes(await zipEntryBlob(file, index.get(path)!)));
}

/** Read an import file into a clip (plus warnings as issues), or the problems that stopped it. */
export async function importAudioFile(file: Blob & { name?: string }): Promise<AudioImport> {
  const name = file.name ?? "";
  let bytes: Uint8Array;
  try { bytes = await readBlobBytes(file); } catch (e) { return fail("", `Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`); }
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  const warn = (ws: string[]): ClipIssue[] => ws.map((message) => ({ path: "import", message, level: "warning" }));
  const finish = (r: { clip: AudioClip; warnings: string[] }): AudioImport => {
    // Round-trip through the parser, so an imported clip is exactly what a pasted one would be.
    const p = parseAudioClip(r.clip);
    return p.ok ? { ok: true, clip: p.clip, issues: [...warn(r.warnings), ...p.issues] } : p;
  };
  try {
    if (head === "MThd") return finish(midiToAudioClip(parseMidi(bytes), { name: baseName(name) }));
    // MusicXML: the score's own title wins; the file name only replaces the default.
    const named = (r: { clip: AudioClip; warnings: string[] }) => (r.clip.name === "MusicXML import" && baseName(name) ? { ...r, clip: { ...r.clip, name: baseName(name) } } : r);
    if (head === "PK\u0003\u0004") return finish(named(musicXmlToAudioClip(await mxlText(file))));
    const text = decodeText(bytes);
    if (/^\s*</.test(text)) return finish(named(musicXmlToAudioClip(text)));
    return parseAudioClip(text);
  } catch (e) {
    return fail("import", e instanceof Error ? e.message : String(e));
  }
}
