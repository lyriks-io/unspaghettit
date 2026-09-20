import { describe, expect, it } from 'vitest';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import { buildCriteriaIndexReport, readVerification } from './_criteria-index';

const feature = {
  id: 'f1',
  name: 'Footsteps',
  surfaces: [],
  acceptanceCriteria: [
    { id: 'silent', title: 'Footsteps are silent in water', status: 'superseded' },
    {
      id: 'shallow',
      title: 'Shallow water is audible',
      relations: [{ kind: 'supersedes', criterionId: 'silent' }]
    },
    { id: 'wading', title: 'Wading is louder than walking' },
    { id: 'ice', title: 'Ice cracks under a run' },
    { id: 'mud', title: 'Mud muffles every step' }
  ]
} as unknown as Feature;

const result = (passed: boolean) => ({ passed, at: '2026-09-20T10:00:00.000Z' });

describe('readVerification', () => {
  it('keeps a well formed block as written', () => {
    const block = {
      kind: 'measurement',
      command: 'node scripts/measure-footsteps.mjs',
      files: ['scripts/measure-footsteps.mjs'],
      artifacts: ['out/footsteps.csv'],
      lastResult: { passed: true, at: '2026-09-20T10:00:00.000Z', summary: '6/6', revision: 'abc1234' }
    };
    expect(readVerification(block)).toEqual({ verification: block, problems: [] });
  });

  it('answers nothing, and no problem, for an entry that carries no block', () => {
    expect(readVerification(undefined)).toEqual({ problems: [] });
  });

  it('drops a block whose kind is unusable, and says why', () => {
    const { verification, problems } = readVerification({ kind: 'vibes', lastResult: result(true) });
    expect(verification).toBeUndefined();
    expect(problems.join()).toContain('"verification.kind" must be one of');
  });

  it('keeps the rest of a block whose lastResult is unreadable, which then reads as unverified', () => {
    const { verification, problems } = readVerification({
      kind: 'unit',
      files: 'not-a-list',
      lastResult: { passed: 'yes' }
    });
    expect(verification).toEqual({ kind: 'unit' });
    expect(problems).toHaveLength(2);
  });
});

describe('buildCriteriaIndexReport', () => {
  const index = {
    'criterion:silent': { status: 'implemented', file: 'old.test.ts', verification: { kind: 'unit', lastResult: result(true) } },
    'criterion:shallow': { file: 'shallow.test.ts', verification: { kind: 'e2e', lastResult: result(false) } },
    'criterion:wading': { file: 'wading.test.ts', verification: { kind: 'manual' } },
    'criterion:ice': { file: 'ice.test.ts', verification: { kind: 'unit', lastResult: { passed: 'yes' } } },
    'action:a1b2c3d4': { status: 'implemented', file: 'x.ts', line: 1, signature: 'x' }
  };

  it('counts verified, failing and unverified among the indexed criteria', () => {
    const report = buildCriteriaIndexReport([feature], index);
    expect(report).toMatchObject({ total: 5, indexed: 4, verified: 1, failing: 1, unverified: 2 });
    // verified + failing + unverified always add up to indexed.
    expect(report.verified + report.failing + report.unverified).toBe(report.indexed);
  });

  it('lists every criterion with its computed standing, indexed or not', () => {
    const rows = Object.fromEntries(
      buildCriteriaIndexReport([feature], index).entries.map((row) => [row.criterionId, row])
    );
    expect(rows.silent).toMatchObject({
      key: 'criterion:silent',
      title: 'Footsteps are silent in water',
      standing: 'superseded by shallow',
      indexed: true,
      file: 'old.test.ts'
    });
    expect(rows.shallow!.verification?.lastResult?.passed).toBe(false);
    expect(rows.mud).toEqual({
      key: 'criterion:mud',
      criterionId: 'mud',
      title: 'Mud muffles every step',
      standing: 'active',
      indexed: false
    });
  });

  it('reports a malformed block without throwing, and reads that criterion as unverified', () => {
    const report = buildCriteriaIndexReport([feature], index);
    expect(report.malformed.map((m) => m.key)).toEqual(['criterion:ice']);
    const ice = report.entries.find((row) => row.criterionId === 'ice');
    expect(ice?.verification).toEqual({ kind: 'unit' });
  });

  it('answers zeros for a project without criteria', () => {
    const bare = { id: 'f2', name: 'Bare', surfaces: [] } as unknown as Feature;
    expect(buildCriteriaIndexReport([bare], index)).toEqual({
      total: 0,
      indexed: 0,
      verified: 0,
      failing: 0,
      unverified: 0,
      entries: [],
      malformed: []
    });
  });
});
