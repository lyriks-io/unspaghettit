import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import {
  asEntityId,
  asEventDefinitionId,
  asFeatureId,
  asResourceId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { inheritedData, inheritedEvents, inheritedResources, inheritedTransitions } from './InheritedFromProject';

const surface = (id: string, name: string, transitions: Surface['transitions'] = []): Surface => ({
  id: asSurfaceId(id),
  name,
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions
});

const sibling = (id: string, name: string, part: Partial<Feature> = {}): Feature => ({
  id: asFeatureId(id),
  name,
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...part
});

const resource = (id: string, name: string): Resource => ({
  id: asResourceId(id),
  name,
  kind: 'relational_db',
  provider: 'Postgres',
  scope: 'cloud',
  sensitivity: 'internal',
  containsPii: false,
  complianceTags: [],
  accessMode: 'read_write'
});
const db = resource('db', 'Orders DB');
const queue = resource('mq', 'Queue');
const order = { id: asEntityId('order'), namespace: 'order', fields: [] };
const user = { id: asEntityId('user'), namespace: 'user', fields: [] };

const billing = sibling('billing', 'Billing', {
  resources: [db],
  entities: [order],
  events: [
    { id: asEventDefinitionId('e1'), name: asEventName('order.paid') },
    { id: asEventDefinitionId('e2'), name: asEventName('order.refunded') }
  ]
});
const shipping = sibling('shipping', 'Shipping', {
  // The same resource and entity as Billing, under the same ids.
  resources: [db, queue],
  entities: [order, user],
  // The same event name under another id: one event for the project.
  events: [{ id: asEventDefinitionId('e9'), name: asEventName('order.paid') }]
});

const sources = <T>(rows: readonly { value: T; sourceFeatureName: string }[], key: (v: T) => string) =>
  rows.map((r) => [key(r.value), r.sourceFeatureName]);

describe('what a feature inherits from its project siblings', () => {
  it('lists each resource once, tagged with the first sibling that declares it', () => {
    expect(sources(inheritedResources([billing, shipping]), (r) => String(r.id))).toEqual([
      ['db', 'Billing'],
      ['mq', 'Shipping']
    ]);
    expect(sources(inheritedResources([shipping, billing]), (r) => String(r.id))).toEqual([
      ['db', 'Shipping'],
      ['mq', 'Shipping']
    ]);
  });

  it('lists each entity once, tagged with the first sibling that declares it', () => {
    expect(sources(inheritedData([billing, shipping]), (d) => String(d.id))).toEqual([
      ['order', 'Billing'],
      ['user', 'Shipping']
    ]);
  });

  it('lists each event once by its name, whatever id each sibling gave it', () => {
    const rows = inheritedEvents([billing, shipping, sibling('empty', 'No events')]);
    expect(sources(rows, (e) => String(e.name))).toEqual([
      ['order.paid', 'Billing'],
      ['order.refunded', 'Billing']
    ]);
    expect(rows[0]!.sourceFeatureId).toBe('billing');
  });

  it('lists every transition with its surface and target named, and flags a target the sibling lacks', () => {
    const shop = sibling('shop', 'Shop', {
      surfaces: [
        surface('cart', 'Cart', [
          { id: asTransitionId('t1'), target: asSurfaceId('pay'), label: 'Pay now' },
          { id: asTransitionId('t2'), target: asSurfaceId('gone') }
        ]),
        surface('pay', 'Payment', [{ id: asTransitionId('t3'), target: asSurfaceId('cart') }])
      ]
    });
    // A surface of another sibling never resolves a transition of this one.
    const other = sibling('other', 'Other', { surfaces: [surface('gone', 'Elsewhere')] });
    const rows = inheritedTransitions([shop, other]);
    expect(rows.map((r) => r.value)).toEqual([
      { id: 't1', surfaceId: 'cart', surfaceName: 'Cart', target: 'pay', targetName: 'Payment', targetMissing: false, label: 'Pay now' },
      { id: 't2', surfaceId: 'cart', surfaceName: 'Cart', target: 'gone', targetName: 'gone', targetMissing: true },
      { id: 't3', surfaceId: 'pay', surfaceName: 'Payment', target: 'cart', targetName: 'Cart', targetMissing: false }
    ]);
    expect(rows.every((r) => r.sourceFeatureName === 'Shop')).toBe(true);
  });
});
