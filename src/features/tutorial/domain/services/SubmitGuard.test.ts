import { describe, expect, it } from 'vitest';
import { evaluateTourSubmitGuard } from './SubmitGuard';
import type { TourStep } from '../entities/TourStep';

const baseStep: TourStep = {
  id: 'fill-feature',
  title: 'Name the feature',
  body: '',
  advance: { kind: 'manual' }
};

describe('evaluateTourSubmitGuard', () => {
  it('returns not-blocked when no step is active', () => {
    const verdict = evaluateTourSubmitGuard(null, 'new-feature', 'anything');
    expect(verdict).toEqual({ blocked: false, requiredValue: null });
  });

  it('returns not-blocked when the active step has no requireExact', () => {
    const verdict = evaluateTourSubmitGuard(baseStep, 'new-feature', 'anything');
    expect(verdict).toEqual({ blocked: false, requiredValue: null });
  });

  it('returns not-blocked when the requireExact targets a different form', () => {
    const step: TourStep = {
      ...baseStep,
      requireExact: { formId: 'new-project', value: 'Hello World' }
    };
    const verdict = evaluateTourSubmitGuard(step, 'new-feature', 'Something');
    expect(verdict).toEqual({ blocked: false, requiredValue: null });
  });

  it('blocks when the typed value does not equal the required value', () => {
    const step: TourStep = {
      ...baseStep,
      requireExact: { formId: 'new-feature', value: 'Greeting' }
    };
    const verdict = evaluateTourSubmitGuard(step, 'new-feature', 'Hello');
    expect(verdict).toEqual({ blocked: true, requiredValue: 'Greeting' });
  });

  it('passes when the typed value equals the required value exactly', () => {
    const step: TourStep = {
      ...baseStep,
      requireExact: { formId: 'new-feature', value: 'Greeting' }
    };
    const verdict = evaluateTourSubmitGuard(step, 'new-feature', 'Greeting');
    expect(verdict).toEqual({ blocked: false, requiredValue: 'Greeting' });
  });

  it('trims surrounding whitespace before comparing', () => {
    const step: TourStep = {
      ...baseStep,
      requireExact: { formId: 'new-feature', value: 'Greeting' }
    };
    const verdict = evaluateTourSubmitGuard(step, 'new-feature', '  Greeting  ');
    expect(verdict.blocked).toBe(false);
  });

  it('is case-insensitive so "Hello world" passes "Hello World"', () => {
    const step: TourStep = {
      ...baseStep,
      requireExact: { formId: 'new-feature', value: 'Greeting' }
    };
    expect(evaluateTourSubmitGuard(step, 'new-feature', 'greeting').blocked).toBe(false);
    expect(evaluateTourSubmitGuard(step, 'new-feature', 'GREETING').blocked).toBe(false);
    expect(evaluateTourSubmitGuard(step, 'new-feature', 'GrEeTiNg').blocked).toBe(false);
  });
});
