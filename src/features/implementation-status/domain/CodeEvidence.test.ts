import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asEffectId,
  asEntityId,
  asEventDefinitionId,
  asFeatureId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SourceSpan } from '$features/source-provenance/domain/Provenance';
import type { AdoptionSourceMeta } from '$features/source-provenance/domain/CodeAdoption';
import {
  buildSpanEvidenceMap,
  capSnippet,
  enrichLocation,
  normalizeClaimedPath,
  sliceAround,
  type SpanEvidence
} from './CodeEvidence';

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
          invariants: [],
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
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [{ id: asEntityId('en1'), namespace: 'cart', fields: [] }],
  events: [{ id: asEventDefinitionId('ev1'), name: asEventName('cart.updated') }],
  featureInvariants: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-07-05T00:00:00.000Z'
};

const span = (
  elementId: string,
  elementType: SourceSpan['elementType'],
  overrides: Partial<SourceSpan> = {}
): SourceSpan => ({
  id: `span-${elementId}`,
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

describe('buildSpanEvidenceMap', () => {
  it('keys spans in the report entity space, including both state forms', () => {
    const map = buildSpanEvidenceMap(
      feature,
      [
        span('a1', 'action'),
        span('ar1', 'rule'),
        span('sr1', 'rule'),
        span('sd1', 'state'),
        span('ev1', 'event'),
        span('en1', 'entity')
      ],
      sources
    );
    expect(map.get('action:a1')).toHaveLength(1);
    expect(map.get('rule:ar1')).toHaveLength(1);
    expect(map.get('surface_rule:sr1')).toHaveLength(1);
    expect(map.get('state:cart.itemCount')).toHaveLength(1);
    expect(map.get('state:sd1')).toHaveLength(1);
    expect(map.get('event:cart.updated')).toHaveLength(1);
    expect(map.get('data:en1')).toHaveLength(1);
  });

  it('skips spans against non-code sources and unresolvable elements', () => {
    const map = buildSpanEvidenceMap(
      feature,
      [span('a1', 'action', { sourceId: 'src-doc' }), span('ghost', 'rule')],
      sources
    );
    expect(map.size).toBe(0);
  });

  it('caps span snippets to a short slice', () => {
    const long = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
    const map = buildSpanEvidenceMap(feature, [span('a1', 'action', { snippet: long })], sources);
    expect(map.get('action:a1')?.[0]?.snippet).toBe('l1\nl2\nl3\n…');
  });
});

describe('capSnippet', () => {
  it('returns short snippets untouched', () => {
    expect(capSnippet('one\ntwo')).toBe('one\ntwo');
  });
});

describe('normalizeClaimedPath', () => {
  it('normalizes separators and leading ./', () => {
    expect(normalizeClaimedPath('.\\src\\lib\\cart.ts'.replace(/\\\\/g, '\\'))).toBe(
      'src/lib/cart.ts'
    );
    expect(normalizeClaimedPath('./src/lib/cart.ts')).toBe('src/lib/cart.ts');
  });
});

describe('sliceAround', () => {
  it('slices ±1 line around a 1-based line', () => {
    expect(sliceAround(['a', 'b', 'c', 'd'], 2)).toBe('a\nb\nc');
  });

  it('returns undefined for a non-positive line', () => {
    expect(sliceAround(['a'], 0)).toBeUndefined();
  });
});

describe('enrichLocation', () => {
  const evidence: SpanEvidence[] = [
    { file: 'src/lib/cart.ts', startLine: 40, endLine: 45, snippet: 'span code' },
    { file: 'src/lib/cart.ts', startLine: 90, endLine: 95, snippet: 'other span' }
  ];

  it('keeps a caller-supplied snippet untouched', () => {
    const loc = enrichLocation({ file: 'src/lib/cart.ts', line: 42, snippet: 'the code' }, evidence);
    expect(loc.snippet).toBe('the code');
    expect(loc.unverified).toBeUndefined();
  });

  it('slices the checkout when a reader is available', () => {
    const loc = enrichLocation(
      { file: 'src/lib/cart.ts', line: 2 },
      evidence,
      () => ['a', 'b', 'c']
    );
    expect(loc.snippet).toBe('a\nb\nc');
    expect(loc.unverified).toBeUndefined();
  });

  it('falls back to the span covering the claimed line in the same file', () => {
    const loc = enrichLocation({ file: 'src/lib/cart.ts', line: 91 }, evidence);
    expect(loc.snippet).toBe('other span');
    expect(loc.unverified).toBeUndefined();
  });

  it('adopts the span line when the claim carried none', () => {
    const loc = enrichLocation({ file: './src/lib/cart.ts' }, evidence);
    expect(loc.line).toBe(40);
    expect(loc.snippet).toBe('span code');
  });

  it('refuses a span from a different file and stamps unverified', () => {
    const loc = enrichLocation({ file: 'src/other.ts', line: 42 }, evidence);
    expect(loc.snippet).toBeUndefined();
    expect(loc.unverified).toBe(true);
  });

  it('stamps unverified when there is no evidence at all', () => {
    const loc = enrichLocation({ file: 'src/lib/cart.ts', line: 42 }, [], null);
    expect(loc.unverified).toBe(true);
  });
});
