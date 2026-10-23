import type { Project } from "../domain/model";

export interface ProjectSummary { id: string; name: string; updatedAt: string }

export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<Project | undefined>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
}

export interface Storage { projects: ProjectStore; blobs: BlobStore; lastProjectId: { get(): string | null; set(id: string): void } }
