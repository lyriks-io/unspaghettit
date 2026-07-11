import type { DependencyId, DependencyOperationId } from '../value-objects/ids';

/**
 * What kind of external system this is. A system's important logic often sits
 * at its boundary with something else; naming the boundary explicitly is how
 * that logic gets extracted and stored instead of living implicitly in code.
 */
export type DependencyKind =
  | 'service'
  | 'database'
  | 'queue'
  | 'device'
  | 'human'
  | 'filesystem'
  | 'api'
  | 'other';

export const ALL_DEPENDENCY_KINDS: readonly DependencyKind[] = [
  'service',
  'database',
  'queue',
  'device',
  'human',
  'filesystem',
  'api',
  'other'
];

/**
 * One operation an action can invoke on a dependency (charge a card, publish a
 * message, ask a human to approve). The call contract lives here so the model
 * captures the questions code hides: how long before it times out, whether it
 * is safe to retry, and the ways it can fail.
 */
export type DependencyOperation = {
  readonly id: DependencyOperationId;
  readonly name: string;
  readonly description?: string;
  /** The ways this operation can fail (declined, timeout, not-found, ...). */
  readonly failureModes?: readonly string[];
  /** Free-text timeout budget, e.g. "5s", "30s". */
  readonly timeout?: string;
  /** How many times it is safe to retry on a transient failure. */
  readonly retries?: number;
  /** Whether repeating the call with the same input is safe (no double effect). */
  readonly idempotent?: boolean;
};

/**
 * A first-class external dependency of the feature: a service, datastore,
 * queue, device, human, or filesystem it calls out to. Distinct from a
 * {@link Resource} (which describes where DATA lives — provenance, residency,
 * sensitivity); a Dependency describes an external system whose OPERATIONS the
 * feature invokes, and the contract and failure modes of those calls.
 */
export type Dependency = {
  readonly id: DependencyId;
  readonly name: string;
  readonly kind: DependencyKind;
  readonly description?: string;
  /** Free-text vendor / technology: "Stripe", "Twilio", "RabbitMQ", "Operator". */
  readonly provider?: string;
  readonly operations: readonly DependencyOperation[];
  /** What the feature assumes about this dependency (availability, consistency, ...). */
  readonly assumptions?: readonly string[];
};
