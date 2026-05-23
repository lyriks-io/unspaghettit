import type { Feature } from "$features/behavior-model/domain/entities/Feature";

// The user-facing Load samples flow exclusively delivers the eShop project (and its
// four LLM-sized features), loaded from samples/*.feature.json + samples/eshop.project.json
// via sampleSnapshots.ts. Other hardcoded TS sample features (canvas, CRM, npm CLI,
// basic storefront) still exist under this directory as test fixtures, but they are
// NOT exposed through Load samples anymore.
export const seedFeatures: readonly Feature[] = [];
