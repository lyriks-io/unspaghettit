/**
 * The `unspaghettit` package's LIBRARY entry point.
 *
 * Everything else this package ships is a CLI, an MCP server, or a SvelteKit
 * app. This file is the small, deliberately-stable surface a consumer can
 * `import { … } from 'unspaghettit'` — pure functions over a snapshot, no I/O,
 * no clock, no repository, so they run offline and in any JS runtime.
 *
 * Kept narrow on purpose: everything exported here is a compatibility promise,
 * and a wide surface would make every internal refactor a breaking change. Add
 * to it only when an external consumer would otherwise have to reimplement
 * engine logic (which is exactly how the maturity formula ended up duplicated).
 *
 * Built by `npm run build:lib` (vite library mode) because the sources use the
 * `$features/*` path aliases; the bundle resolves them so consumers need no
 * alias config of their own.
 */

export { computeFeatureMaturity } from '$features/maturity/domain/computeFeatureMaturity';
export type {
  FeatureMaturity,
  MaturityBreakdownEntry
} from '$features/maturity/domain/computeFeatureMaturity';
export type {
  MaturityIssue,
  MaturityReport,
  MaturitySeverity
} from '$features/maturity/domain/MaturityReport';

export { validateFeature, validateReferenceIntegrity } from '$features/behavior-model/domain/services/FeatureValidator';
export type { ValidationResult } from '$features/behavior-model/domain/services/validation/shared';

export { importFeatureFromJson, exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';

export {
  danglingLibraryRefs,
  resolveLibraryRefs,
  stripLibraryRefs
} from '$features/projects/domain/services/projectLibrary';
export type { LibraryKind } from '$features/projects/domain/services/projectLibrary';

export type { Feature } from '$features/behavior-model/domain/entities/Feature';
export type { Project } from '$features/projects/domain/entities/Project';

// The requirement sentences of a model (EARS for rules, statements and goals,
// Given/When/Then for scenarios), built by a fixed template: one template for
// the editor, the Lyriks rule inventory and the AI clients.
export {
  actionContextOf,
  actionPhrase,
  conditionText,
  earsOfEffect,
  earsOfGoal,
  earsOfInvariant,
  earsOfRule,
  eventClause,
  expressionText,
  featureConstants,
  featureLanguage,
  featureProperNames,
  featureStatements,
  gwtOfScenario,
  properNamesIn,
  refusalCase,
  refusalLead,
  statesRead,
  words
} from '$features/behavior-model/domain/services/requirementSentences';
export type {
  ActionContext,
  Constants
} from '$features/behavior-model/domain/services/requirementSentences';
export type { ReportLanguage } from '$shared/language';
