import type { Project } from "../domain/model";

/** Read-only view of the live document (implemented by the engine). */
export interface ProjectSource {
  getState(): { project: Project };
  subscribe(listener: () => void): () => void;
}
