import type { EntityFieldType } from '../value-objects/EntityFieldType';
import type { EntityFieldId, EntityId, ResourceId, ValueSetId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';

/**
 * A logical Entity entity. A named domain object whose top-level fields map
 * to state paths in the feature. Examples: User, Order, Cart, Product.
 *
 * Fields are recursive: an `object` field has nested children, an `array`
 * field has a single `items` schema describing each element. This lets the
 * model document arbitrary JSON shapes (Firebase-style nested structures)
 * without affecting the simulator, which still keys off the top-level path.
 */
export type EntityField = {
  readonly id: EntityFieldId;
  readonly name: string;
  readonly type: EntityFieldType;
  readonly description?: string;
  readonly required?: boolean;
  readonly enumValues?: readonly string[];
  /** Reusable enum identity, including project-linked cross-feature value sets. */
  readonly valueSetId?: ValueSetId;
  /**
   * Optional state path. Set on top-level fields that map to a real
   * StateDefinition. Nested fields (children of an object, or the items
   * schema of an array) leave it undefined.
   */
  readonly path?: StatePath;
  /** type='object' → nested fields. */
  readonly fields?: readonly EntityField[];
  /** type='array' → single field describing each array element. */
  readonly items?: EntityField;
};

export type Entity = {
  readonly id: EntityId;
  /**
   * First segment of the state-path namespace this entity owns. Also acts as
   * the canonical identifier. The display name is derived from it via
   * `humanizeStatePath`, so there's a single source of truth.
   */
  readonly namespace: string;
  readonly description?: string;
  readonly fields: readonly EntityField[];
  /** Optional pointer to the Resource backing this entity. */
  readonly resourceId?: ResourceId;
};
