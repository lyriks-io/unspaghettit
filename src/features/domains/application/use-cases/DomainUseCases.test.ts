import { describe, expect, it } from 'vitest';
import { fixedClock } from '$shared/domain/Clock';
import { asProjectId } from '$features/projects/domain/value-objects/ids';
import { asDomainId } from '../../domain/value-objects/ids';
import { InMemoryDomainRepository } from '../../infrastructure/persistence/InMemoryDomainRepository';
import { addProjectToDomainUseCase } from './AddProjectToDomain';
import { createDomainUseCase } from './CreateDomain';
import { removeProjectFromDomainUseCase } from './RemoveProjectFromDomain';

const CREATED = '2026-01-01T00:00:00.000Z';
const LATER = '2026-06-01T00:00:00.000Z';

const withSales = async () => {
  const repository = new InMemoryDomainRepository();
  const create = createDomainUseCase({ repository, ids: () => 'dom-1', clock: fixedClock(CREATED) });
  const sales = await create({ name: '  Sales  ', description: '  Selling.  ' });
  return { repository, sales };
};

describe('domains', () => {
  it('creates a domain with a trimmed name and description and no project, and stores it', async () => {
    const { repository, sales } = await withSales();
    expect(sales).toEqual({
      id: 'dom-1',
      name: 'Sales',
      description: 'Selling.',
      projectIds: [],
      createdAt: CREATED,
      updatedAt: CREATED
    });
    expect(await repository.get(asDomainId('dom-1'))).toEqual(sales);
  });

  it('refuses a blank name and keeps a blank description out', async () => {
    const repository = new InMemoryDomainRepository();
    const create = createDomainUseCase({ repository, ids: () => 'dom-x', clock: fixedClock(CREATED) });
    await expect(create({ name: '   ' })).rejects.toThrow('Domain name is required');
    expect(await repository.list()).toEqual([]);
    expect((await create({ name: 'Tech', description: '   ' })).description).toBeUndefined();
  });

  it('adds a project once, and adding it again changes nothing', async () => {
    const { repository } = await withSales();
    const add = addProjectToDomainUseCase({ repository, clock: fixedClock(LATER) });
    const added = await add(asDomainId('dom-1'), asProjectId('p-1'));
    expect(added).toMatchObject({ projectIds: ['p-1'], updatedAt: LATER });

    const again = addProjectToDomainUseCase({ repository, clock: fixedClock('2026-12-01T00:00:00.000Z') });
    expect(await again(asDomainId('dom-1'), asProjectId('p-1'))).toEqual(added);
    expect((await repository.get(asDomainId('dom-1')))?.updatedAt).toBe(LATER);
  });

  it('removes a project and keeps the others', async () => {
    const { repository } = await withSales();
    const add = addProjectToDomainUseCase({ repository, clock: fixedClock(LATER) });
    await add(asDomainId('dom-1'), asProjectId('p-1'));
    await add(asDomainId('dom-1'), asProjectId('p-2'));
    const removed = await removeProjectFromDomainUseCase({ repository, clock: fixedClock(LATER) })(
      asDomainId('dom-1'),
      asProjectId('p-1')
    );
    expect(removed.projectIds).toEqual(['p-2']);
    expect((await repository.list())[0]?.projectCount).toBe(1);
  });

  it('refuses to add to or remove from a domain that does not exist', async () => {
    const repository = new InMemoryDomainRepository();
    const clock = fixedClock(LATER);
    await expect(addProjectToDomainUseCase({ repository, clock })(asDomainId('nope'), asProjectId('p'))).rejects.toThrow(
      'Domain nope not found'
    );
    await expect(
      removeProjectFromDomainUseCase({ repository, clock })(asDomainId('nope'), asProjectId('p'))
    ).rejects.toThrow('Domain nope not found');
  });
});
