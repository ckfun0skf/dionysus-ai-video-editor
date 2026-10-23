/** Load-time schema check + migration hook (MODULE_DESIGN §8). Every stored project passes through here. */
import { SCHEMA, validateComposition, type Project } from "../domain";

/** Registered upgrades keyed by the schema they upgrade FROM. Add an entry when SCHEMA changes. */
export const MIGRATIONS: Record<string, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

export class SchemaError extends Error {}

export function migrateProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null) throw new SchemaError("Stored project is not an object.");
  let rec = raw as Record<string, unknown>;
  for (let guard = 0; rec.schema !== SCHEMA; guard++) {
    const step = MIGRATIONS[String(rec.schema)];
    if (!step || guard > 20) throw new SchemaError(`Unsupported project schema "${String(rec.schema)}" (expected ${SCHEMA}).`);
    rec = step(rec);
  }
  const p = rec as unknown as Project;
  if (typeof p.id !== "string" || typeof p.assets !== "object" || typeof p.compositions !== "object" || !p.compositions[p.rootCompositionId]) throw new SchemaError("Stored project is malformed (missing id, assets or root composition).");
  const problems = Object.values(p.compositions).flatMap(validateComposition);
  if (problems.length) throw new SchemaError(`Stored project failed validation: ${problems.slice(0, 3).join("; ")}`);
  return p;
}
