import {
  actionContextOf,
  earsOfEffect,
  earsOfGoal,
  earsOfInvariant,
  earsOfRule,
  featureConstants,
  featureLanguage,
  featureProperNames
} from '$features/behavior-model/domain/services/requirementSentences';
import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';

/**
 * The EARS sentence of each element the editor shows, read from the feature
 * open in the editor: its constants, the proper names its texts write and the
 * language they read in. A sentence the template cannot build reads as
 * nothing, never as an error.
 */
class EarsReading {
  private readonly feature = $derived(featureStore.feature);
  private readonly constants = $derived(featureConstants(this.feature));
  private readonly properNames = $derived(featureProperNames(this.feature));
  readonly language = $derived(featureLanguage(this.feature));

  private read(build: () => string): string {
    try {
      return build();
    } catch {
      return '';
    }
  }

  rule(rule: unknown, action: unknown): string {
    return this.read(() =>
      earsOfRule(rule, actionContextOf(action, this.properNames), this.constants, this.language)
    );
  }

  surfaceRule(rule: unknown, surfaceName: string): string {
    return this.read(() => earsOfRule(rule, { surfaceName }, this.constants, this.language));
  }

  effect(effect: unknown, action: unknown): string {
    return this.read(() =>
      earsOfEffect(effect, actionContextOf(action, this.properNames), this.constants, this.language)
    );
  }

  invariant(invariant: unknown): string {
    return this.read(() => earsOfInvariant(invariant, this.constants, this.language));
  }

  goal(goal: unknown): string {
    return this.read(() => earsOfGoal(goal, this.constants, this.language));
  }
}

export const earsReading = new EarsReading();
