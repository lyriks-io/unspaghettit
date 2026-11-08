import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KERNEL_API } from './kernel';
import { activeProver, loadProverFrom } from './loadProver';

// Criteria 922ee1bd, f0c19aec: the engine proves only through the module UNSPA_PROVER
// names, and never with one built for another contract.
const moduleFile = (body: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'unspa-prover-')), 'index.cjs');
  writeFileSync(file, body);
  return file;
};

const fakeProver = (kernelApi: number) =>
  moduleFile(`
let attached = null;
exports.prover = {
  name: '@lyriks/unspa-prover', version: '9.9.9', kernelApi: ${kernelApi},
  attach: (engine) => { attached = engine; },
  attached: () => attached,
  storeProofsIn() {}, status: () => ({ kind: 'native', version: '5.1.0' }),
  verdictProof: async () => null, specGaps: async () => null, explorationAid: async () => null,
  tools: () => [], shutdown() {}
};`);

describe('loading the proof module', () => {
  it('loads none where none is named, and says nothing about proofs', () => {
    expect(loadProverFrom({})).toEqual({ state: 'not-asked' });
    expect(loadProverFrom({ UNSPA_PROVER: ' off ' })).toEqual({ state: 'not-asked' });
    expect(activeProver({ state: 'not-asked' })).toBeNull();
  });

  it('loads the module named and hands it the kernel, its entry and the runtime', () => {
    const load = loadProverFrom({ UNSPA_PROVER: fakeProver(KERNEL_API) });
    expect(load.state).toBe('loaded');
    if (load.state !== 'loaded') return;
    const attached = (load.prover as unknown as { attached: () => Record<string, unknown> }).attached();
    expect((attached.kernel as { api: number }).api).toBe(KERNEL_API);
    expect(String(attached.kernelEntry)).toMatch(/src[/\\]features[/\\]prover[/\\]kernel\.ts$/);
    expect(String(attached.runtimeEntry)).toMatch(/cli[/\\]_runtime\.cjs$/);
    expect(attached.engineFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a module built for another engine contract, naming both versions', () => {
    const load = loadProverFrom({ UNSPA_PROVER: fakeProver(KERNEL_API + 1) });
    expect(load).toMatchObject({ state: 'failed' });
    if (load.state !== 'failed') return;
    expect(load.reason).toContain(`@lyriks/unspa-prover 9.9.9 was built for engine contract ${KERNEL_API + 1}`);
    expect(load.reason).toMatch(new RegExp(`this engine \\(unspaghettit [^)]*\\) offers contract ${KERNEL_API}`));
    // What stands in for it proves nothing and says why.
    expect(activeProver(load)?.status()).toEqual({ kind: 'none', reason: load.reason });
  });

  it('says why a module it cannot load, or that is not a proof module, proves nothing', () => {
    const missing = loadProverFrom({ UNSPA_PROVER: '/nowhere/unspa-prover' });
    expect(missing).toMatchObject({ state: 'failed', module: '/nowhere/unspa-prover' });
    const other = loadProverFrom({ UNSPA_PROVER: moduleFile('exports.prover = { name: "x" };') });
    expect(other).toMatchObject({ state: 'failed' });
    if (other.state === 'failed') expect(other.reason).toContain('is not a proof module');
  });
});
