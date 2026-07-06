// Barrel for the feature validation services, split into cohesive modules
// under ./validation. Re-exports the exact public surface this file always
// had, so existing import sites keep working unchanged.
export type { ValidationResult } from './validation/shared';
export { validateFeature } from './validation/featureShape';
export { validateReferenceIntegrity } from './validation/referenceIntegrity';
export { introducedValidationErrors } from './validation/regression';
