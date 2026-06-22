import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asFeatureId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { exportFeatureToJson } from '$features/behavior-model/infrastructure/io/FeatureJson';
import type { Project } from '$features/projects/domain/entities/Project';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { exportProjectToJson } from '$features/projects/infrastructure/io/ProjectJson';
import type { Domain } from '$features/domains/domain/entities/Domain';
import { asDomainId } from '$features/domains/domain/value-objects/ids';
import { exportDomainToJson } from '$features/domains/infrastructure/io/DomainJson';
import {
  featureFilePath,
  projectFilePath
} from '$shared/infrastructure/persistence/snapshotLayout';
import type { SearchDoc } from '$features/global-search/domain/SearchDoc';
import { getSearchIndexFor } from './searchIndex';

const TS = '2026-06-08T00:00:00.000Z';

const makeFeature = (id: string, name: string): Feature => ({
  id: asFeatureId(id),
  name,
  description: `${name} flow.`,
  tags: [],
  surfaces: [
    {
      id: asSurfaceId(`${id}-screen`),
      name: 'Checkout',
      type: 'screen',
      description: 'Place the order.',
      stateDefinitions: [],
      rules: [],
      invariants: [],
      transitions: [],
      actions: [
        {
          id: asActionId(`${id}-apply`),
          name: 'Apply Coupon',
          intent: 'Apply a discount code.',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ]
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: TS,
  updatedAt: TS
});

const project: Project = {
  id: asProjectId('shop'),
  name: 'Shop',
  description: 'The storefront.',
  tags: [],
  featureIds: [asFeatureId('commerce')],
  createdAt: TS,
  updatedAt: TS
};

const domain: Domain = {
  id: asDomainId('sales'),
  name: 'Sales',
  description: 'Revenue area.',
  projectIds: [asProjectId('shop')],
  createdAt: TS,
  updatedAt: TS
};

const titlesOf = (docs: readonly SearchDoc[], kind: SearchDoc['kind']): string[] =>
  docs.filter((d) => d.kind === kind).map((d) => d.title);

describe('getSearchIndexFor', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-search-'));
    // Project + its feature live inside the project's folder; domains stay flat.
    mkdirSync(join(root, 'shop'), { recursive: true });
    writeFileSync(projectFilePath(root, 'shop'), exportProjectToJson(project), 'utf8');
    writeFileSync(
      featureFilePath(root, 'shop', 'commerce'),
      exportFeatureToJson(makeFeature('commerce', 'Commerce')),
      'utf8'
    );
    writeFileSync(join(root, 'sales.domain.json'), exportDomainToJson(domain), 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds one doc per modeled element and persists the index file', async () => {
    const docs = await getSearchIndexFor(root);

    expect(titlesOf(docs, 'project')).toContain('Shop');
    expect(titlesOf(docs, 'feature')).toContain('Commerce');
    expect(titlesOf(docs, 'surface')).toContain('Checkout');
    expect(titlesOf(docs, 'action')).toContain('Apply Coupon');
    expect(titlesOf(docs, 'domain')).toContain('Sales');

    // The action carries its breadcrumb (proves the full walk ran server-side).
    const action = docs.find((d) => d.kind === 'action')!;
    expect(action.projectName).toBe('Shop');
    expect(action.featureName).toBe('Commerce');

    const indexFile = join(root, '.search-index.json');
    expect(existsSync(indexFile)).toBe(true);
    const persisted = JSON.parse(readFileSync(indexFile, 'utf8')) as {
      version: string;
      docs: SearchDoc[];
    };
    expect(typeof persisted.version).toBe('string');
    expect(persisted.docs.length).toBe(docs.length);
  });

  it('serves the cached result when nothing changed (no rebuild)', async () => {
    const first = await getSearchIndexFor(root);
    const second = await getSearchIndexFor(root);
    // Same array reference ⇒ the stamp matched and no rebuild happened.
    expect(second).toBe(first);
  });

  it('rebuilds when a snapshot file is added (stamp changes)', async () => {
    const before = await getSearchIndexFor(root);
    expect(titlesOf(before, 'feature')).not.toContain('Billing');

    mkdirSync(join(root, '__unassigned'), { recursive: true });
    writeFileSync(
      featureFilePath(root, null, 'billing'),
      exportFeatureToJson(makeFeature('billing', 'Billing')),
      'utf8'
    );

    const after = await getSearchIndexFor(root);
    expect(after).not.toBe(before);
    expect(titlesOf(after, 'feature')).toContain('Billing');
    expect(titlesOf(after, 'feature')).toContain('Commerce');
  });
});
