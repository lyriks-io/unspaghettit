import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import {
  disableElement,
  enableElement
} from '../../../src/features/behavior-model/domain/services/DisabledElements';
import type { Op, OpContext } from './opHelpers';

/** Who disabled an element when the op does not say: the standalone engine knows no person. */
const UNNAMED_AUTHOR = 'an MCP client';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The element an op names, by id or by a ref an earlier op of the batch set. */
const elementIdOf = (op: Op, ctx: OpContext): string => {
  const ref = text(op.elementRef);
  if (ref) {
    const id = ctx.refs[ref];
    if (!id) throw new Error(`unknown elementRef "${ref}": no earlier op of this batch set that ref`);
    return id;
  }
  const id = text(op.elementId).trim();
  if (!id) throw new Error(`${op.kind} requires elementId (or elementRef)`);
  return id;
};

/**
 * disable_element { elementId|elementRef, reason, by?, at? } and
 * enable_element { elementId|elementRef }: put an element aside and bring it
 * back, by id, keeping it in the model. `by` is who asked (the host that knows
 * the person stamps it); `at` defaults to the batch's clock. A refusal throws,
 * so the whole batch applies nothing.
 */
export const applyDisableOps = (op: Op, ctx: OpContext): Feature | null => {
  switch (op.kind) {
    case 'disable_element': {
      const at = text(op.at) || (ctx.now ? ctx.now() : new Date().toISOString());
      return disableElement(ctx.feature, elementIdOf(op, ctx), {
        by: text(op.by).trim() || UNNAMED_AUTHOR,
        at,
        reason: text(op.reason)
      });
    }
    case 'enable_element':
      return enableElement(ctx.feature, elementIdOf(op, ctx));
    default:
      return null;
  }
};
