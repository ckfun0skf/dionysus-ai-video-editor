/**
 * Worker for ProjectFile.tsx: writes a project archive into an Origin Private File System file with a sync access
 * handle. This is the streaming export path on Safari (iOS included), which has OPFS but no `createWritable` on the
 * main thread, so the archive goes to disk chunk by chunk instead of being held in memory.
 */
interface SyncHandle { write(d: Uint8Array, o: { at: number }): number; truncate(n: number): void; flush(): void; close(): void }
type Msg = { id: number; op: "open"; name: string } | { id: number; op: "write"; data: Uint8Array } | { id: number; op: "close" } | { id: number; op: "abort" };

let handle: SyncHandle | undefined;
let pos = 0;

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.op === "open") {
      const dir = await navigator.storage.getDirectory();
      const fh = await dir.getFileHandle(m.name, { create: true });
      handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
      handle.truncate(0);
      pos = 0;
    } else if (m.op === "write") {
      let at = 0;
      while (at < m.data.length) at += handle!.write(m.data.subarray(at), { at: pos + at });
      pos += m.data.length;
    } else {
      handle?.flush();
      handle?.close();
      handle = undefined;
    }
    self.postMessage({ id: m.id, ok: true });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, name: (err as Error)?.name, message: (err as Error)?.message ?? String(err) });
  }
};
