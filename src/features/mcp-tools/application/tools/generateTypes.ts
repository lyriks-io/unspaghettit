import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { effectiveEnumValues } from '$features/behavior-model/domain/services/EnumValues';
import type { StateType } from '$features/behavior-model/domain/value-objects/StateValue';
import type { ParameterType } from '$features/behavior-model/domain/value-objects/ParameterType';

/**
 * Convert an arbitrary string into a TypeScript-safe PascalCase identifier.
 * Drops non-identifier characters, capitalizes word starts, leaves leading
 * digits prefixed with `_` so the result is always a legal type name.
 */
const toPascalCase = (raw: string): string => {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
    .join('');
  if (cleaned.length === 0) return '_Unknown';
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
  return cleaned;
};

const escapeStringLiteral = (s: string): string => `'${s.replace(/'/g, "\\'")}'`;

const stateTypeToTs = (type: StateType, enumValues?: readonly string[]): string => {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'enum':
      if (!enumValues || enumValues.length === 0) return 'string';
      return enumValues.map(escapeStringLiteral).join(' | ');
    case 'array':
      return 'readonly unknown[]';
    case 'object':
      return 'Record<string, unknown>';
  }
};

const parameterTypeToTs = (type: ParameterType, enumValues?: readonly string[]): string => {
  switch (type) {
    case 'enum':
      if (!enumValues || enumValues.length === 0) return 'string';
      return enumValues.map(escapeStringLiteral).join(' | ');
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'readonly unknown[]';
    case 'object':
      return 'Record<string, unknown>';
    case 'string':
    case 'date':
    case 'time':
    case 'timestamp':
    case 'url':
    case 'email':
      return 'string';
    case 'geolocation':
      return '{ readonly lat: number; readonly lng: number }';
  }
};

const collectEvents = (feature: Feature): readonly string[] => {
  const names = new Set<string>();
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      for (const n of cap.emittedEvents) names.add(String(n));
      for (const e of cap.effects) if (e.type === 'emit_event') names.add(String(e.event));
      for (const e of cap.onBlockedEffects ?? []) {
        if (e.type === 'emit_event') names.add(String(e.event));
      }
    }
  }
  for (const def of feature.events ?? []) names.add(String(def.name));
  return [...names].sort();
};

type EnumStateLink = {
  readonly path: string;
  readonly typeName: string;
  readonly values: readonly string[];
};

const collectEnumStates = (feature: Feature): readonly EnumStateLink[] => {
  const seen = new Map<string, EnumStateLink>();
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      if (def.type !== 'enum') continue;
      // Resolve inline enumValues OR a named valueSetId to the effective set.
      const values = effectiveEnumValues(def, feature.valueSets);
      if (!values || values.length === 0) continue;
      const key = String(def.path);
      if (seen.has(key)) continue;
      seen.set(key, {
        path: key,
        typeName: toPascalCase(key),
        values
      });
    }
  }
  return [...seen.values()];
};

type CapabilityParamLink = {
  readonly actionId: string;
  readonly actionName: string;
  readonly surfaceName: string;
  readonly typeName: string;
  readonly parameters: readonly { readonly name: string; readonly type: string; readonly required: boolean }[];
};

const capabilityTypeName = (surface: Surface, action: Action): string =>
  `${toPascalCase(surface.name)}${toPascalCase(action.name)}Params`;

const collectCapabilityParamShapes = (feature: Feature): readonly CapabilityParamLink[] => {
  const out: CapabilityParamLink[] = [];
  for (const surface of feature.surfaces) {
    for (const cap of surface.actions) {
      if (cap.parameters.length === 0) continue;
      out.push({
        actionId: String(cap.id),
        actionName: cap.name,
        surfaceName: surface.name,
        typeName: capabilityTypeName(surface, cap),
        parameters: cap.parameters.map((p: Parameter) => ({
          name: p.name,
          type: parameterTypeToTs(p.type, p.enumValues),
          required: p.required
        }))
      });
    }
  }
  return out;
};

const collectStatePaths = (
  feature: Feature
): readonly { readonly path: string; readonly tsType: string }[] => {
  const seen = new Map<string, { path: string; tsType: string }>();
  for (const surface of feature.surfaces) {
    for (const def of surface.stateDefinitions) {
      const key = String(def.path);
      if (seen.has(key)) continue;
      const enumLink = def.type === 'enum' ? toPascalCase(key) : null;
      seen.set(key, {
        path: key,
        tsType: enumLink ?? stateTypeToTs(def.type, def.enumValues)
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
};

export type GenerateTypesInput = {
  readonly feature: Feature;
  /** Pretty header that lands at the top of the file. */
  readonly header: string;
};

export type GenerateTypesOutput = {
  readonly source: string;
  readonly stats: {
    readonly enumTypes: number;
    readonly statePaths: number;
    readonly capabilityParamShapes: number;
    readonly events: number;
  };
};

/**
 * Codegen a TypeScript module that mirrors the feature's enum state
 * definitions, state-path → value-type map, action parameter shapes,
 * and event names. The output is self-contained (no imports from the
 * domain layer) so it can be checked in and consumed from app code without
 * pulling in the spec packages.
 *
 * Re-run after every spec change. The MCP tool also writes to disk; this
 * pure function is useful for testing and tools that want to render the
 * source elsewhere (e.g. a "preview" tab in the editor).
 */
export const generateTypesTool = (input: GenerateTypesInput): GenerateTypesOutput => {
  const enums = collectEnumStates(input.feature);
  const capParams = collectCapabilityParamShapes(input.feature);
  const statePaths = collectStatePaths(input.feature);
  const events = collectEvents(input.feature);

  const lines: string[] = [];
  lines.push('// AUTO-GENERATED by Unspaghettit `generate_types`. Do not edit by hand.');
  lines.push(`// ${input.header}`);
  lines.push('');

  // Enum state types
  for (const link of enums) {
    lines.push(`/** State path: ${link.path} */`);
    lines.push(
      `export type ${link.typeName} = ${link.values.map(escapeStringLiteral).join(' | ')};`
    );
    lines.push('');
  }

  // State path → value type map
  if (statePaths.length > 0) {
    lines.push('/** Maps every declared state path to the TypeScript value it accepts. */');
    lines.push('export type StatePaths = {');
    for (const sp of statePaths) {
      lines.push(`  ${escapeStringLiteral(sp.path).replace(/'/g, "'")}: ${sp.tsType};`);
    }
    lines.push('};');
    lines.push('');
    lines.push('export type StatePath = keyof StatePaths;');
    lines.push('');
  }

  // Event names
  if (events.length > 0) {
    lines.push('/** Every event the feature emits at runtime. */');
    lines.push(
      `export type EventName = ${events.map(escapeStringLiteral).join(' | ')};`
    );
    lines.push('');
  }

  // Action parameter shapes
  for (const cap of capParams) {
    lines.push(`/** Parameters for "${cap.surfaceName} / ${cap.actionName}". */`);
    lines.push(`export type ${cap.typeName} = {`);
    for (const p of cap.parameters) {
      const optional = p.required ? '' : '?';
      lines.push(`  readonly ${p.name}${optional}: ${p.type};`);
    }
    lines.push('};');
    lines.push('');
  }

  return {
    source: lines.join('\n') + '\n',
    stats: {
      enumTypes: enums.length,
      statePaths: statePaths.length,
      capabilityParamShapes: capParams.length,
      events: events.length
    }
  };
};
