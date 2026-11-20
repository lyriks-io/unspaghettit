import { describe, expect, it } from 'vitest';
import { InMemoryFeatureRepository } from '../../infrastructure/persistence/InMemoryFeatureRepository';
import { InMemoryImplementationStatusRepository } from '$features/implementation-status/infrastructure/persistence/InMemoryImplementationStatusRepository';
import { scoreFeature, scoreFeatureBreakdown } from '$features/maturity/domain/MaturityScorer';
import {
  disableElement,
  operativeFeature
} from '../../domain/services/DisabledElements';
import { VALIDATION, validationFeature } from '../../domain/services/DisabledElements.fixture';
import { getFeatureCardUseCase } from './GetFeatureCard';
import { listFeaturesWithMaturityUseCase } from './ListFeaturesWithMaturity';
import { asFeatureId } from '../../domain/value-objects/ids';

/**
 * Every reading of the maturity leaves the disabled elements out: the
 * dashboard's feature cards, the digest and the panels included, not only
 * score_feature and the batch answers, which loaded the operative model.
 */

const ruleOff = () =>
  disableElement(validationFeature(), VALIDATION.viewerRule, {
    by: 'Adrien',
    at: '2026-11-18T10:00:00.000Z',
    reason: 'The viewer rule waits for the new roles.'
  });

const setup = async () => {
  const repository = new InMemoryFeatureRepository();
  await repository.save(ruleOff());
  const statusRepository = new InMemoryImplementationStatusRepository();
  return { repository, statusRepository };
};

describe('the maturity of a feature card', () => {
  it('leaves the disabled elements out, as score_feature does', async () => {
    const deps = await setup();
    const operative = scoreFeature(operativeFeature(ruleOff())).percentage;
    // The fixture scores differently with the rule in force, or this proves nothing.
    expect(operative).not.toBe(scoreFeature(validationFeature()).percentage);
    const [card] = await listFeaturesWithMaturityUseCase(deps)();
    expect(card?.maturityPercentage).toBe(operative);
    const one = await getFeatureCardUseCase(deps)(asFeatureId(VALIDATION.feature));
    expect(one?.maturityPercentage).toBe(operative);
  });
});

describe('the maturity scorer', () => {
  it('scores the operative model whatever model it is given, the breakdown included', () => {
    const operative = scoreFeature(operativeFeature(ruleOff()));
    expect(scoreFeature(ruleOff())).toEqual(operative);
    expect(scoreFeatureBreakdown(ruleOff()).global.percentage).toBe(operative.percentage);
  });
});
