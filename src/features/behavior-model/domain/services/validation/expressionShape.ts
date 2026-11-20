import { EXPRESSION_KINDS } from '../../value-objects/Expression';

/**
 * What is malformed in a value slot that takes an Expression (a set_state
 * value, a condition's right side, a derived formula, ...), one sentence per
 * problem. The evaluator never refuses a malformed node, it answers "no value"
 * or reads it as a literal, so each of these used to be silent:
 *
 *  - an object whose `kind` names no expression (`"multiply"`, `"stat"`) is
 *    taken for a literal object: written as is into a number, or compared as
 *    an object, never computed;
 *  - an operator without one of its operands, a `sum_pluck` or `count_where`
 *    without its field, a `switch` without cases or without a default: the
 *    value is missing on every run and the effect writes nothing;
 *  - a `switch` case without `when` matches every time, so the cases after it
 *    never apply.
 *
 * An operand the normalizer filled as `{ kind: "literal" }` with no value is
 * read as missing, which is what it was.
 */
const KINDS = new Set<string>(EXPRESSION_KINDS);

type Node = Record<string, unknown>;

const isObject = (v: unknown): v is Node => v !== null && typeof v === 'object' && !Array.isArray(v);

const isMissing = (v: unknown): boolean =>
  v === undefined || (isObject(v) && v.kind === 'literal' && v.value === undefined);

export const expressionShapeProblems = (value: unknown): readonly string[] => {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (!isObject(v) || typeof v.kind !== 'string') return;
    const kind = v.kind;
    if (!KINDS.has(kind)) {
      out.push(
        `"${kind}" is not an expression kind (one of: ${EXPRESSION_KINDS.join(', ')}). An object literal that carries a "kind" field is written { kind: "literal", value: { ... } }.`
      );
      return;
    }
    const operand = (key: string, what: string): void => {
      if (isMissing(v[key])) out.push(`"${kind}" has no ${what}, so it never has a value.`);
      else visit(v[key]);
    };
    const field = (): void => {
      if (typeof v.field !== 'string' || v.field.length === 0) {
        out.push(`"${kind}" has no "field" naming what to read in each element, so it never has a value.`);
      }
    };
    switch (kind) {
      case 'literal':
      case 'state':
      case 'param':
      case 'const':
        // A missing literal value is reported where it is an operand; a
        // state, parameter or constant reference is checked by name elsewhere.
        return;
      case 'neg':
      case 'not':
      case 'sum':
      case 'count':
        operand('operand', '"operand"');
        return;
      case 'sum_pluck':
        operand('operand', '"operand"');
        field();
        return;
      case 'count_where':
        operand('operand', '"operand"');
        field();
        operand('equals', '"equals" value to count');
        return;
      case 'switch': {
        if (!Array.isArray(v.cases)) {
          out.push('"switch" has no "cases" list.');
        } else {
          v.cases.forEach((c, i) => {
            if (!isObject(c) || c.when === undefined || c.when === null) {
              out.push(`"switch" case ${i} has no "when": it matches every time, so the cases after it never apply.`);
            }
            if (isObject(c)) {
              if (isMissing(c.then)) out.push(`"switch" case ${i} has no "then" value.`);
              else visit(c.then);
            }
          });
        }
        if (isMissing(v.default)) {
          out.push('"switch" has no "default", so a run where no case matches gets no value and writes nothing.');
        } else {
          visit(v.default);
        }
        return;
      }
      default:
        // add, sub, mul, div, mod, min, max
        operand('left', '"left" operand');
        operand('right', '"right" operand');
    }
  };
  visit(value);
  return out;
};
