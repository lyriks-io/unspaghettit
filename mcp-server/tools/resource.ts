import { z } from 'zod';
import {
  addResource,
  removeResource,
  updateResource
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import { EntityNotFoundInFeatureError } from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Resource } from '../../src/features/behavior-model/domain/entities/Resource';
import {
  ALL_ACCESS_MODES,
  ALL_AUTH_METHODS,
  ALL_RESOURCE_KINDS,
  ALL_RESOURCE_SCOPES,
  ALL_SENSITIVITIES,
  type AccessMode,
  type AuthenticationMethod,
  type ResourceKind,
  type ResourceScope,
  type ResourceSensitivity
} from '../../src/features/behavior-model/domain/value-objects/Resource';
import {
  asFeatureId,
  asResourceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { runMutation, type ToolDeps } from './_shared';

const kindSchema = z.enum(
  ALL_RESOURCE_KINDS as unknown as [ResourceKind, ...ResourceKind[]]
);
const scopeSchema = z.enum(
  ALL_RESOURCE_SCOPES as unknown as [ResourceScope, ...ResourceScope[]]
);
const sensitivitySchema = z.enum(
  ALL_SENSITIVITIES as unknown as [ResourceSensitivity, ...ResourceSensitivity[]]
);
const accessModeSchema = z.enum(
  ALL_ACCESS_MODES as unknown as [AccessMode, ...AccessMode[]]
);
const authMethodSchema = z.enum(
  ALL_AUTH_METHODS as unknown as [AuthenticationMethod, ...AuthenticationMethod[]]
);

const buildResource = (
  id: string,
  input: {
    name: string;
    description: string;
    kind: ResourceKind;
    provider: string;
    scope: ResourceScope;
    location?: string;
    database?: string;
    container?: string;
    field?: string;
    sensitivity: ResourceSensitivity;
    containsPii: boolean;
    complianceTags?: readonly string[];
    accessMode: AccessMode;
    authentication?: AuthenticationMethod;
    encryptionAtRest?: boolean;
    encryptionInTransit?: boolean;
    retention?: string;
    owner?: string;
  }
): Resource => ({
  id: asResourceId(id),
  name: input.name,
  description: input.description,
  kind: input.kind,
  provider: input.provider,
  scope: input.scope,
  ...(input.location ? { location: input.location } : {}),
  ...(input.database ? { database: input.database } : {}),
  ...(input.container ? { container: input.container } : {}),
  ...(input.field ? { field: input.field } : {}),
  sensitivity: input.sensitivity,
  containsPii: input.containsPii,
  complianceTags: input.complianceTags ?? [],
  accessMode: input.accessMode,
  ...(input.authentication ? { authentication: input.authentication } : {}),
  ...(input.encryptionAtRest !== undefined
    ? { encryptionAtRest: input.encryptionAtRest }
    : {}),
  ...(input.encryptionInTransit !== undefined
    ? { encryptionInTransit: input.encryptionInTransit }
    : {}),
  ...(input.retention ? { retention: input.retention } : {}),
  ...(input.owner ? { owner: input.owner } : {})
});

const resourceAddFieldsSchema = {
  name: z.string().min(1),
  description: z.string().min(1),
  kind: kindSchema,
  provider: z.string().min(1),
  scope: scopeSchema,
  location: z.string().optional(),
  database: z.string().optional(),
  container: z.string().optional(),
  field: z.string().optional(),
  sensitivity: sensitivitySchema,
  containsPii: z.boolean(),
  complianceTags: z.array(z.string()).optional(),
  accessMode: accessModeSchema,
  authentication: authMethodSchema.optional(),
  encryptionAtRest: z.boolean().optional(),
  encryptionInTransit: z.boolean().optional(),
  retention: z.string().optional(),
  owner: z.string().optional()
};

const resourcePatchFieldsSchema = {
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  kind: kindSchema.optional(),
  provider: z.string().min(1).optional(),
  scope: scopeSchema.optional(),
  location: z.string().optional(),
  database: z.string().optional(),
  container: z.string().optional(),
  field: z.string().optional(),
  sensitivity: sensitivitySchema.optional(),
  containsPii: z.boolean().optional(),
  complianceTags: z.array(z.string()).optional(),
  accessMode: accessModeSchema.optional(),
  authentication: authMethodSchema.optional(),
  encryptionAtRest: z.boolean().optional(),
  encryptionInTransit: z.boolean().optional(),
  retention: z.string().optional(),
  owner: z.string().optional()
};

export const registerResourceTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_resource',
    {
      description: 'Declare a Resource (db/api/object store/queue/etc). complianceTags: gdpr|ccpa|hipaa|pci_dss|sox|iso27001|soc2|ferpa|coppa.',
      inputSchema: {
        featureId: z.string(),
        ...resourceAddFieldsSchema
      }
    },
    async ({ featureId, ...rest }) => {
      const resource = buildResource(ids(), rest);
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addResource(exp, resource)
        },
        { createdId: resource.id }
      );
    }
  );

  server.registerTool(
    'update_resource',
    {
      description: 'Patch Resource fields. Id fixed. Omit fields to keep them.',
      inputSchema: {
        featureId: z.string(),
        resourceId: z.string(),
        ...resourcePatchFieldsSchema
      }
    },
    async ({ featureId, resourceId, ...patch }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = exp.resources.find((r) => r.id === asResourceId(resourceId));
          if (!existing) throw new EntityNotFoundInFeatureError('resource', resourceId);
          // Merge field-by-field. Optional string fields stay as-is unless provided.
          const merged: Resource = {
            ...existing,
            ...(Object.fromEntries(
              Object.entries(patch).filter(([, v]) => v !== undefined)
            ) as Partial<Resource>)
          };
          return updateResource(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_resource',
    {
      description: 'Delete Resource. Entity entities pointing at it will dangle. Clean first.',
      inputSchema: {
        featureId: z.string(),
        resourceId: z.string()
      }
    },
    async ({ featureId, resourceId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeResource(exp, asResourceId(resourceId))
      })
  );
};
