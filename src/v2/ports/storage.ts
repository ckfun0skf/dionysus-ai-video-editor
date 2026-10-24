import type { Project } from "../domain/model";

/** A stored blob as a stream of chunks. */
export type BlobChunks = AsyncIterable<Uint8Array> & { size: number; type: string };

export interface ProjectSummary { id: string; name: string; updatedAt: string }

export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<Project | undefined>;
  /** Stored record without schema checks, for backups/recovery of projects that fail to load. */
  loadRaw(id: string): Promise<unknown>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /**
   * Optional: the stored bytes one chunk at a time without assembling a Blob, so a large video can be streamed into a
   * project archive (V2-CUT-PROJ), with the total size and type known up front. Resolves undefined when the key is
   * unknown.
   */
  chunks?(key: string): Promise<BlobChunks | undefined>;
}

export interface Storage { projects: ProjectStore; blobs: BlobStore; lastProjectId: { get(): string | null; set(id: string): void } }
