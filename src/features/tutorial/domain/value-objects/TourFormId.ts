/**
 * Identifier each tour-aware form publishes to opt into submit guards.
 *
 * Kept as a closed union (instead of `string`) so the tour author and
 * the form component must agree on a value the type system knows about
 * — a typo on either side is a compile error rather than a silent
 * runtime miss. Add a new form to the union before wiring its
 * `evaluateTourSubmitGuard(...)` call.
 */
export type TourFormId =
  | 'new-project'
  | 'new-feature'
  | 'blank-surface'
  | 'add-action';
