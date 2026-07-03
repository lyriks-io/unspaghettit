import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asRuleId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { digestHasContent, digestLineCount } from '../DigestSpec';
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

const generate: Action = {
  ...emptyAction('gen', 'Generate Digest', 'Build a plain-language summary of the scope.'),
  rules: [
    {
      id: asRuleId('r1'),
      category: 'permissions',
      condition: { left: asStatePath('source.loaded'), operator: 'is_false' },
      effect: {
        id: asEffectId('b1'),
        type: 'block_action',
        reason: 'Open a scope before generating a summary.'
      }
    }
  ],
  effects: [
    { id: asEffectId('e1'), type: 'set_state', path: asStatePath('digest.status'), value: 'ready' }
  ],
  emittedEvents: [asEventName('digest.generated')]
};

const openExport: Action = {
  ...emptyAction('open', 'Open Export', 'Open the export panel.'),
  effects: [{ id: asEffectId('e2'), type: 'transition_surface', target: asSurfaceId('export') }]
};

const playWalkthrough: Action = {
  ...emptyAction('play', 'Play walkthrough', 'Watch the feature run step by step.'),
  evolution: { rationale: 'You understand a flow by watching it play out.' }
};

const closeExport: Action = {
  ...emptyAction('close', 'Close Export', 'Close the export panel and return to the summary.'),
  effects: [{ id: asEffectId('e3'), type: 'transition_surface', target: asSurfaceId('panel') }]
};

