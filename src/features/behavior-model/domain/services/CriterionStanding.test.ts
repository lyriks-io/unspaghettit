import { describe, expect, it } from 'vitest';
import type { AcceptanceCriterion } from '$features/behavior-model/domain/entities/AcceptanceCriterion';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asAcceptanceCriterionId, asFeatureId } from '$features/behavior-model/domain/value-objects/ids';
import {
  criterionStandings,
  criterionStandingWarnings,
  effectiveCriterionStatus,
  standingLine
} from './CriterionStanding';

const criterion = (id: string, over: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion => ({
  id: asAcceptanceCriterionId(id),
  title: `Criterion ${id}`,
  given: '',
  when: '',
  then: '',
  expectedOutcome: 'success',
  ...over
});

const feature = (criteria: readonly AcceptanceCriterion[]): Feature => ({
  id: asFeatureId('audio'),
  name: 'Footsteps',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  acceptanceCriteria: criteria,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
});

const byId = (f: Feature) => Object.fromEntries(criterionStandings(f).map((s) => [s.criterionId, s]));

describe('effectiveCriterionStatus', () => {
  it('reads a criterion that says nothing as active', () => {
    expect(effectiveCriterionStatus({})).toBe('active');
    expect(effectiveCriterionStatus({ status: 'draft' })).toBe('draft');
  });
});

describe('standingLine', () => {
  it('spells the five cases a reader can meet', () => {
    expect(standingLine('active', [])).toBe('active');
    expect(standingLine('draft', ['x'])).toBe('draft');
    expect(standingLine('superseded', ['b', 'c'])).toBe('superseded by b, c');
    expect(standingLine('superseded', [])).toBe('superseded (no successor named)');
    expect(standingLine('active', ['b'])).toBe('active, but superseded by b');
  });
});

describe('criterionStandings', () => {
  it('derives supersededBy from the relations the successors declare', () => {
    // The field report: water silenced footsteps, then two later criteria
    // brought shallow-water footsteps back, and the first still read as current.
    const f = feature([
      criterion('silent', { status: 'superseded' }),
      criterion('shallow', { relations: [{ kind: 'supersedes', criterionId: 'silent' }] }),
      criterion('wading', { relations: [{ kind: 'supersedes', criterionId: 'silent' }] })
    ]);
    const standings = byId(f);
    expect(standings.silent).toMatchObject({
      status: 'superseded',
      supersededBy: ['shallow', 'wading'],
      standing: 'superseded by shallow, wading',
      contested: false
    });
    expect(standings.shallow).toMatchObject({ supersededBy: [], standing: 'active' });
    expect(criterionStandingWarnings(f)).toEqual([]);
  });

  it('never sets a status: a replaced criterion left active is contested, and says so', () => {
    const f = feature([
      criterion('silent'),
      criterion('shallow', { relations: [{ kind: 'supersedes', criterionId: 'silent' }] })
    ]);
    expect(byId(f).silent).toMatchObject({
      status: 'active',
      supersededBy: ['shallow'],
      standing: 'active, but superseded by shallow',
      contested: true
    });
    const warnings = criterionStandingWarnings(f);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('silent');
    expect(warnings[0]).toContain('shallow supersedes it');
    // The model itself was not touched.
    expect(f.acceptanceCriteria![0]!.status).toBeUndefined();
  });

  it('lets only supersedes replace: refines and exception_to leave the target standing', () => {
    const f = feature([
      criterion('silent'),
      criterion('deep', { relations: [{ kind: 'refines', criterionId: 'silent' }] }),
      criterion('ice', { relations: [{ kind: 'exception_to', criterionId: 'silent' }] })
    ]);
    expect(byId(f).silent).toMatchObject({ supersededBy: [], standing: 'active' });
  });

  it('does not count a draft as a successor: a proposal replaces nothing yet', () => {
    const f = feature([
      criterion('silent'),
      criterion('shallow', {
        status: 'draft',
        relations: [{ kind: 'supersedes', criterionId: 'silent' }]
      })
    ]);
    expect(byId(f).silent).toMatchObject({ supersededBy: [], standing: 'active' });
    expect(byId(f).shallow!.standing).toBe('draft');
    expect(criterionStandingWarnings(f)).toEqual([]);
  });

  it('ignores a relation that points into another feature', () => {
    const f = feature([
      criterion('silent'),
      criterion('shallow', {
        relations: [{ kind: 'supersedes', criterionId: 'silent', featureId: 'another-feature' }]
      })
    ]);
    expect(byId(f).silent!.supersededBy).toEqual([]);
  });

  it('says a criterion marked superseded with nobody naming it has no successor', () => {
    expect(byId(feature([criterion('old', { status: 'superseded' })])).old!.standing).toBe(
      'superseded (no successor named)'
    );
  });

  it('answers an empty list for a feature written before criteria existed', () => {
    const legacy = { ...feature([]), acceptanceCriteria: undefined } as Feature;
    expect(criterionStandings(legacy)).toEqual([]);
    expect(criterionStandingWarnings(legacy)).toEqual([]);
  });
});
