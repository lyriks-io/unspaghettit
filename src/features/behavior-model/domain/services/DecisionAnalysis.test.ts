import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Rule } from '../entities/Rule';
import { asActionId, asEffectId, asRuleId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { analyzeActionDecisions, type DecisionFindingKind } from './DecisionAnalysis';

let seq = 0;
const rule = (partial: Partial<Rule> & Pick<Rule, 'effect'>): Rule => ({
  id: asRuleId(`r${seq++}`),
  category: 'business',
  ...partial
});

const action = (rules: readonly Rule[]): Action => ({
  id: asActionId('a'),
  name: 'Decide',
  intent: 'decide',
  parameters: [],
  requiredStates: [],
  rules,
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
});

const setState = (path: string, value: unknown) =>
  ({ id: asEffectId(`e${seq++}`), type: 'set_state' as const, path: asStatePath(path), value: value as never });
const block = () => ({ id: asEffectId(`e${seq++}`), type: 'block_action' as const, reason: 'no' });
const allow = () => ({ id: asEffectId(`e${seq++}`), type: 'allow_action' as const });

const kinds = (a: Action): DecisionFindingKind[] =>
  analyzeActionDecisions(a).map((f) => f.kind);

describe('analyzeActionDecisions', () => {
  it('is silent on a clean, mutually-exclusive rule set', () => {
    const a = action([
      rule({
        condition: { left: asStatePath('mode'), operator: 'equals', right: 'a' },
        effect: setState('out', 1)
      }),
      rule({
        condition: { left: asStatePath('mode'), operator: 'equals', right: 'b' },
        effect: setState('out', 2)
      })
    ]);
    expect(analyzeActionDecisions(a)).toEqual([]);
  });

  it('flags a condition that requires one path to equal two literals', () => {
    const a = action([
      rule({
        condition: {
          kind: 'all',
          conditions: [
            { left: asStatePath('x'), operator: 'equals', right: 1 },
            { left: asStatePath('x'), operator: 'equals', right: 2 }
          ]
        },
        effect: setState('out', 1)
      })
    ]);
    expect(kinds(a)).toEqual(['dead-rule']);
  });

  it('flags is_true AND is_false on the same path as dead', () => {
    const a = action([
      rule({
        condition: {
          kind: 'all',
          conditions: [
            { left: asStatePath('flag'), operator: 'is_true' },
            { left: asStatePath('flag'), operator: 'is_false' }
          ]
        },
        effect: allow()
      })
    ]);
    expect(kinds(a)).toEqual(['dead-rule']);
  });

  it('does not claim contradiction across an any branch', () => {
    const a = action([
      rule({
        condition: {
          kind: 'any',
          conditions: [
            { left: asStatePath('x'), operator: 'equals', right: 1 },
            { left: asStatePath('x'), operator: 'equals', right: 2 }
          ]
        },
        effect: setState('out', 1)
      })
    ]);
    expect(analyzeActionDecisions(a)).toEqual([]);
  });

  it('flags two rules that disagree on the same condition', () => {
    const a = action([
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: allow()
      }),
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: block()
      })
    ]);
    expect(kinds(a)).toEqual(['conflicting-rules']);
  });

  it('flags an exact duplicate rule as redundant', () => {
    const a = action([
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: setState('out', 1)
      }),
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: setState('out', 1)
      })
    ]);
    expect(kinds(a)).toEqual(['redundant-rule']);
  });

  it('does not flag same-condition rules that write different paths', () => {
    const a = action([
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: setState('a', 1)
      }),
      rule({
        condition: { left: asStatePath('role'), operator: 'equals', right: 'admin' },
        effect: setState('b', 1)
      })
    ]);
    expect(analyzeActionDecisions(a)).toEqual([]);
  });

  it('flags an unconditional block and the rules it shadows', () => {
    const a = action([
      rule({ effect: block() }),
      rule({ effect: setState('out', 1) })
    ]);
    expect(kinds(a).sort()).toEqual(['always-blocked', 'shadowed-rule']);
  });

  it('does not report a conflict against a dead rule', () => {
    const a = action([
      rule({
        condition: {
          kind: 'all',
          conditions: [
            { left: asStatePath('x'), operator: 'is_true' },
            { left: asStatePath('x'), operator: 'is_false' }
          ]
        },
        effect: allow()
      }),
      rule({
        condition: {
          kind: 'all',
          conditions: [
            { left: asStatePath('x'), operator: 'is_true' },
            { left: asStatePath('x'), operator: 'is_false' }
          ]
        },
        effect: block()
      })
    ]);
    // Both rules are dead; no live conflict should be reported between them.
    expect(kinds(a)).toEqual(['dead-rule', 'dead-rule']);
  });
});
