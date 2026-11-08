import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineFingerprint } from './fingerprint';
import { KERNEL_API, proverKernel } from './kernel';
import type { Prover } from './ProverPort';
import { unavailableProver } from './unavailableProver';

/**
 * Whether this engine proves, and with what. UNSPA_PROVER names the proof
 * module (a package name or a path); unset, the engine proves nothing and says
 * nothing about proofs. A module that cannot be loaded, or was built for
 * another KERNEL_API, is not used: every place that would show a proof says
 * that the solver did not start, and why.
 */
export type ProverLoad =
  | { readonly state: 'not-asked' }
  | { readonly state: 'loaded'; readonly prover: Prover }
  | { readonly state: 'failed'; readonly module: string; readonly reason: string };

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..', '..', '..');
const requireHere = createRequire(join(engineRoot, 'package.json'));

const engineVersion = (): string => {
  try {
    return (requireHere('./package.json') as { version: string }).version;
  } catch {
    return '';
  }
};

const isProver = (value: unknown): value is Prover =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Prover).attach === 'function' &&
  typeof (value as Prover).verdictProof === 'function';

/** Load and attach the module UNSPA_PROVER names. */
export const loadProverFrom = (env: NodeJS.ProcessEnv): ProverLoad => {
  const name = env.UNSPA_PROVER?.trim();
  if (!name || name.toLowerCase() === 'off') return { state: 'not-asked' };
  let exported: unknown;
  try {
    const resolved = requireHere.resolve(name, { paths: [process.cwd(), engineRoot] });
    exported = requireHere(resolved);
  } catch (error) {
    return {
      state: 'failed',
      module: name,
      reason: `the proof module ${name} could not be loaded (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`
    };
  }
  const candidate = (exported as { prover?: unknown; default?: unknown }).prover ??
    (exported as { default?: unknown }).default;
  if (!isProver(candidate)) {
    return { state: 'failed', module: name, reason: `${name} is not a proof module` };
  }
  const engine = engineVersion();
  if (candidate.kernelApi !== KERNEL_API) {
    return {
      state: 'failed',
      module: name,
      reason: `the proof module ${candidate.name} ${candidate.version} was built for engine contract ${candidate.kernelApi}, and this engine (unspaghettit ${engine}) offers contract ${KERNEL_API}`
    };
  }
  try {
    candidate.attach({
      kernel: proverKernel,
      kernelEntry: join(here, 'kernel.ts'),
      runtimeEntry: join(engineRoot, 'cli', '_runtime.cjs'),
      engineVersion: engine,
      engineFingerprint: engineFingerprint()
    });
  } catch (error) {
    return {
      state: 'failed',
      module: name,
      reason: `the proof module ${candidate.name} ${candidate.version} did not start (${error instanceof Error ? error.message : String(error)})`
    };
  }
  return { state: 'loaded', prover: candidate };
};

let current: ProverLoad | null = null;

/** The proof module of this process, loaded on first use. */
export const proverLoad = (): ProverLoad => (current ??= loadProverFrom(process.env));

/** The loaded module, or null where none proves. */
export const loadedProver = (): Prover | null => {
  const load = proverLoad();
  return load.state === 'loaded' ? load.prover : null;
};

/**
 * The module every proof goes through: the loaded one, one that answers that
 * the solver did not start where the module asked for did not load, or null
 * where none was asked for (the engine then says nothing about proofs).
 */
export const activeProver = (load: ProverLoad = proverLoad()): Prover | null =>
  load.state === 'loaded'
    ? load.prover
    : load.state === 'failed'
      ? unavailableProver(load.module, load.reason)
      : null;

/** Use this load instead of UNSPA_PROVER's (tests, and a host that loads the module itself). */
export const useProverLoad = (load: ProverLoad | null): void => {
  current = load;
};

/** Load and attach a module the caller already holds (tests). */
export const attachProver = (prover: Prover): ProverLoad => {
  prover.attach({
    kernel: proverKernel,
    kernelEntry: join(here, 'kernel.ts'),
    runtimeEntry: join(engineRoot, 'cli', '_runtime.cjs'),
    engineVersion: engineVersion(),
    engineFingerprint: engineFingerprint()
  });
  return { state: 'loaded', prover };
};
