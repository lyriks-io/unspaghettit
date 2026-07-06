/**
 * Pure transforms over a Feature, grouped by entity family under
 * `./transforms`. This barrel re-exports every public symbol the original
 * single-file module exposed, so both `import * as T from './FeatureTransforms'`
 * and named imports keep working unchanged.
 *
 * The shared private helpers (mustMap, updateSurface, updateActionIn, swapAt)
 * live in `./transforms/internal` and are deliberately NOT re-exported here;
 * only `EntityNotFoundInFeatureError` from that module is public.
 */
export { EntityNotFoundInFeatureError } from './transforms/internal';
export * from './transforms/surfaceTransforms';
export * from './transforms/actionTransforms';
export * from './transforms/ruleTransforms';
export * from './transforms/scenarioTransforms';
export * from './transforms/modelTransforms';
