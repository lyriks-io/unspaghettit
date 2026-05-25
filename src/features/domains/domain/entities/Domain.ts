import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type { DomainId } from '../value-objects/ids';

/**
 * Project grouping tag. A Domain corresponds to a department or functional
 * area (e.g. Sales, Tech, Product); it owns a curated list of projects.
 * Domains are flat, no nesting, no inheritance, and are used for filtering.
 */
export type Domain = {
  readonly id: DomainId;
  readonly name: string;
  readonly description?: string;
  readonly projectIds: readonly ProjectId[];
  readonly createdAt: string;
  readonly updatedAt: string;
};
