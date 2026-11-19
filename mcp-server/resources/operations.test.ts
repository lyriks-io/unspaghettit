import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '../../src/features/behavior-model/infrastructure/seed/seedStorefront';
import { applyOps } from '../tools/batch-ops/applyOps';
import { knownOpKinds, OPERATIONS_REFERENCE } from './operations';

/** The excerpt a client gets for one op: its signature line and the `. ` notes under it. */
const excerptOf = (op: string): string => {
  const lines = OPERATIONS_REFERENCE.split('\n');
  const at = lines.findIndex((line) => line.trimStart().startsWith(`${op} `));
  const notes: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('. ')) break;
    notes.push(line);
  }
  return [lines[at], ...notes].join('\n');
};

describe('operations reference (criterion 15c748b2)', () => {
  it('says under add_effect that every effect and every rule carries a mandatory description', () => {
    const excerpt = excerptOf('add_effect');
    expect(excerpt).toContain('Every effect carries a mandatory `description`');
    expect(excerpt).toContain('the `effect` of a rule');
    expect(excerpt).toContain('Every rule (add_action_rule, add_surface_rule)');
  });

  it('keeps the description in the add_action_rule signature', () => {
    expect(excerptOf('add_action_rule')).toContain('effect:{type,..., description}, description');
  });
});

describe('operations reference against apply_batch', () => {
  it('documents only op kinds that apply_batch knows', () => {
    let n = 0;
    const unknown = knownOpKinds().filter((kind) => {
      try {
        // Without its arguments every op is refused, but by its own handler:
        // only a kind no handler claims is refused as unknown.
        applyOps(storefrontFeature, [{ kind }], () => `op-${n++}`);
        return false;
      } catch (e) {
        return (e as Error).message.includes('unknown op kind');
      }
    });
    expect(knownOpKinds().length).toBeGreaterThan(40);
    expect(unknown).toEqual([]);
  });
});
