import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asExposureId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { NBSP } from '$shared/language';
import type { DigestSpec } from '../DigestSpec';
import { buildDigest } from './buildDigest';

const emptyAction = (id: string, name: string, intent: string): Action => ({
  id: asActionId(id),
  name,
  intent,
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
});

// Model-authored text is written in English on purpose: the digest must carry
// it verbatim, whatever the language of its own sentences.
const REASON = 'Open a scope before generating a summary.';
const INTENT = 'Build a plain-language summary of the scope.';
const MESSAGE = 'You can only export a summary that has finished generating.';

const generate: Action = {
  ...emptyAction('gen', 'Generate Digest', INTENT),
  requiredStates: [asStatePath('source.loaded'), asStatePath('user.signedIn')],
  rules: [
    {
      id: asRuleId('r1'),
      category: 'permissions',
      condition: { left: asStatePath('source.loaded'), operator: 'is_false' },
      effect: { id: asEffectId('b1'), type: 'block_action', reason: REASON }
    }
  ],
  effects: [
    { id: asEffectId('e1'), type: 'set_state', path: asStatePath('digest.status'), value: 'ready' },
    { id: asEffectId('e2'), type: 'set_state', path: asStatePath('digest.count'), value: 1.5 },
    { id: asEffectId('e3'), type: 'set_state', path: asStatePath('digest.stale'), value: false },
    { id: asEffectId('e4'), type: 'set_state', path: asStatePath('digest.error'), value: null },
    { id: asEffectId('e5'), type: 'show_message', message: 'Done', tone: 'success' } as never,
    {
      id: asEffectId('e6'),
      type: 'append_to_list',
      path: asStatePath('digest.history'),
      value: 'x'
    } as never,
    { id: asEffectId('e7'), type: 'invoke_operation', operation: 'renderDigest' } as never,
    { id: asEffectId('e8'), type: 'advance_time' } as never
  ],
  emittedEvents: [
    asEventName('digest.generated'),
    asEventName('digest.shown'),
    asEventName('digest.logged')
  ],
  exposures: [
    { id: asExposureId('x1'), channel: 'api', operation: 'POST /digests' },
    { id: asExposureId('x0'), channel: 'ui' },
    {
      id: asExposureId('x2'),
      channel: 'mcp',
      withheld: { reason: 'Too costly for an agent loop.' }
    }
  ]
};

const openExport: Action = {
  ...emptyAction('open', 'Open Export', 'Open the export panel.'),
  requiredStates: [asStatePath('digest.status')],
  effects: [{ id: asEffectId('o1'), type: 'transition_surface', target: asSurfaceId('export') }],
  emittedEvents: [asEventName('export.opened')]
};

const nightly: Action = {
  ...emptyAction('nightly', 'Refresh nightly', 'Rebuild every summary overnight.'),
  actor: 'schedule'
};

const onChange: Action = {
  ...emptyAction('react', 'Refresh on change', 'Rebuild the summary when the model moves.'),
  triggeredByEvent: asEventName('model.changed')
};

const closeExport: Action = {
  ...emptyAction('close', 'Close Export', 'Close the export panel.'),
  effects: [{ id: asEffectId('c1'), type: 'transition_surface', target: asSurfaceId('panel') }]
};

const panel: Surface = {
  id: asSurfaceId('panel'),
  name: 'Digest Panel',
  type: 'screen',
  description: 'Where a reader generates and reads the summary.',
  stateDefinitions: [],
  actions: [generate, openExport, nightly, onChange],
  rules: [],
  invariants: [
    {
      id: asInvariantId('inv1'),
      name: 'Exports reflect a ready digest',
      condition: { left: asStatePath('digest.status'), operator: 'equals', right: 'ready' },
      message: MESSAGE
    }
  ],
  transitions: []
};

const exportPanel: Surface = {
  id: asSurfaceId('export'),
  name: 'Digest Export',
  type: 'dialog_area',
  description: 'Copy or download the summary.',
  stateDefinitions: [],
  actions: [closeExport],
  rules: [],
  invariants: [],
  transitions: [{ id: asTransitionId('t-close'), target: asSurfaceId('panel'), label: 'Close' }]
};

const feature: Feature = {
  id: asFeatureId('f-digest'),
  name: 'Behavioral Digest',
  description: 'Summarize any scope of the model in plain language. Then share it.',
  surfaces: [panel, exportPanel],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
};

/** A model name in French guillemets, with its no-break spaces. */
const g = (name: string): string => `«${NBSP}${name}${NBSP}»`;

