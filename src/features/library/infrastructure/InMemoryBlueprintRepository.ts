import type { SurfaceBlueprint } from '../domain/entities/SurfaceBlueprint';
import type { BlueprintRepository } from '../domain/repositories/BlueprintRepository';
import type { BlueprintId } from '../domain/value-objects/BlueprintId';
import { adminBlueprints } from './blueprints/admin';
import { aiBlueprints } from './blueprints/ai';
import { authBlueprints } from './blueprints/auth';
import { billingBlueprints } from './blueprints/billing';
import { commerceBlueprints } from './blueprints/commerce';
import { communityBlueprints } from './blueprints/community';
import { contentBlueprints } from './blueprints/content';
import { crmBlueprints } from './blueprints/crm';
import { dashboardBlueprints } from './blueprints/dashboard';
import { devtoolsBlueprints } from './blueprints/devtools';
import { filesBlueprints } from './blueprints/files';
import { financeBlueprints } from './blueprints/finance';
import { formsBlueprints } from './blueprints/forms';
import { hrBlueprints } from './blueprints/hr';
import { learningBlueprints } from './blueprints/learning';
import { loyaltyBlueprints } from './blueprints/loyalty';
import { mapsBlueprints } from './blueprints/maps';
import { marketingBlueprints } from './blueprints/marketing';
import { mediaBlueprints } from './blueprints/media';
import { messagingBlueprints } from './blueprints/messaging';
import { onboardingBlueprints } from './blueprints/onboarding';
import { productivityBlueprints } from './blueprints/productivity';
import { schedulingBlueprints } from './blueprints/scheduling';
import { searchBlueprints } from './blueprints/search';
import { settingsBlueprints } from './blueprints/settings';
import { socialBlueprints } from './blueprints/social';
import { supportBlueprints } from './blueprints/support';
import { utilityBlueprints } from './blueprints/utility';

const allBlueprints: readonly SurfaceBlueprint[] = [
  ...authBlueprints,
  ...commerceBlueprints,
  ...contentBlueprints,
  ...onboardingBlueprints,
  ...settingsBlueprints,
  ...messagingBlueprints,
  ...socialBlueprints,
  ...dashboardBlueprints,
  ...schedulingBlueprints,
  ...supportBlueprints,
  ...filesBlueprints,
  ...adminBlueprints,
  ...formsBlueprints,
  ...billingBlueprints,
  ...marketingBlueprints,
  ...searchBlueprints,
  ...mapsBlueprints,
  ...financeBlueprints,
  ...mediaBlueprints,
  ...learningBlueprints,
  ...crmBlueprints,
  ...productivityBlueprints,
  ...devtoolsBlueprints,
  ...aiBlueprints,
  ...communityBlueprints,
  ...hrBlueprints,
  ...loyaltyBlueprints,
  ...utilityBlueprints
];

const byId = new Map(allBlueprints.map((b) => [b.id, b] as const));

export const inMemoryBlueprintRepository: BlueprintRepository = {
  list: () => allBlueprints,
  findById: (id: BlueprintId) => byId.get(id)
};
