import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import { stateCoherenceIssues, stateDeclarationIssues } from './stateRegistry';

/**
 * One state path declared by two features of a project is one variable: a
 * disagreement on its kind of value, or on the values a choice allows, is said
 * with both features and both declarations. Different starting values are not a
 * disagreement (every engine starts a feature from its own).
 */

const decl = (path: string, type: StateDefinition['type'], defaultValue: unknown, extra = {}) =>
  ({ id: `sd-${path}-${String(defaultValue)}`, path, type, defaultValue, ...extra }) as unknown as StateDefinition;

const feature = (id: string, name: string, states: StateDefinition[]): Feature =>
  ({
    id,
    name,
    surfaces: [{ id: `s-${id}`, name: 'Screen', type: 'screen', stateDefinitions: states, actions: [], rules: [], invariants: [], transitions: [] }],
    personas: [],
    resources: [],
    entities: [],
    featureInvariants: [],
    reachabilityGoals: [],
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z'
  }) as unknown as Feature;

const orders = feature('orders', 'Orders', [
  decl('order.status', 'enum', 'draft', { enumValues: ['draft', 'paid', 'shipped'] }),
  decl('order.total', 'number', 0)
]);

describe('a state two features declare differently is reported', () => {
  it('reports two kinds of value as an error naming both features', () => {
    const invoices = feature('invoices', 'Invoices', [decl('order.total', 'string', '')]);
    const [issue] = stateDeclarationIssues([orders, invoices]);
    expect(issue?.kind).toBe('declaration-type-mismatch');
    expect(issue?.severity).toBe('error');
    expect(issue?.featureIds).toEqual(['orders', 'invoices']);
    expect(issue?.message).toContain('"Orders" (number)');
    expect(issue?.message).toContain('"Invoices" (string)');
  });

  it('reports other choices as a warning, and as an error once a project invariant reads the state', () => {
    const shipping = feature('shipping', 'Shipping', [
      decl('order.status', 'enum', 'draft', { enumValues: ['draft', 'shipped', 'cancelled'] })
    ]);
    const [alone] = stateDeclarationIssues([orders, shipping]);
    expect(alone?.kind).toBe('declaration-choices-mismatch');
    expect(alone?.severity).toBe('warning');
    const readsStatus = {
      id: 'pi',
      name: 'A shipped order is paid',
      condition: { left: 'order.status', operator: 'equals', right: 'shipped' },
      message: 'x'
    } as unknown as Invariant;
    const [shared] = stateDeclarationIssues([orders, shipping], [readsStatus]);
    expect(shared?.severity).toBe('error');
    expect(shared?.message).toContain('A project invariant reads it');
  });

  it('never reports the same choices in another order, nor different starting values', () => {
    const shipping = feature('shipping', 'Shipping', [
      decl('order.status', 'enum', 'shipped', { enumValues: ['shipped', 'paid', 'draft'] }),
      decl('order.total', 'number', 100)
    ]);
    expect(stateDeclarationIssues([orders, shipping])).toEqual([]);
  });

  it('reaches every reader of the project state, in French too', () => {
    const invoices = feature('invoices', 'Factures', [decl('order.total', 'string', '')]);
    const issues = stateCoherenceIssues([], [orders, invoices], 'fr');
    expect(issues.map((i) => i.kind)).toContain('declaration-type-mismatch');
    expect(issues[0]?.message).toMatch(/^L'état «\u00a0order\.total\u00a0» est déclaré avec des types différents/);
  });
});

describe('a data field tied to a state of the kind that carries it', () => {
  it('holds a date or a JSON document as text without calling it a mismatch', () => {
    const feature = {
      id: 'orders',
      name: 'Orders',
      surfaces: [],
      personas: [],
      resources: [],
      entities: [
        {
          id: 'ent-o',
          namespace: 'Order',
          fields: [
            { id: 'fld-at', name: 'placedAt', type: 'date' },
            { id: 'fld-n', name: 'notes', type: 'json' }
          ]
        }
      ],
      featureInvariants: [],
      reachabilityGoals: [],
      createdAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:00.000Z'
    } as unknown as Feature;
    const state = (id: string, type: string, fieldId: string) =>
      ({
        id,
        path: `order.${id}`,
        type,
        defaultValue: '',
        owner: { featureId: 'orders', surfaceId: 's' },
        readers: [],
        writers: [],
        links: { dataField: { featureId: 'orders', entityId: 'ent-o', fieldId } }
      }) as never;
    const issues = stateCoherenceIssues([state('placedAt', 'string', 'fld-at'), state('notes', 'object', 'fld-n')], [feature]);
    expect(issues.filter((i) => i.kind === 'field-type-mismatch')).toEqual([]);
  });
});
