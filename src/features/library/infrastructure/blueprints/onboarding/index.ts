import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { onboardingExtraBlueprints } from './extras';
import { onboardingWizardBlueprint } from './OnboardingWizardBlueprint';

export const onboardingBlueprints: readonly SurfaceBlueprint[] = [
  onboardingWizardBlueprint,
  ...onboardingExtraBlueprints
];
