import type {
  AdapterInvocation,
  AdapterResult,
  UnspaAdapter
} from '../adapter-contract';

/**
 * Hand-written implementation of the BANKING_FEATURE actions. The point of the
 * stress test is to prove the codegen produces tests that actually agree with
 * a faithful implementation. Anything the simulator would block, this also
 * blocks; anything the simulator would succeed-with-effects, this returns the
 * same final state shape.
 */

const TRANSFER_STAMP = '2026-05-26';

const readNumber = (state: AdapterInvocation['initialState'], path: string): number => {
  let current: unknown = state;
  for (const seg of path.split('.')) {
    if (current === null || typeof current !== 'object') return 0;
    current = (current as Record<string, unknown>)[seg];
  }
  return typeof current === 'number' ? current : 0;
};

const readBool = (state: AdapterInvocation['initialState'], path: string): boolean => {
  let current: unknown = state;
  for (const seg of path.split('.')) {
    if (current === null || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[seg];
  }
  return current === true;
};

const readStringOrEmpty = (
  state: AdapterInvocation['initialState'],
  path: string
): string => {
  let current: unknown = state;
  for (const seg of path.split('.')) {
    if (current === null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[seg];
  }
  return typeof current === 'string' ? current : '';
};

const transfer = (input: AdapterInvocation): AdapterResult => {
  const amount = Number(input.parameters['amount'] ?? 0);
  const frozen = readBool(input.initialState, 'account.frozen');
  const balance = readNumber(input.initialState, 'account.balance');
  const tier = readStringOrEmpty(input.initialState, 'account.tier');
  const lastTransferAt = readStringOrEmpty(input.initialState, 'account.lastTransferAt');
  // The codegen embeds the simulator's post-defaults snapshot, so balance /
  // tier / lastTransferAt arrive already filled in — no need to mirror the
  // spec's defaultValues here. The strict less-than check matches the
  // simulator's `balance lower_than amount` rule (exactly equal does not
  // block; the spec deliberately treats "spend all your money" as legal).
  const blockedReason =
    frozen ? 'frozen'
    : amount <= 0 ? 'non-positive'
    : balance < amount ? 'insufficient'
    : null;

  if (blockedReason !== null) {
    return {
      status: 'blocked',
      finalState: { account: { balance, frozen, tier, lastTransferAt } }
    };
  }
  return {
    status: 'success',
    finalState: {
      account: {
        balance: balance - amount,
        frozen,
        tier,
        lastTransferAt: TRANSFER_STAMP
      }
    }
  };
};

const promote = (input: AdapterInvocation): AdapterResult => {
  const currentTier = readStringOrEmpty(input.initialState, 'account.tier') || 'standard';
  return {
    status: 'success',
    finalState: {
      account: { tier: 'gold', _previousTier: currentTier }
    }
  };
};

export const complexAdapter: UnspaAdapter = {
  invoke: (input) => {
    switch (input.actionId) {
      case 'transfer':
        return transfer(input);
      case 'promote':
        return promote(input);
      default:
        throw new Error(`Complex adapter does not know action "${input.actionId}".`);
    }
  }
};
