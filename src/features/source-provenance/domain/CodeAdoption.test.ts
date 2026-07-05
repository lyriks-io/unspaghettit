import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asEffectId,
  asEntityId,
  asEventDefinitionId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SourceSpan } from './Provenance';
import {
  buildAdoptionEntries,
  deriveIndexKey,
  normalizeRepoPath,
  signatureFromSnippet,
  type AdoptionSourceMeta
} from './CodeAdoption';

const feature: Feature = {
  id: asFeatureId('f-cart'),
  name: 'Cart',
  description: 'Adopted cart feature.',
  surfaces: [
    {
      id: asSurfaceId('checkout'),
      name: 'Checkout',
      type: 'screen',
      description: 'The checkout screen.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd1'),
          path: asStatePath('cart.itemCount'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [
        {
          id: asActionId('a1'),
          name: 'Add To Cart',
          intent: 'Put one item in the cart.',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId('ar1'),
              category: 'validation',
              condition: { left: asStatePath('cart.itemCount'), operator: 'equals', right: 99 },
              effect: { id: asEffectId('be1'), type: 'block_action', reason: 'Cart is full.' }
            }
          ],
          invariants: [
            {
              id: asInvariantId('ai1'),
              name: 'Count grew',
              condition: { left: asStatePath('cart.itemCount'), operator: 'greater_than', right: 0 },
              message: 'Adding must grow the cart.'
            }
          ],
          effects: [],
          emittedEvents: [asEventName('cart.updated')],
          transitions: [{ id: asTransitionId('at1'), target: asSurfaceId('checkout'), label: 'Stay' }]
        }
      ],
      rules: [
        {
          id: asRuleId('sr1'),
          category: 'permissions',
          condition: { left: asStatePath('cart.itemCount'), operator: 'equals', right: 0 },
          effect: { id: asEffectId('be2'), type: 'block_action', reason: 'Nothing to check out.' }
        }
      ],
      invariants: [
        {
          id: asInvariantId('si1'),
          name: 'Count never negative',
          condition: { left: asStatePath('cart.itemCount'), operator: 'greater_than', right: -1 },
          message: 'The cart cannot hold negative items.'
        }
      ],
      transitions: [{ id: asTransitionId('st1'), target: asSurfaceId('checkout'), label: 'Loop' }]
    }
  ],
  personas: [],
  resources: [],
  entities: [{ id: asEntityId('en1'), namespace: 'cart', fields: [] }],
  events: [
    { id: asEventDefinitionId('ev1'), name: asEventName('cart.updated') },
    { id: asEventDefinitionId('ev2'), name: asEventName('never.emitted') }
  ],
  featureInvariants: [
    {
      id: asInvariantId('fi1'),
      name: 'Feature-level guard',
      condition: { left: asStatePath('cart.itemCount'), operator: 'greater_than', right: -1 },
      message: 'Always holds.'
    }
  ],
  createdAt: '2026-01-01',
  updatedAt: '2026-07-05T00:00:00.000Z'
};

const span = (
  id: string,
  elementId: string,
  elementType: SourceSpan['elementType'],
  overrides: Partial<SourceSpan> = {}
): SourceSpan => ({
  id,
  elementId,
  elementType,
  sourceId: 'src-code',
  startOffset: 0,
  endOffset: 10,
  startLine: 42,
  endLine: 44,
  snippet: 'export const addToCart = (item: Item) => {',
  ...overrides
});

const sources = new Map<string, AdoptionSourceMeta>([
  ['src-code', { kind: 'code', name: 'src/lib/cart.ts' }],
  ['src-doc', { kind: 'pasted', name: 'Checkout PRD' }]
]);

describe('normalizeRepoPath', () => {
  it('accepts a clean relative path and normalizes backslashes', () => {
    expect(normalizeRepoPath('src\\lib\\cart.ts')).toEqual({ ok: true, path: 'src/lib/cart.ts' });
  });

  it('rejects absolute paths, drive letters, and dot-walks', () => {
    expect(normalizeRepoPath('/etc/passwd').ok).toBe(false);
    expect(normalizeRepoPath('C:\\repo\\src\\cart.ts').ok).toBe(false);
    expect(normalizeRepoPath('../outside.ts').ok).toBe(false);
    expect(normalizeRepoPath('src/./cart.ts').ok).toBe(false);
    expect(normalizeRepoPath('   ').ok).toBe(false);
  });
});

describe('signatureFromSnippet', () => {
  it('takes the first line long enough for the auto-healer', () => {
    expect(signatureFromSnippet('\n  x;\n  export const addToCart = () => {\n')).toBe(
      'export const addToCart = () => {'
    );
  });

  it('falls back to the first non-empty line, capped', () => {
    expect(signatureFromSnippet('\n  ok\n')).toBe('ok');
    expect(signatureFromSnippet('x'.repeat(500)).length).toBe(160);
  });
});

