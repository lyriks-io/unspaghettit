import { describe, expect, it } from 'vitest';
import { computeChangeDescriptor, formatChangeLabel } from './changeDescriptor';

const feature = (overrides: Record<string, unknown> = {}) => ({
  id: 'f-1',
  name: 'Inbox',
  description: 'desc',
  surfaces: [
    {
      id: 's-1',
      name: 'Inbox List',
      description: 'main list',
      actions: [{ id: 'a-1', name: 'Open Item', rules: [], effects: [], invariants: [], parameters: [] }],
      stateDefinitions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  ...overrides
});

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  name: 'Recipe Box',
  description: 'desc',
  featureIds: ['f-1'],
  implementationQueue: [],
  ...overrides
});

describe('computeChangeDescriptor — feature', () => {
  it('first save (no prev snapshot) marks the entity as created', () => {
    const d = computeChangeDescriptor('feature', null, feature());
    expect(d).toEqual({ op: 'created', path: ['Inbox'] });
  });

  it('renames win over everything else', () => {
    const prev = feature();
    const next = feature({ name: 'Inbox v2' });
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({ op: 'renamed', path: ['Inbox v2'], previousName: 'Inbox' });
  });

  it('adding a surface produces a 2-segment breadcrumb', () => {
    const prev = feature();
    const next = feature({
      surfaces: [...feature().surfaces, { id: 's-2', name: 'Cart', actions: [], rules: [], invariants: [], stateDefinitions: [], transitions: [] }]
    });
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({ op: 'added', path: ['Inbox', 'Cart'] });
  });

  it('adding an action breadcrumbs feature â€º surface â€º action', () => {
    const prev = feature();
    const baseSurface = feature().surfaces[0]!;
    const next = feature({
      surfaces: [
        {
          ...baseSurface,
          actions: [
            ...baseSurface.actions,
            { id: 'a-2', name: 'Archive Item', rules: [], effects: [], invariants: [], parameters: [] }
          ]
        }
      ]
    });
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({ op: 'added', path: ['Inbox', 'Inbox List', 'Archive Item'] });
  });

  it('renaming an action breadcrumbs and carries the previous name', () => {
    const prev = feature();
    const baseSurface = feature().surfaces[0]!;
    const baseAction = baseSurface.actions[0]!;
    const next = feature({
      surfaces: [
        {
          ...baseSurface,
          actions: [{ ...baseAction, name: 'Open Detail' }]
        }
      ]
    });
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({
      op: 'renamed',
      path: ['Inbox', 'Inbox List', 'Open Detail'],
      previousName: 'Open Item'
    });
  });

  it('counted children: adding a rule on an action breadcrumbs to the rule label', () => {
    const prev = feature();
    const baseSurface = feature().surfaces[0]!;
    const baseAction = baseSurface.actions[0]!;
    const next = feature({
      surfaces: [
        {
          ...baseSurface,
          actions: [
            {
              ...baseAction,
              rules: [{ id: 'r-1' }]
            }
          ]
        }
      ]
    });
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({ op: 'added', path: ['Inbox', 'Inbox List', 'Open Item', 'rule'] });
  });

  it('falls back to saved when nothing identifiable changed', () => {
    const prev = feature();
    const next = feature();
    const d = computeChangeDescriptor('feature', prev, next);
    expect(d).toEqual({ op: 'saved', path: ['Inbox'] });
  });
});

describe('computeChangeDescriptor — project', () => {
  it('attaches a feature, resolving its name', () => {
    const prev = project();
    const next = project({ featureIds: ['f-1', 'f-2'] });
    const d = computeChangeDescriptor('project', prev, next, (fid) => (fid === 'f-2' ? 'Cart' : undefined));
    expect(d).toEqual({ op: 'added', path: ['Recipe Box', 'Cart'] });
  });

  it('falls back to a sliced id when the feature name is not in the resolver', () => {
    const prev = project();
    const next = project({ featureIds: ['f-1', 'f-9999abcd'] });
    const d = computeChangeDescriptor('project', prev, next);
    expect(d.op).toBe('added');
    expect(d.path[0]).toBe('Recipe Box');
    expect(d.path[1]).toMatch(/^feature /);
  });

  it('queueing a feature item breadcrumbs the resolved feature name', () => {
    const prev = project();
    const next = project({
      implementationQueue: [{ id: 'q-1', kind: 'feature', featureId: 'f-1', addedAt: '2026-05-22T00:00:00.000Z' }]
    });
    const d = computeChangeDescriptor('project', prev, next, (fid) => (fid === 'f-1' ? 'Inbox' : undefined));
    expect(d).toEqual({ op: 'queued', path: ['Recipe Box', 'Inbox'] });
  });
});

describe('formatChangeLabel', () => {
  it('formats added with the breadcrumb path', () => {
    expect(formatChangeLabel({ op: 'added', path: ['Inbox', 'Inbox List', 'Archive Item'] })).toBe(
      'Added Inbox â€º Inbox List â€º Archive Item'
    );
  });

  it('formats rename with the previous name', () => {
    expect(
      formatChangeLabel({ op: 'renamed', path: ['Inbox', 'Inbox List', 'Open Detail'], previousName: 'Open Item' })
    ).toBe('Renamed to "Open Detail" (was "Open Item")');
  });

  it('falls back to Saved with the leaf when op is saved', () => {
    expect(formatChangeLabel({ op: 'saved', path: ['Inbox'] })).toBe('Saved Inbox');
  });
});
