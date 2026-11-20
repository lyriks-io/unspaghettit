/**
 * The marker a disabled element carries: who put it aside, when and why.
 *
 * A disabled element stays in the model under its id, with everything it holds
 * (its sources, its code places, its history), and reads as it always did. It
 * is only left out of every reading of the engine (simulation, scenarios, model
 * check, proofs, maturity, spec gaps, exports), which take the operative model
 * (see DisabledElements.operativeFeature). Removing the marker brings the
 * element back exactly as it was.
 */
export type Disabled = {
  /** Who disabled it: a person's name or email, or the client that asked. */
  readonly by: string;
  /** When, as an ISO 8601 instant. */
  readonly at: string;
  /** Why, in one line, shown beside the element. */
  readonly reason: string;
};
