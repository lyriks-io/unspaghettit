import type { Feature } from '../entities/Feature';
import type { ResourceId } from '../value-objects/ids';

/**
 * A action parameter that points at a resource via `resourceId`.
 */
export type ResourceParameterUsage = {
  readonly surfaceId: string;
  readonly surfaceName: string;
  readonly actionId: string;
  readonly actionName: string;
  readonly parameterId: string;
  readonly parameterName: string;
  readonly parameterType: string;
};

/**
 * Aggregate view of "what touches this resource", deduced from the model.
 * Used by the Resources tab to show, per resource, which Entity entities are
 * stored there and which action parameters read or write it.
 */
export type ResourceUsage = {
  readonly resourceId: string;
  readonly dataNamespaces: readonly string[];
  readonly parameters: readonly ResourceParameterUsage[];
};

export const buildResourceUsage = (
  feature: Feature,
  resourceId: ResourceId | string
): ResourceUsage => {
  const target = String(resourceId);

  const dataNamespaces: string[] = [];
  for (const data of feature.entities) {
    if (data.resourceId && String(data.resourceId) === target) {
      dataNamespaces.push(data.namespace);
    }
  }

  const parameters: ResourceParameterUsage[] = [];
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const param of cap.parameters) {
        if (param.resourceId && String(param.resourceId) === target) {
          parameters.push({
            surfaceId: surface.id as unknown as string,
            surfaceName: surface.name,
            actionId: cap.id as unknown as string,
            actionName: cap.name,
            parameterId: param.id as unknown as string,
            parameterName: param.name,
            parameterType: param.type
          });
        }
      }
    }
  }

  parameters.sort((a, b) => {
    if (a.surfaceName !== b.surfaceName) {
      return a.surfaceName.localeCompare(b.surfaceName);
    }
    if (a.actionName !== b.actionName) {
      return a.actionName.localeCompare(b.actionName);
    }
    return a.parameterName.localeCompare(b.parameterName);
  });
  dataNamespaces.sort();

  return {
    resourceId: target,
    dataNamespaces,
    parameters
  };
};

export const totalUsage = (usage: ResourceUsage): number =>
  usage.dataNamespaces.length + usage.parameters.length;
