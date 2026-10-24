import { readBlobBytes } from "./archive/zip";
import type { BlobStore, ProjectStore, Storage } from "../ports/storage";
import type { Project } from "../domain/model";

export function createMemoryStorage(): Storage {
  const projects = new Map<string, Project>();
  const blobs = new Map<string, Blob>();
  let last: string | null = null;
  const ps: ProjectStore = {
    list: async () => [...projects.values()].map((p) => ({ id: p.id, name: p.name, updatedAt: p.meta.updatedAt })),
    load: async (id) => projects.get(id),
    loadRaw: async (id) => projects.get(id),
    save: async (p) => void projects.set(p.id, p),
    delete: async (id) => void projects.delete(id),
  };
  const bs: BlobStore = { put: async (k, b) => void blobs.set(k, b), get: async (k) => blobs.get(k), delete: async (k) => void blobs.delete(k), keys: async () => [...blobs.keys()],
    chunks: async (k) => {
      const b = blobs.get(k);
      if (!b) return undefined;
      const parts = (async function* () { for (let i = 0; i < b.size; i += 1 << 20) yield await readBlobBytes(b.slice(i, i + (1 << 20))); })();
      return Object.assign(parts, { size: b.size, type: b.type });
    },
  };
  return { projects: ps, blobs: bs, lastProjectId: { get: () => last, set: (id) => { last = id; } } };
}
