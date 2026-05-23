import { z } from 'zod';
import {
  addEntityField,
  removeEntityField,
  updateEntityField
} from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import type { EntityField } from '../../src/features/behavior-model/domain/entities/Entity';
import {
  ALL_DATA_FIELD_TYPES,
  type EntityFieldType
} from '../../src/features/behavior-model/domain/value-objects/EntityFieldType';
import {
  asEntityFieldId,
  asEntityId,
  asFeatureId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import { runMutation, type ToolDeps } from './_shared';

const dataFieldTypeSchema = z.enum(
  ALL_DATA_FIELD_TYPES as unknown as [EntityFieldType, ...EntityFieldType[]]
);

type DataFieldInput = {
  name: string;
  type: EntityFieldType;
  description: string;
  required?: boolean;
  enumValues?: readonly string[];
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
  ...(input.path ? { path: asStatePath(input.path) } : {}),
  ...(input.fields ? { fields: input.fields.map((f) => buildDataField(ids, f)) } : {}),
  ...(input.items ? { items: buildDataField(ids, input.items) } : {})
});

export const registerEntityFieldTools = (deps: ToolDeps): void => {
  const { server, ids } = deps;

  server.registerTool(
    'add_entity_field',
    {
      description: 'Append top-level EntityField. fields/items recurse for object/array. path maps to a state path.',
      inputSchema: {
        featureId: z.string(),
        entityId: z.string(),
        name: z.string().min(1),
        type: dataFieldTypeSchema,
        description: z.string().min(1),
        required: z.boolean().optional(),
        enumValues: z.array(z.string()).optional(),
        path: z.string().optional(),
        fields: z.array(z.record(z.string(), z.unknown())).optional(),
        items: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({
      featureId,
      entityId,
      name,
      type,
      description,
      required,
      enumValues,
      path,
      fields,
      items
    }) => {
      const field = buildDataField(ids, {
        name,
        type,
        description,
        required,
        enumValues,
        path,
        fields: fields as readonly DataFieldInput[] | undefined,
        items: items as DataFieldInput | undefined
      });
      return runMutation(
        deps,
        {
          featureId: asFeatureId(featureId),
          transform: (exp) => addEntityField(exp, asEntityId(entityId), field)
        },
        { createdId: field.id }
      );
    }
  );

  server.registerTool(
    'update_entity_field',
    {
      description: 'Patch EntityField. Id fixed. Subset: name/type/description/required/enumValues/path/fields/items.',
      inputSchema: {
        featureId: z.string(),
        entityId: z.string(),
        fieldId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ featureId, entityId, fieldId, patch }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          updateEntityField(
            exp,
            asEntityId(entityId),
            asEntityFieldId(fieldId),
            patch as Partial<EntityField>
          )
      })
  );

  server.registerTool(
    'remove_entity_field',
    {
      description: 'Delete top-level EntityField.',
      inputSchema: {
        featureId: z.string(),
        entityId: z.string(),
        fieldId: z.string()
      }
    },
    async ({ featureId, entityId, fieldId }) =>
      runMutation(deps, {
        featureId: asFeatureId(featureId),
        transform: (exp) =>
          removeEntityField(exp, asEntityId(entityId), asEntityFieldId(fieldId))
      })
  );
};
