import type { ResourceId } from '../value-objects/ids';
import type {
  AccessMode,
  AuthenticationMethod,
  ResourceKind,
  ResourceScope,
  ResourceSensitivity
} from '../value-objects/Resource';

/**
 * A Resource is a piece of data the feature reads from and/or writes to.
 * It can describe an entire datastore, a specific table/collection, or a
 * single field. The granularity is up to the modeler.
 *
 * All metadata is captured in one place so humans (and AI builders) can
 * reason about provenance, residency, sensitivity, compliance, and
 * authentication for every data touchpoint in the feature.
 */
export type Resource = {
  readonly id: ResourceId;
  readonly name: string;
  readonly description?: string;

  // What kind of store / interface this is.
  readonly kind: ResourceKind;
  // Free-text vendor / technology label: "Postgres", "MongoDB Atlas",
  // "AWS S3", "Stripe", "IndexedDB", "Local Storage", etc.
  readonly provider: string;
  // Where it physically lives. Important for residency / EU compliance.
  readonly scope: ResourceScope;
  // Free-text region / location: "eu-west-1 (FR)", "Browser", "On-prem (DC1)".
  readonly location?: string;

  // Structural identity. Interpreted via `resourceTerminology(kind)`.
  // For relational: database / table / column.
  // For document: database / collection / field.
  // For object: bucket / prefix / object key. etc.
  readonly database?: string;
  readonly container?: string;
  readonly field?: string;

  // Compliance + sensitivity.
  readonly sensitivity: ResourceSensitivity;
  readonly containsPii: boolean;
  readonly complianceTags: readonly string[];

  // Operational metadata.
  readonly accessMode: AccessMode;
  readonly authentication?: AuthenticationMethod;
  readonly encryptionAtRest?: boolean;
  readonly encryptionInTransit?: boolean;
  readonly retention?: string; // free text: "30 days", "7 years", "indefinite"
  readonly owner?: string; // team / person who owns this resource
};