const ENGLISH_CONNECTIVES =
  /\b(Guard|Sets|Updates|Emits|Fired|Reachable|Kept off|needs|opens|shows|adds to|removes from|calls|advances|What you can do|What always holds|Where you can go|Features| to )\b/;

/** Every string the digest wrote itself (headings and details, never model text). */
const generatedText = (spec: DigestSpec): string[] =>
  spec.sections.flatMap((section) => [
    section.heading,
    ...section.lines.flatMap((line) => line.details ?? [])
  ]);

const detailsOf = (spec: DigestSpec, label: string): readonly string[] =>
  spec.sections.find((s) => s.kind === 'capabilities')?.lines.find((l) => l.label === label)
    ?.details ?? [];

describe('buildDigest in French', () => {
  const full = buildDigest({
    features: [feature],
    scope: { kind: 'feature', featureId: 'f-digest' },
    detailLevel: 'full',
    language: 'fr'
  });

  it('writes the feature digest at full detail in French, model text verbatim', () => {
    expect(full.title).toBe('Behavioral Digest');
    expect(full.sections.map((s) => s.heading)).toEqual([
      'Ce que vous pouvez faire ici',
      'Ce qui reste toujours vrai',
      'Où vous pouvez aller'
    ]);
    expect(full.sections.map((s) => s.kind)).toEqual(['capabilities', 'guardrails', 'navigation']);

    const line = full.sections[0]?.lines.find((l) => l.label === 'Generate Digest');
    expect(line?.text).toBe(INTENT);
    expect(line?.sourceElementId).toBe('gen');
    expect(line?.sourceElementType).toBe('action');
    expect(line?.details).toEqual([
      'Accessible par les canaux api (POST /digests) et ui',
      `Volontairement absente du canal mcp${NBSP}: Too costly for an agent loop.`,
      `Passe l'état ${g('Digest status')} à ${g('ready')}`,
      `Passe l'état ${g('Digest count')} à 1,5`,
      `Passe l'état ${g('Digest stale')} à faux`,
      `Vide l'état ${g('Digest error')}`,
      'Affiche un message de réussite',
      `Ajoute un élément à l'état ${g('Digest history')}`,
      `Appelle l'opération ${g('renderDigest')}`,
      'Fait avancer le temps',
      `Émet les événements ${g('digest.generated')}, ${g('digest.shown')} et ${g('digest.logged')}`,
      `Garde${NBSP}: ${REASON}`,
      `Garde${NBSP}: nécessite les états ${g('Source loaded')} et ${g('User signed in')}`
    ]);
    expect(full.sections[1]?.lines[0]?.text).toBe(MESSAGE);
    expect(full.sections[1]?.lines[0]?.label).toBe('Exports reflect a ready digest');
  });

  it('uses the singular until there are two, and quotes surface names', () => {
    expect(detailsOf(full, 'Open Export')).toEqual([
      `Ouvre la surface «${NBSP}Digest Export${NBSP}»`,
      `Émet l'événement ${g('export.opened')}`,
      `Garde${NBSP}: nécessite l'état ${g('Digest status')}`
    ]);
  });

  it('says who fires an action in French only when it is not a person', () => {
    expect(detailsOf(full, 'Refresh nightly')).toEqual([
      'Déclenchée selon une planification, pas par une personne'
    ]);
    expect(detailsOf(full, 'Refresh on change')).toEqual([
      `Déclenchée par l'événement ${g('model.changed')}, pas par une personne`
    ]);
  });

  it('writes navigation with quoted surface names and the label verbatim', () => {
    const nav = full.sections.find((s) => s.kind === 'navigation')?.lines.map((l) => l.text);
    expect(nav).toEqual([
      `«${NBSP}Digest Panel${NBSP}» vers «${NBSP}Digest Export${NBSP}» (Open Export)`,
      `«${NBSP}Digest Export${NBSP}» vers «${NBSP}Digest Panel${NBSP}» (Close)`
    ]);
  });

  it('leaks no English connective into what it writes itself', () => {
    for (const text of generatedText(full)) expect(text).not.toMatch(ENGLISH_CONNECTIVES);
    // Every colon it writes carries its no-break space.
    for (const text of generatedText(full)) expect(text).not.toMatch(/[^\u00a0]:/);
  });

  it('keeps the same structure, ids and source ids as the English digest', () => {
    const english = buildDigest({
      features: [feature],
      scope: { kind: 'feature', featureId: 'f-digest' },
      detailLevel: 'full'
    });
    const skeleton = (spec: DigestSpec) =>
      spec.sections.map((s) => ({
        kind: s.kind,
        lines: s.lines.map((l) => [
          l.label,
          l.sourceElementId,
          l.sourceElementType,
          l.sourceSurfaceId,
          l.details?.length
        ])
      }));
    expect(skeleton(full)).toEqual(skeleton(english));
    expect(english.sections[0]?.heading).toBe('What you can do here');
  });

  it('standard keeps guards and guardrails in French, without effects or navigation', () => {
    const spec = buildDigest({
      features: [feature],
      scope: { kind: 'feature', featureId: 'f-digest' },
      detailLevel: 'standard',
      language: 'fr'
    });
    expect(spec.sections.map((s) => s.heading)).toEqual([
      'Ce que vous pouvez faire ici',
      'Ce qui reste toujours vrai'
    ]);
    expect(detailsOf(spec, 'Open Export')).toEqual([
      `Garde${NBSP}: nécessite l'état ${g('Digest status')}`
    ]);
    expect(detailsOf(spec, 'Generate Digest').some((d) => d.startsWith('Passe'))).toBe(false);
  });

  it('glance names the actions under a French heading', () => {
    const spec = buildDigest({
      features: [feature],
      scope: { kind: 'feature', featureId: 'f-digest' },
      detailLevel: 'glance',
      language: 'fr'
    });
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.heading).toBe('Ce que vous pouvez faire ici');
    expect(spec.sections[0]?.lines.map((l) => l.label)).toEqual([
      'Generate Digest',
      'Open Export',
      'Refresh nightly',
      'Refresh on change',
      'Close Export'
    ]);
  });

  it('summarizes one surface in French', () => {
    const spec = buildDigest({
      features: [feature],
      scope: { kind: 'surface', featureId: 'f-digest', surfaceId: 'export' },
      detailLevel: 'full',
      language: 'fr'
    });
    expect(spec.title).toBe('Digest Export');
    expect(spec.purposeLine).toBe('Copy or download the summary.');
    expect(detailsOf(spec, 'Close Export')).toEqual([
      `Ouvre la surface «${NBSP}Digest Panel${NBSP}»`
    ]);
    expect(spec.sections.find((s) => s.kind === 'navigation')?.lines[0]?.text).toBe(
      `«${NBSP}Digest Export${NBSP}» vers «${NBSP}Digest Panel${NBSP}» (Close)`
    );
  });

  it('summarizes one action in French, its intent as the purpose', () => {
    const spec = buildDigest({
      features: [feature],
      scope: { kind: 'action', featureId: 'f-digest', surfaceId: 'panel', actionId: 'open' },
      detailLevel: 'full',
      language: 'fr'
    });
    expect(spec.title).toBe('Open Export');
    expect(spec.purposeLine).toBe('Open the export panel.');
    expect(spec.sections.map((s) => s.heading)).toEqual([
      'Ce que vous pouvez faire ici',
      'Où vous pouvez aller'
    ]);
  });

  it('names a single channel in the singular', () => {
    const solo: Feature = {
      ...feature,
      surfaces: [
        {
          ...exportPanel,
          actions: [{ ...closeExport, exposures: [{ id: asExposureId('x9'), channel: 'ui' }] }]
        }
      ]
    };
    const spec = buildDigest({
      features: [solo],
      scope: { kind: 'feature', featureId: 'f-digest' },
      detailLevel: 'standard',
      language: 'fr'
    });
    expect(detailsOf(spec, 'Close Export')).toEqual(['Accessible par le canal ui']);
  });

  it('summarizes a project in French, one first sentence per feature', () => {
    const spec = buildDigest({
      features: [feature],
      scope: { kind: 'project' },
      detailLevel: 'standard',
      language: 'fr'
    });
    expect(spec.title).toBe('Projet');
    expect(spec.sections[0]?.heading).toBe('Fonctionnalités');
    expect(spec.sections[0]?.lines[0]?.text).toBe(
      'Summarize any scope of the model in plain language.'
    );
    const named = buildDigest({
      features: [feature],
      project: { id: 'p1', name: 'Tableau de bord', description: 'Le tableau local.' } as never,
      scope: { kind: 'project' },
      detailLevel: 'glance',
      language: 'fr'
    });
    expect(named.title).toBe('Tableau de bord');
    expect(named.sections[0]?.lines[0]?.text).toBe('');
  });
});
