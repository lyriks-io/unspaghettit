import type { SurfaceBlueprint } from '../entities/SurfaceBlueprint';
import type { BlueprintId } from '../value-objects/BlueprintId';

/**
 * Port. Anything that can produce the catalog of available blueprints.
 * The standard library implementation is in-memory; future adapters could
 * load from a remote registry, a tenant-scoped database, etc.
 */
export interface BlueprintRepository {
  list(): readonly SurfaceBlueprint[];
  findById(id: BlueprintId): SurfaceBlueprint | undefined;
}
