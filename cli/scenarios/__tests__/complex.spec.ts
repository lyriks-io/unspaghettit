import { describe, expect, it } from 'vitest';
import { generateScenarioSpec } from '../codegen';
import { complexAdapter } from './complex-adapter';
import { BANKING_FEATURE } from './complex-fixture';

const evaluateGenerated = (
  code: string,
  scope: {
    readonly describe: typeof describe;
    readonly it: typeof it;
    readonly expect: typeof expect;
    readonly adapter: { readonly invoke: (...args: never[]) => unknown };
  }
): void => {
  const stripped = code
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('import '))
    .join('\n');
  // eslint-disable-next-line no-new-func
  const runner = new Function(
    'describe',
    'it',
    'expect',
    'adapter',
    stripped
  ) as (
    d: typeof describe,
    i: typeof it,
    e: typeof expect,
    a: typeof scope.adapter
  ) => void;
  runner(scope.describe, scope.it, scope.expect, scope.adapter);
};

describe('stress test: complex Banking feature', () => {
  const { code, scenarios } = generateScenarioSpec(BANKING_FEATURE);

  it('emits one scenario per authored scenario (6 across two surfaces)', () => {
    expect(scenarios).toHaveLength(6);
    expect(scenarios.map((s) => s.scenarioName)).toEqual([
      'Premium user transfers 100 successfully',
      'Frozen account cannot transfer',
      'Negative amount blocked',
      'DRIFT: author claims success on overdraft',
      'Expression-valued assertion gets skipped at codegen',
      'Promote sets tier to gold'
    ]);
  });

  it('flags exactly the drift scenario', () => {
    const drifters = scenarios.filter((s) => s.drift);
    expect(drifters).toHaveLength(1);
    expect(drifters[0]?.scenarioName).toBe('DRIFT: author claims success on overdraft');
    expect(drifters[0]?.authoredStatus).toBe('success');
    expect(drifters[0]?.simulatorStatus).toBe('blocked');
  });

  it('drops assertions authored on a blocked scenario', () => {
    const frozen = scenarios.find((s) => s.scenarioName === 'Frozen account cannot transfer');
    // The fixture authored 1 expectedAssertion on this blocked scenario.
    // Codegen MUST emit 0 (because the action gets blocked, asserting on
    // post-effect state is meaningless) and count it under skipped.
    expect(frozen?.assertionsEmitted).toBe(0);
    expect(frozen?.assertionsSkipped).toBe(1);
    // And the rendered code must NOT contain the bogus assertion path.
    expect(code).not.toMatch(
      /describe\("Transfer"[\s\S]*"Frozen account cannot transfer"[\s\S]*account\.balance.*1000/
    );
  });

  it('skips Expression-valued assertions with a comment, keeps literals', () => {
    const expr = scenarios.find(
      (s) => s.scenarioName === 'Expression-valued assertion gets skipped at codegen'
    );
    expect(expr?.assertionsEmitted).toBe(1); // the literal
    expect(expr?.assertionsSkipped).toBe(1); // the Expression
    expect(code).toContain('[skipped]');
  });

  it('emits assertions covering every operator used in the fixture', () => {
    // Pulled from the premium-transfer scenario: equals, not_equals,
    // is_false, greater_than, lower_than, exists, does_not_exist. The promote
    // scenario adds not_equals on a string. Every emitter switch arm should
    // appear in the generated code.
    expect(code).toContain('.toEqual(900)');
    expect(code).toContain('.not.toEqual("")');
    expect(code).toContain('.toBe(false)');
    expect(code).toContain('.toBeGreaterThan(800)');
    expect(code).toContain('.toBeLessThan(1000)');
    expect(code).toContain('.not.toBeUndefined()');
    expect(code).toContain('.toBeUndefined()');
  });

  it('renders both surfaces with their actions nested inside', () => {
    expect(code).toContain('Surface: Account');
    expect(code).toContain('Surface: Tier');
    expect(code).toContain('"Transfer"');
    expect(code).toContain('"Promote to gold"');
  });

  it('embeds persona metadata in the invocation payload', () => {
    // The premium scenario has personaId/personaName populated on the call.
    expect(code).toContain('personaId: "persona-premium"');
    expect(code).toContain('personaName: "Premium user"');
    // The negative-amount scenario has no persona — should be null literals.
    expect(code).toContain('personaId: null');
  });
});

describe('stress test: generated spec against faithful adapter', () => {
  // 5 of 6 scenarios should pass — only the drift case fails, and that's the
  // whole point: a faithful implementation can't satisfy an inconsistent spec.
  const { code } = generateScenarioSpec(BANKING_FEATURE);
  const failures: { name: string; error: unknown }[] = [];
  const pendingRuns: Promise<void>[] = [];

  const shimIt = ((name: string, fn: () => unknown | Promise<unknown>) => {
    const result = (async () => {
      try {
        await fn();
      } catch (err) {
        failures.push({ name, error: err });
      }
    })();
    pendingRuns.push(result);
  }) as typeof it;
  const shimDescribe = ((_name: string, fn: () => void) => fn()) as typeof describe;

  evaluateGenerated(code, {
    describe: shimDescribe,
    it: shimIt,
    expect,
    adapter: complexAdapter
  });

  it('5 of 6 scenarios pass; only the drift case fails', async () => {
    await Promise.all(pendingRuns);
    const failedNames = failures.map((f) => f.name);
    expect(failedNames).toEqual(['DRIFT: author claims success on overdraft']);
    // The failure message should call out the status mismatch.
    const message = String((failures[0]?.error as { message?: unknown })?.message ?? '');
    expect(message.toLowerCase()).toMatch(/expected.*success.*blocked|blocked.*success/);
  });
});
