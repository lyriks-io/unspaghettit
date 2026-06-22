/**
 * The slice of a `.unspa.json` behavioral-index entry that the verification
 * context reasons about. The full on-disk entry (file, line, signature,
 * gitCommit, relatedFiles, …) lives in the CLI/MCP edge; the domain only owns
 * what it needs to judge drift — keeping this bounded context independent of
 * how the index is stored or transported (the adapters map their shape onto
 * this one). Reverse dependency: the domain declares the contract, the
 * infrastructure satisfies it.
 */
export type IndexedImplementationStatus = 'implemented' | 'partial' | 'missing';

export type IndexedImplementation = {
  /** `"<type>:<id-or-path>"`, e.g. `action:9af3...` or `state:cart.itemCount`. */
  readonly key: string;
  readonly status: IndexedImplementationStatus;
  /**
   * The owning feature's `updatedAt` (ISO) captured the last time this entity
   * was audited. Absent on entries written before drift tracking, or never
   * stamped — those can't be judged for drift, only reported as unversioned.
   */
  readonly auditedSpecVersion?: string;
  /**
   * ISO timestamp the entity's scenarios last passed against the real code
   * (`.unspa.json` `verifiedAt`). Present → "proven", not just "claimed".
   */
  readonly verifiedAt?: string;
};
