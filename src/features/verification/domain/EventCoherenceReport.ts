/**
 * Cross-feature event wiring, checked across a whole project rather than one
 * feature at a time. The simulator already RESOLVES cross-feature cascades at
 * run time (a handler in feature B reacting to an event emitted in feature A);
 * this is the STATIC dual — it finds wiring that can never fire because nothing
 * in the project emits the event a handler waits on. A per-feature check can't
 * see this: the emitter might live in a sibling feature, so "dead" is only
 * decidable with the project in view.
 */
export type EventHandlerFinding = {
  readonly featureId: string;
  readonly featureName: string;
  readonly surfaceId: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly event: string;
};

export type EventCoherenceReport = {
  /**
   * Event handlers (`triggeredByEvent`) whose event is emitted by NO action
   * anywhere in the cohort — dead within the model. Advisory: the event could
   * still be emitted by runtime code outside the spec, so callers warn rather
   * than fail.
   */
  readonly deadHandlers: readonly EventHandlerFinding[];
};
