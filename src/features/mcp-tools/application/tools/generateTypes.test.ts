import { describe, expect, it } from 'vitest';
import { storefrontFeature } from '$features/behavior-model/infrastructure/seed/seedStorefront';
import { asValueSetId } from '$features/behavior-model/domain/value-objects/ids';
import { generateTypesTool } from './generateTypes';

describe('generateTypesTool', () => {
  const input = { feature: storefrontFeature, header: 'fixture' };

  it('emits a header comment and a deterministic prelude', () => {
    const { source } = generateTypesTool(input);
    expect(source.startsWith('// AUTO-GENERATED')).toBe(true);
    expect(source).toContain('// fixture');
  });

  it('emits a discriminated-union type for every enum state def', () => {
    const { source, stats } = generateTypesTool(input);
    const enumDefs = storefrontFeature.surfaces
      .flatMap((s) => s.stateDefinitions)
      .filter((d) => d.type === 'enum' && (d.enumValues?.length ?? 0) > 0);
    expect(stats.enumTypes).toBe(enumDefs.length);
    for (const def of enumDefs) {
      // Type name uses PascalCase of the dotted state path.
      const partialName = def.path
        .toString()
        .split('.')
        .map((seg) => seg[0]!.toUpperCase() + seg.slice(1))
        .join('');
      expect(source).toContain(`export type ${partialName}`);
      // Every declared enum value appears as a quoted string literal.
      for (const v of def.enumValues ?? []) {
        expect(source).toContain(`'${v}'`);
      }
    }
  });

  it('emits a StatePaths map keyed by every declared state path', () => {
    const { source } = generateTypesTool(input);
    expect(source).toContain('export type StatePaths = {');
    expect(source).toContain('export type StatePath = keyof StatePaths;');
    for (const surface of storefrontFeature.surfaces) {
      for (const def of surface.stateDefinitions) {
        expect(source).toContain(`'${String(def.path)}'`);
      }
    }
  });

  it('emits an action parameter shape per action with at least one parameter', () => {
    const { source, stats } = generateTypesTool(input);
    const withParams = storefrontFeature.surfaces
      .flatMap((s) => s.actions)
      .filter((c) => c.parameters.length > 0);
    expect(stats.capabilityParamShapes).toBe(withParams.length);
  });

  it('emits an EventName union when the feature emits any events', () => {
    const { source, stats } = generateTypesTool(input);
    if (stats.events === 0) return;
    expect(source).toContain('export type EventName =');
  });

  it('resolves a valueSetId-backed enum state into a union type', () => {
    const feature = {
      ...storefrontFeature,
      valueSets: [
        {
          id: asValueSetId('vs-prio'),
          name: 'Priority',
          description: 'Allowed priority levels.',
          values: ['low', 'high']
        }
      ],
      surfaces: storefrontFeature.surfaces.map((s, i) =>
        i === 0
          ? {
              ...s,
              stateDefinitions: [
                ...s.stateDefinitions,
                {
                  id: 'prio-state' as never,
                  path: 'ticket.priority' as never,
                  type: 'enum' as const,
                  valueSetId: asValueSetId('vs-prio'),
                  defaultValue: 'low',
                  description: 'Ticket priority.'
                }
              ]
            }
          : s
      )
    };
    const { source } = generateTypesTool({ feature, header: 'fixture' });
    expect(source).toContain("export type TicketPriority = 'low' | 'high';");
  });
});
