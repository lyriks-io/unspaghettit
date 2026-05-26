/**
 * Public surface for the `unspa scenarios export` wedge. External tests built
 * by the generator import the adapter contract from this module, so the path
 * stays stable even when the internal layout shifts.
 *
 *   import type { UnspaAdapter } from 'unspaghettit/cli/scenarios';
 *
 * EXPERIMENTAL: the contract may evolve between minor versions until the
 * wedge graduates. Pin the dependency if CI depends on these tests.
 */

export type {
  AdapterInvocation,
  AdapterResult,
  UnspaAdapter,
  UnspaParameters,
  UnspaState
} from './adapter-contract';
