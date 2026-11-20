import { describe, expect, it } from 'vitest';
import { generateScenarioSpec } from '../codegen';
import { disableElement } from '../../../src/features/behavior-model/domain/services/DisabledElements';
import {
  ADRIEN,
  VALIDATION,
  validationFeature
} from '../../../src/features/behavior-model/domain/services/DisabledElements.fixture';

describe('generateScenarioSpec with disabled elements', () => {
  it('writes the scenario of a disabled element skipped, saying who, when and why [criterion:ac-leaf-7c70d116-f395-4fd1-9e12-d41790f6e070]', () => {
    const feature = disableElement(validationFeature(), VALIDATION.viewerScenario, ADRIEN);
    const { code, scenarios } = generateScenarioSpec(feature);
    expect(code).toContain(`it.skip("[unspa:${VALIDATION.surface}:${VALIDATION.validate}:${VALIDATION.viewerScenario}]`);
    expect(code).toContain(`// Disabled by Adrien on ${ADRIEN.at}: ${ADRIEN.reason}`);
    expect(scenarios.find((s) => s.scenarioId === VALIDATION.viewerScenario)?.disabled).toMatchObject({ by: 'Adrien' });
    // The others are still written to run, predicted on the operative model.
    expect(code).toContain(`it("[unspa:${VALIDATION.surface}:${VALIDATION.validate}:${VALIDATION.editorScenario}]`);
  });

  it('predicts the scenarios in force without the disabled rule', () => {
    const feature = disableElement(validationFeature(), VALIDATION.viewerRule, ADRIEN);
    const { scenarios } = generateScenarioSpec(feature);
    const viewer = scenarios.find((s) => s.scenarioId === VALIDATION.viewerScenario)!;
    // The always-true statement still refuses the viewer, so no drift, but the rule played no part.
    expect(viewer.disabled).toBeUndefined();
    expect(viewer.simulatorStatus).toBe('blocked');
  });
});
