import type {
  AdapterInvocation,
  AdapterResult,
  UnspaAdapter
} from '../adapter-contract';

/**
 * Hand-written adapter for the Counter fixture. Stands in for "your project's
 * real implementation" — a user would write something like this once and the
 * generator would call it for every scenario in every feature.
 *
 * Two implementations live behind a flag: `correctAdapter` matches the spec,
 * `buggyAdapter` deliberately mis-implements the Add action. The test suite
 * uses `correctAdapter` for the pass case; the deliberate-fail test uses
 * `buggyAdapter` to prove drift surfaces as a test failure.
 */

type CounterState = { counter: { value: number } };

const readCounterValue = (state: AdapterInvocation['initialState']): number => {
  const counter = state['counter'];
  if (counter && typeof counter === 'object') {
    const v = (counter as { value?: unknown }).value;
    if (typeof v === 'number') return v;
  }
  return 0;
};

const runAdd = (by: number, currentValue: number): AdapterResult => {
  if (by <= 0) {
    return {
      status: 'blocked',
      finalState: { counter: { value: currentValue } }
    };
  }
  const next: CounterState = { counter: { value: currentValue + by } };
  return { status: 'success', finalState: next };
};

const buggyRunAdd = (by: number, currentValue: number): AdapterResult => {
  // Drops the `by` value entirely and just increments by 1. Wrong on
  // purpose — proves the generated test catches drift between spec and code.
  if (by <= 0) {
    return {
      status: 'blocked',
      finalState: { counter: { value: currentValue } }
    };
  }
  return {
    status: 'success',
    finalState: { counter: { value: currentValue + 1 } }
  };
};

const invoke = (input: AdapterInvocation, impl: typeof runAdd): AdapterResult => {
  if (input.actionId !== 'add') {
    throw new Error(`Counter adapter only knows the "add" action, got "${input.actionId}".`);
  }
  const by = Number(input.parameters['by'] ?? 0);
  const currentValue = readCounterValue(input.initialState);
  return impl(by, currentValue);
};

export const adapter: UnspaAdapter = {
  invoke: (input) => invoke(input, runAdd)
};

export const buggyAdapter: UnspaAdapter = {
  invoke: (input) => invoke(input, buggyRunAdd)
};
