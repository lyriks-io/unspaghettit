import { describe, expect, it } from 'vitest';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import { scoreSurface } from '$features/maturity/domain/MaturityScorer';
import { inMemoryBlueprintRepository } from './InMemoryBlueprintRepository';

let counter = 0;
const ids = () => `lib-${counter++}`;

describe('library. Every blueprint scores 100% maturity in isolation', () => {
  for (const blueprint of inMemoryBlueprintRepository.list()) {
    it(`${blueprint.name} (${blueprint.category} / ${blueprint.surfaceType})`, () => {
      counter = 0;
      const result = blueprint.build({
        ids,
        ownSurfaceId: asSurfaceId('isolated'),
        linkTargets: new Map()
      });
      const report = scoreSurface(result.surface);
      expect(
        report.percentage,
        `failures: ${report.criticalIssues
          .concat(report.recommendedIssues)
          .map((i) => `${i.area}: ${i.message}`)
          .join('; ')}`
      ).toBe(100);
    });
  }
});