const panel: Surface = {
  id: asSurfaceId('panel'),
  name: 'Digest Panel',
  type: 'screen',
  description: 'Where a reader generates and reads the summary.',
  stateDefinitions: [],
  actions: [generate, openExport, playWalkthrough],
  rules: [],
  invariants: [
    {
      id: asInvariantId('inv1'),
      name: 'Exports reflect a ready digest',
      condition: { left: asStatePath('digest.status'), operator: 'equals', right: 'ready' },
      message: 'You can only export a summary that has finished generating.'
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
  description: 'Summarize any scope of the model in plain language.',
  surfaces: [panel, exportPanel],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
};

const source = { features: [feature] };

describe('buildDigest', () => {
  it('summarizes a feature at full detail: purpose, capabilities, guardrails, navigation', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' }, detailLevel: 'full' });

    expect(spec.scope).toBe('feature');
    expect(spec.title).toBe('Behavioral Digest');
    expect(spec.purposeLine).toBe('Summarize any scope of the model in plain language.');

    const capabilities = spec.sections.find((s) => s.kind === 'capabilities');
    const guardrails = spec.sections.find((s) => s.kind === 'guardrails');
    const navigation = spec.sections.find((s) => s.kind === 'navigation');
    expect(capabilities && guardrails && navigation).toBeTruthy();

    // The generate line's lead is just the intent; effects, events, and the block
    // reason are separate detail bullets, never concatenated into the sentence.
    const generateLine = capabilities?.lines.find((l) => l.label === 'Generate Digest');
    expect(generateLine?.text).toBe('Build a plain-language summary of the scope.');
    expect(generateLine?.details).toContain('Sets Digest status to "ready"');
    expect(generateLine?.details).toContain('Emits digest.generated');
    expect(generateLine?.details).toContain('Guard: Open a scope before generating a summary.');
    expect(generateLine?.sourceElementId).toBe('gen');
    expect(generateLine?.sourceElementType).toBe('action');

    expect(guardrails?.lines[0]?.text).toBe('You can only export a summary that has finished generating.');
    expect(navigation?.lines.some((l) => l.text.includes('Digest Panel to Digest Export'))).toBe(true);
    expect(digestHasContent(spec)).toBe(true);
  });

  it('excludes Evolution proposals from the capabilities', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' }, detailLevel: 'full' });
    const capabilities = spec.sections.find((s) => s.kind === 'capabilities');
    const labels = capabilities?.lines.map((l) => l.label);

    expect(labels).toEqual(['Generate Digest', 'Open Export', 'Close Export']);
    expect(labels).not.toContain('Play walkthrough');
  });

  it('glance lists each action by name, with no guardrails or navigation', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' }, detailLevel: 'glance' });

    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0]?.kind).toBe('capabilities');
    expect(spec.sections[0]?.lines.map((l) => l.label)).toEqual([
      'Generate Digest',
      'Open Export',
      'Close Export'
    ]);
    expect(spec.sections[0]?.lines.every((l) => l.text === '')).toBe(true);
    expect(digestHasContent(spec)).toBe(true);
  });

  it('carries the feature and surface of each line so a reader can jump to the element', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' }, detailLevel: 'full' });
    const generateLine = spec.sections
      .find((s) => s.kind === 'capabilities')
      ?.lines.find((l) => l.label === 'Generate Digest');

    expect(generateLine?.sourceFeatureId).toBe('f-digest');
    expect(generateLine?.sourceSurfaceId).toBe('panel');
    expect(generateLine?.sourceElementId).toBe('gen');
  });

  it('summarizes a whole project as one clickable line per feature', () => {
    const other: Feature = { ...feature, id: asFeatureId('f-other'), name: 'Other Feature' };
    const spec = buildDigest({
      features: [feature, other],
      project: { id: 'p1', name: 'Dashboard', description: 'The local-first dashboard.' } as never,
      scope: { kind: 'project' },
      detailLevel: 'standard'
    });

    expect(spec.scope).toBe('project');
    expect(spec.title).toBe('Dashboard');
    const features = spec.sections.find((s) => s.kind === 'features');
    expect(features?.lines.map((l) => l.label)).toEqual(['Behavioral Digest', 'Other Feature']);
    expect(features?.lines[0]?.sourceElementType).toBe('feature');
    expect(features?.lines[0]?.sourceFeatureId).toBe('f-digest');
    expect(digestHasContent(spec)).toBe(true);
  });

  it('standard adds guards and guardrails but not effects, events, or navigation', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' }, detailLevel: 'standard' });

    const generateLine = spec.sections
      .find((s) => s.kind === 'capabilities')
      ?.lines.find((l) => l.label === 'Generate Digest');
    expect(generateLine?.text).toBe('Build a plain-language summary of the scope.');
    expect(generateLine?.details).toContain('Guard: Open a scope before generating a summary.');
    expect(generateLine?.details?.some((d) => d.startsWith('Emits'))).toBe(false);
    expect(generateLine?.details?.some((d) => d.startsWith('Sets Digest status'))).toBe(false);
    expect(spec.sections.some((s) => s.kind === 'guardrails')).toBe(true);
    expect(spec.sections.some((s) => s.kind === 'navigation')).toBe(false);
  });

  it('summarizes a single surface', () => {
    const spec = buildDigest({
      ...source,
      scope: { kind: 'surface', featureId: 'f-digest', surfaceId: 'export' },
      detailLevel: 'standard'
    });

    expect(spec.scope).toBe('surface');
    expect(spec.title).toBe('Digest Export');
    const capabilities = spec.sections.find((s) => s.kind === 'capabilities');
    expect(capabilities?.lines.map((l) => l.label)).toEqual(['Close Export']);
  });

  it('summarizes a single action, using its intent as the purpose', () => {
    const spec = buildDigest({
      ...source,
      scope: { kind: 'action', featureId: 'f-digest', surfaceId: 'panel', actionId: 'gen' },
      detailLevel: 'full'
    });

    expect(spec.scope).toBe('action');
    expect(spec.title).toBe('Generate Digest');
    expect(spec.purposeLine).toBe('Build a plain-language summary of the scope.');
    const capabilities = spec.sections.find((s) => s.kind === 'capabilities');
    expect(capabilities?.lines).toHaveLength(1);
  });

  it('an empty scope generates but has no content', () => {
    const bare: Surface = {
      id: asSurfaceId('bare'),
      name: 'Bare',
      type: 'screen',
      description: 'Nothing here yet.',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    };
    const bareFeature: Feature = { ...feature, surfaces: [bare] };

    const spec = buildDigest({
      features: [bareFeature],
      scope: { kind: 'surface', featureId: 'f-digest', surfaceId: 'bare' },
      detailLevel: 'full'
    });

    expect(spec.purposeLine).toBe('Nothing here yet.');
    expect(digestLineCount(spec)).toBe(0);
    expect(digestHasContent(spec)).toBe(false);
  });

  it('yields an empty digest for an unresolvable scope rather than throwing', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'does-not-exist' } });

    expect(spec.title).toBe('');
    expect(spec.sections).toHaveLength(0);
    expect(digestHasContent(spec)).toBe(false);
  });

  it('defaults to standard detail when no level is given', () => {
    const spec = buildDigest({ ...source, scope: { kind: 'feature', featureId: 'f-digest' } });
    expect(spec.detailLevel).toBe('standard');
  });
});
