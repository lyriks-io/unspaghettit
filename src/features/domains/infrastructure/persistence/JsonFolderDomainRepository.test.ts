import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import type { Domain } from '../../domain/entities/Domain';
import { asDomainId } from '../../domain/value-objects/ids';
import { exportDomainToJson, importDomainFromJson } from '../io/DomainJson';
import { JsonFolderDomainRepository } from './JsonFolderDomainRepository';

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'unspa-domains-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const domain = (id: string, name: string, updatedAt: string, projectIds: string[] = []): Domain => ({
  id: asDomainId(id),
  name,
  projectIds: projectIds.map(asProjectId),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt
});

describe('JsonFolderDomainRepository', () => {
  it('saves a domain as one file named after it, and reads it back', async () => {
    const dir = join(freshDir(), 'domains');
    const repo = new JsonFolderDomainRepository(dir);
    expect(await repo.list()).toEqual([]);
    const sales = domain('d1', 'Sales & Marketing!', '2026-02-01T00:00:00.000Z', ['p1', 'p2']);
    await repo.save(sales);
    expect(readdirSync(dir)).toEqual(['sales-marketing.domain.json']);
    expect(await new JsonFolderDomainRepository(dir).get(asDomainId('d1'))).toEqual(sales);
    expect(await repo.get(asDomainId('nope'))).toBeNull();
  });

  it('lists summaries, most recently updated first, with their project count', async () => {
    const repo = new JsonFolderDomainRepository(freshDir());
    await repo.save(domain('d1', 'Sales', '2026-02-01T00:00:00.000Z', ['p1']));
    await repo.save(domain('d2', 'Tech', '2026-03-01T00:00:00.000Z'));
    expect((await repo.list()).map((s) => [s.name, s.projectCount])).toEqual([
      ['Tech', 0],
      ['Sales', 1]
    ]);
  });

  it('moves the file when a domain is renamed, leaving no stale copy', async () => {
    const dir = freshDir();
    const repo = new JsonFolderDomainRepository(dir);
    await repo.save(domain('d1', 'Sales', '2026-02-01T00:00:00.000Z'));
    await repo.save(domain('d1', 'Revenue', '2026-02-02T00:00:00.000Z'));
    expect(readdirSync(dir)).toEqual(['revenue.domain.json']);
    expect((await repo.list()).map((s) => s.name)).toEqual(['Revenue']);
  });

  it('keeps two domains with the same name apart, the second file suffixed with its id', async () => {
    const dir = freshDir();
    const repo = new JsonFolderDomainRepository(dir);
    await repo.save(domain('aaaaaaaa-1', 'Ops', '2026-02-01T00:00:00.000Z'));
    await repo.save(domain('bbbbbbbb-2', 'Ops', '2026-02-02T00:00:00.000Z'));
    expect(readdirSync(dir).sort()).toEqual(['ops-bbbbbbbb.domain.json', 'ops.domain.json']);
    expect((await repo.get(asDomainId('aaaaaaaa-1')))?.name).toBe('Ops');
    expect((await repo.get(asDomainId('bbbbbbbb-2')))?.name).toBe('Ops');
  });

  it('deletes a domain\'s file, and deleting an unknown one does nothing', async () => {
    const dir = freshDir();
    const repo = new JsonFolderDomainRepository(dir);
    await repo.save(domain('d1', 'Sales', '2026-02-01T00:00:00.000Z'));
    await repo.save(domain('d2', 'Tech', '2026-02-01T00:00:00.000Z'));
    await repo.delete(asDomainId('d1'));
    await repo.delete(asDomainId('ghost'));
    expect(readdirSync(dir)).toEqual(['tech.domain.json']);
  });

  it('skips a malformed file instead of failing the whole list', async () => {
    const dir = freshDir();
    const repo = new JsonFolderDomainRepository(dir);
    await repo.save(domain('d1', 'Sales', '2026-02-01T00:00:00.000Z'));
    writeFileSync(join(dir, 'broken.domain.json'), '{nope');
    writeFileSync(join(dir, 'other.domain.json'), JSON.stringify({ format: 'something-else', version: 1 }));
    expect((await repo.list()).map((s) => s.name)).toEqual(['Sales']);
  });
});

describe('importDomainFromJson', () => {
  it('reads back what was exported, and an envelope without project ids as none', () => {
    const sales = domain('d1', 'Sales', '2026-02-01T00:00:00.000Z', ['p1']);
    expect(importDomainFromJson(exportDomainToJson(sales))).toEqual(sales);
    const { projectIds: _dropped, ...bare } = sales;
    void _dropped;
    expect(
      importDomainFromJson(JSON.stringify({ format: 'unspaghettit-domain', version: 1, domain: bare })).projectIds
    ).toEqual([]);
  });

  it('refuses what is not a version 1 domain export, saying why', () => {
    expect(() => importDomainFromJson('{x')).toThrow('Invalid JSON');
    expect(() => importDomainFromJson('null')).toThrow('Expected a domain export object');
    expect(() => importDomainFromJson('{"format":"unspaghettit-project","version":1}')).toThrow('unrecognized format');
    expect(() => importDomainFromJson('{"format":"unspaghettit-domain","version":2}')).toThrow('Unsupported export version: 2');
    expect(() => importDomainFromJson('{"format":"unspaghettit-domain","version":1}')).toThrow('missing a domain');
  });
});
