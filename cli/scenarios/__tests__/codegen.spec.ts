import { describe, expect, it } from 'vitest';
import { generateScenarioSpec } from '../codegen';
import { adapter, buggyAdapter } from './adapter';
import { COUNTER_FEATURE } from './fixture';

describe('generateScenarioSpec (codegen)', () => {
  it('produces TS code for every scenario on the feature', () => {
    const { code, scenarios } = generateScenarioSpec(COUNTER_FEATURE);

    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((s) => s.scenarioName)).toEqual([
      'Add 1 to a fresh counter',
      'Add 5 to a counter already at 10',
      'Add 0 is blocked'
    ]);

    // Sanity: each scenario should agree with the simulator's prediction
    // (the fixture is built to be internally consistent).
    expect(scenarios.every((s) => !s.drift)).toBe(true);

    // The emitted code should mention each scenario name verbatim and import
    // from the configured adapter path.
    for (const s of scenarios) {
      expect(code).toContain(JSON.stringify(s.scenarioName));
    }
    expect(code).toContain('from "./unspa.adapter"');
    expect(code).toContain('describe(');
    expect(code).toContain('expect(');
  });

  it('lets callers retarget the adapter import', () => {
    const { code } = generateScenarioSpec(COUNTER_FEATURE, {
      adapterImportPath: '../adapter',
      adapterExportName: 'adapter'
    });
    expect(code).toContain('from "../adapter"');
  });

  it('counts assertions per scenario, distinguishing emitted from skipped', () => {
    const { scenarios } = generateScenarioSpec(COUNTER_FEATURE);
    const happy = scenarios.find((s) => s.scenarioName === 'Add 1 to a fresh counter');
    const blocked = scenarios.find((s) => s.scenarioName === 'Add 0 is blocked');
    expect(happy?.assertionsEmitted).toBe(1);
    expect(happy?.assertionsSkipped).toBe(0);
    // Blocked scenarios have no assertions authored, so neither emitted nor skipped.
    expect(blocked?.assertionsEmitted).toBe(0);
    expect(blocked?.assertionsSkipped).toBe(0);
  });
});

/**
 * End-to-end verification: take the generated code, evaluate it through
 * Function() with the test scope's bindings, and observe that every scenario
 * passes against the correct adapter and at least one fails against the buggy
 * adapter. Proves the wedge actually closes the loop.
 *
 * We can't `import` the generated code (it lives only in memory here), so we
 * dynamically eval it with the same shape Vitest's `it` block runs in. The
 * generated code uses `describe / it / expect / adapter` from outer scope; we
 * provide them via Function args.
 */
const evaluateGenerated = (
  code: string,
  scope: {
    readonly describe: typeof describe;
    readonly it: typeof it;
    readonly expect: typeof expect;
    readonly adapter: { readonly invoke: (...args: never[]) => unknown };
  }
): void => {
  // Strip imports — we'll inject the same identifiers via Function args.
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

describe('generated spec — pass-by-construction', () => {
  // Evaluating the generated code registers its own describe/it blocks inside
  // this outer describe. The correct adapter implements the spec, so every
  // generated test should pass.
  const { code } = generateScenarioSpec(COUNTER_FEATURE);
  evaluateGenerated(code, { describe, it, expect, adapter });
});

describe('generated spec — buggy adapter triggers drift', () => {
  // Same generated code, swapped to the buggy adapter. We expect the "Add 5
  // from 10" scenario to fail (buggy adds 1 instead of 5). We catch the
  // failure here and verify the runner's error message rather than letting
  // it bubble up — that way THIS file's test result reports "passed: caught
  // expected drift".
  const { code } = generateScenarioSpec(COUNTER_FEATURE);
  const failures: { name: string; error: unknown }[] = [];

  // Shim it/describe so we can run the generated tests synchronously here
  // and collect outcomes instead of registering them with Vitest.
  const shimIt = ((name: string, fn: () => unknown | Promise<unknown>) => {
    const result = (async () => {
      try {
        await fn();
      } catch (err) {
        failures.push({ name, error: err });
      }
    })();
    // We want assertions about the failures BELOW the shimmed run, so we
    // store the pending promise and await it in the it() block.
    pendingRuns.push(result);
  }) as typeof it;
  const shimDescribe = ((_name: string, fn: () => void) => fn()) as typeof describe;
  const pendingRuns: Promise<void>[] = [];

  evaluateGenerated(code, {
    describe: shimDescribe,
    it: shimIt,
    expect,
    adapter: buggyAdapter
  });

  it('catches the buggy implementation: "Add 5 from 10" fails, others pass', async () => {
    await Promise.all(pendingRuns);
    // Strip the [unspa:...] coverage token the codegen prepends to titles.
    const names = failures.map((f) => f.name.replace(/^\[unspa:[^\]]+\]\s*/, ''));
    expect(names).toEqual(['Add 5 to a counter already at 10']);
    const message = String((failures[0]?.error as { message?: unknown })?.message ?? '');
    expect(message).toMatch(/15/); // expected 15
    expect(message).toMatch(/11/); // actual: 10 + (buggy: +1) = 11
  });
});
