import type { StateDefinition } from '../entities/StateDefinition';
import {
  deepEqualValue,
  evaluateExpression,
  type Expression
} from '../value-objects/Expression';
import { readPath, writePath, type StateSnapshot, type StatePath } from '../value-objects/StatePath';

/**
 * A state path whose value is computed from an Expression rather than authored.
 * Derived from a StateDefinition that carries a `derived` expression.
 */
export type DerivedDef = {
  readonly path: StatePath;
  readonly expr: Expression;
};

/** Pull the derived (computed) definitions out of a surface's state schema. */
export const collectDerivedDefs = (
  definitions: readonly StateDefinition[]
): readonly DerivedDef[] => {
  const out: DerivedDef[] = [];
  for (const def of definitions) {
    if (def.derived !== undefined) out.push({ path: def.path, expr: def.derived });
  }
  return out;
};

/** Set of derived paths as plain strings — for "is this path computed?" checks. */
export const derivedPathSet = (defs: readonly DerivedDef[]): ReadonlySet<string> =>
  new Set(defs.map((d) => String(d.path)));

/**
 * Recompute every derived path from its Expression against `snapshot` and
 * return the updated snapshot. Derived values are a pure function of state, so
 * they evaluate with no parameter scope.
 *
 * Chained derivations (a derived value that reads another derived value) settle
 * via a bounded fixpoint: we re-run the whole set until nothing changes, capped
 * at `defs.length` passes (a linear chain needs at most that many, and a true
 * cycle simply stops at the cap with whatever it last produced rather than
 * looping forever).
 *
 * An expression that can't be evaluated (missing operand, divide-by-zero)
 * returns undefined; we leave the existing value (its `defaultValue` fallback)
 * in place rather than writing undefined and poisoning downstream reads.
 */
export const recomputeDerived = (
  snapshot: StateSnapshot,
  defs: readonly DerivedDef[]
): StateSnapshot => {
  if (defs.length === 0) return snapshot;
  let next = snapshot;
  for (let pass = 0; pass < defs.length; pass += 1) {
    let changed = false;
    for (const def of defs) {
      const value = evaluateExpression(def.expr, { snapshot: next, parameters: {} });
      if (value === undefined) continue;
      if (!deepEqualValue(readPath(next, def.path), value)) {
        next = writePath(next, def.path, value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
};
