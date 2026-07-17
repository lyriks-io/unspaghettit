import { z } from 'zod';
import {
  addEntity,
  removeEntity,
  updateEntity
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { Entity, EntityField } from '../../src/features/behavior-model/domain/entities/Entity';
import {
  ALL_DATA_FIELD_TYPES,
  type EntityFieldType
} from '../../src/features/behavior-model/domain/value-objects/EntityFieldType';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId,
  asResourceId,
  asValueSetId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { runMutation, type ToolDeps } from './_shared';

const dataFieldTypeSchema = z.enum(
  ALL_DATA_FIELD_TYPES as unknown as [EntityFieldType, ...EntityFieldType[]]
);

// EntityField is recursive; we accept a free-form record and rebuild ids/paths
// recursively. The validator ensures top-level shape.
const dataFieldInputSchema = z.record(z.string(), z.unknown());

type DataFieldInput = {
  name: string;
  type: EntityFieldType;
  description: string;
  required?: boolean;
  enumValues?: readonly string[];
  valueSetId?: string;
  path?: string;
  fields?: readonly DataFieldInput[];
  items?: DataFieldInput;
};

const buildDataField = (ids: () => string, input: DataFieldInput): EntityField => ({
  id: asEntityFieldId(ids()),
  name: input.name,
  type: input.type,
  description: input.description,
  ...(input.required !== undefined ? { required: input.required } : {}),
  ...(input.enumValues ? { enumValues: input.enumValues } : {}),
  ...(input.valueSetId ? { valueSetId: asValueSetId(input.valueSetId) } : {}),
  ...(input.path ? { path: asStatePath(input.path) } : {}),
  ...(input.fields ? { fields: input.fields.map((f) => buildDataField(ids, f)) } : {}),
  ...(input.items ? { items: buildDataField(ids, input.items) } : {})
});

const dataFieldsArraySchema = z.array(dataFieldInputSchema);

export const registerEntityTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_entity',
    {
      description:
        'Declare a Entity entity (named domain object). Field types: string|number|boolean|enum|object|array|date|timestamp|null|json. Recursive via fields/items for object/array.',
      inputSchema: {
        featureId: z.string(),
        namespace: z.string().min(1),
        description: z.string().min(1),
        fields: dataFieldsArraySchema,
        resourceId: z.string().optional()
      }
    },
    async ({ featureId, namespace, description, fields, resourceId }) => {
      const data: Entity = {
        id: asEntityId(ids()),
        namespace,
        description,
        fields: fields.map((f) => buildDataField(ids, f as DataFieldInput)),
        ...(resourceId ? { resourceId: asResourceId(resourceId) } : {})
      };
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addEntity(exp, data)
        },
        { createdId: data.id }
      );
    }
  );

  server.registerTool(
    'update_entity',
    {
      description:
        'Patch Entity fields. Id fixed. When `fields` is provided it fully replaces (field ids regenerated). Use add_entity_field/update_entity_field for in-place field edits.',
      inputSchema: {
        featureId: z.string(),
        entityId: z.string(),
        namespace: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        fields: dataFieldsArraySchema.optional(),
        resourceId: z.string().nullable().optional()
      }
    },
    async ({ featureId, entityId, namespace, description, fields, resourceId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => {
          const existing = exp.entities.find((d) => d.id === asEntityId(entityId));
          if (!existing) return exp;
          const merged: Entity = {
            ...existing,
            ...(namespace !== undefined ? { namespace } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(fields !== undefined
              ? { fields: fields.map((f) => buildDataField(ids, f as DataFieldInput)) }
              : {}),
            ...(resourceId !== undefined
              ? resourceId === null
                ? { resourceId: undefined }
                : { resourceId: asResourceId(resourceId) }
              : {})
          };
          return updateEntity(exp, merged);
        }
      })
  );

  server.registerTool(
    'remove_entity',
    {
      description: 'Delete Entity entity. State paths it documents stay valid elsewhere.',
      inputSchema: {
        featureId: z.string(),
        entityId: z.string()
      }
    },
    async ({ featureId, entityId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) => removeEntity(exp, asEntityId(entityId))
      })
  );

  // Mark types referenced for type checker (avoid unused import warning).
  void dataFieldTypeSchema;
};