describe('deriveIndexKey', () => {
  it('maps every scope-sensitive element to its .unspa.json key', () => {
    expect(deriveIndexKey(feature, 'checkout', 'surface')).toEqual({
      ok: true,
      key: 'surface:checkout'
    });
    expect(deriveIndexKey(feature, 'a1', 'action')).toEqual({ ok: true, key: 'action:a1' });
    expect(deriveIndexKey(feature, 'sd1', 'state')).toEqual({
      ok: true,
      key: 'state:cart.itemCount'
    });
    expect(deriveIndexKey(feature, 'ev1', 'event')).toEqual({
      ok: true,
      key: 'event:cart.updated'
    });
    expect(deriveIndexKey(feature, 'ar1', 'rule')).toEqual({ ok: true, key: 'rule:ar1' });
    expect(deriveIndexKey(feature, 'sr1', 'rule')).toEqual({ ok: true, key: 'surface_rule:sr1' });
    expect(deriveIndexKey(feature, 'ai1', 'invariant')).toEqual({
      ok: true,
      key: 'invariant:ai1'
    });
    expect(deriveIndexKey(feature, 'si1', 'invariant')).toEqual({
      ok: true,
      key: 'surface_invariant:si1'
    });
    expect(deriveIndexKey(feature, 'at1', 'transition')).toEqual({
      ok: true,
      key: 'transition:at1'
    });
  });

  it('covers the full documented contract: entities, feature invariants, surface transitions, declared events', () => {
    expect(deriveIndexKey(feature, 'ev2', 'event')).toEqual({
      ok: true,
      key: 'event:never.emitted'
    });
    expect(deriveIndexKey(feature, 'fi1', 'invariant')).toEqual({ ok: true, key: 'invariant:fi1' });
    expect(deriveIndexKey(feature, 'st1', 'transition')).toEqual({
      ok: true,
      key: 'transition:st1'
    });
    expect(deriveIndexKey(feature, 'en1', 'entity')).toEqual({ ok: true, key: 'entity:en1' });
  });

  it('refuses only elements that no longer resolve in the feature', () => {
    expect(deriveIndexKey(feature, 'ghost', 'state')).toMatchObject({ ok: false });
    expect(deriveIndexKey(feature, 'ghost', 'event')).toMatchObject({ ok: false });
    expect(deriveIndexKey(feature, 'ghost', 'entity')).toMatchObject({ ok: false });
    expect(deriveIndexKey(feature, 'ghost', 'invariant')).toMatchObject({ ok: false });
    expect(deriveIndexKey(feature, 'ghost', 'transition')).toMatchObject({ ok: false });
  });
});

describe('buildAdoptionEntries', () => {
  it('seeds an entry per code span and reports skips + non-code spans', () => {
    const result = buildAdoptionEntries({
      feature,
      spans: [
        span('s1', 'a1', 'action'),
        span('s2', 'sd1', 'state', { startLine: 7 }),
        span('s3', 'ev1', 'event'),
        span('s4', 'fi1', 'invariant'),
        span('s5', 'en1', 'entity'),
        span('s6', 'checkout', 'surface', { sourceId: 'src-doc' }),
        // Legacy span with no sourceId (embedded document).
        (({ sourceId: _drop, ...rest }) => rest)(span('s7', 'sr1', 'rule')) as SourceSpan
      ],
      sources,
      auditedAt: '2026-07-05T01:00:00.000Z',
      specVersion: String(feature.updatedAt)
    });

    expect(result.entries.map((e) => e.key).sort()).toEqual([
      'action:a1',
      'entity:en1',
      'event:cart.updated',
      'invariant:fi1',
      'state:cart.itemCount'
    ]);
    expect(result.nonCodeSpanCount).toBe(2);
    expect(result.skipped).toEqual([]);

    const action = result.entries.find((e) => e.key === 'action:a1')!;
    expect(action.entry).toEqual({
      status: 'implemented',
      file: 'src/lib/cart.ts',
      line: 42,
      signature: 'export const addToCart = (item: Item) => {',
      auditedAt: '2026-07-05T01:00:00.000Z',
      specVersion: '2026-07-05T00:00:00.000Z'
    });
    const state = result.entries.find((e) => e.key === 'state:cart.itemCount')!;
    expect(state.entry.line).toBe(7);
  });

  it('skips a code source whose name is not a repo-relative path', () => {
    const badSources = new Map<string, AdoptionSourceMeta>([
      ['src-code', { kind: 'code', name: 'C:\\abs\\cart.ts' }]
    ]);
    const result = buildAdoptionEntries({
      feature,
      spans: [span('s1', 'a1', 'action')],
      sources: badSources,
      auditedAt: 't',
      specVersion: 'v'
    });
    expect(result.entries).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('repo-relative');
  });
});
