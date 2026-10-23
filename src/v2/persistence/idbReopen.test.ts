import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createDbHandle, createIndexedDbStorage, isClosedError, RELOAD_NEEDED } from "./indexeddb";

let n = 0;
const name = () => `reopen-test-${++n}`;

describe("IndexedDB connection resilience (V2-102)", () => {
  it("recognises closed-connection errors", () => {
    expect(isClosedError(new DOMException("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", "InvalidStateError"))).toBe(true);
    expect(isClosedError(new Error("The database connection is closing."))).toBe(true);
    expect(isClosedError(new Error("QuotaExceededError"))).toBe(false);
  });

  it("reopens and retries after the shared connection was closed", async () => {
    const db = name();
    const s = createIndexedDbStorage(db);
    await s.blobs.put("a", new Blob(["1"]));
    const h = createDbHandle(db);
    (await h.getDb()).close(); // a closed handle, as Chrome does on Android
    // The handle doesn't know yet (no onclose for explicit close) — run must still succeed via retry.
    await h.run("blobs", "readwrite", (st) => st.put(new Blob(["2"]), "b"));
    expect((await s.blobs.keys()).sort()).toEqual(["a", "b"]);
  });

  it("closes on versionchange from a newer tab and reopens on next use", async () => {
    const db = name();
    const s = createIndexedDbStorage(db);
    await s.blobs.put("a", new Blob(["1"]));
    // A newer tab opens version 2: our connection must let go (not block it).
    await new Promise<void>((res, rej) => { const r = indexedDB.open(db, 2); r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("blocked")); });
    // Our next open is now at v1 < v2 → VersionError → friendly reload message.
    await expect(s.blobs.keys()).rejects.toThrow(RELOAD_NEEDED);
  });

  it("keeps working across many operations without reusing a dead handle", async () => {
    const db = name();
    const h = createDbHandle(db);
    for (let i = 0; i < 3; i++) {
      await h.run("blobs", "readwrite", (st) => st.put(new Blob([String(i)]), `k${i}`));
      (await h.getDb()).close();
    }
    expect(await h.run("blobs", "readonly", (st) => st.count())).toBe(3);
  });
});
