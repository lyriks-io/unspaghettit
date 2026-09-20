import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryStore } from './historyStore';
import { makeRoomId } from '../../sync/roomId';

/**
 * A host that owns the snapshot directory names each project folder by its ID
 * (`UNSPA_FILE_NAMING=id`), so the folder never matches the slug of the
 * project's NAME. The history has to follow the project, not the name.
 */
const PROJECT_ID = 'my-project-b12366';
const PROJECT_NAME = 'My Project';
const NAME_SLUG = 'my-project';

async function storeWithIdNamedProject() {
  const dir = await mkdtemp(join(tmpdir(), 'unspa-history-folder-'));
  await mkdir(join(dir, PROJECT_ID), { recursive: true });
  await writeFile(
    join(dir, PROJECT_ID, `${PROJECT_ID}.project.json`),
    JSON.stringify({ project: { id: PROJECT_ID, name: PROJECT_NAME, featureIds: [] } }),
    'utf8'
  );
  return { dir, store: new HistoryStore(dir) };
}

const entry = (id: string) => ({
  id,
  ts: 1,
  author: 'system',
  label: 'Initial state',
  snapshot: { id: PROJECT_ID, name: PROJECT_NAME }
});

it('files a project history in the folder that already holds the project', async () => {
  const { dir, store } = await storeWithIdNamedProject();
  const room = makeRoomId('project', PROJECT_ID);
  store.getOrInit(room, 'project', PROJECT_ID, PROJECT_NAME);
  store.append(room, 'project', PROJECT_ID, entry('e1'));
  await store.flush();

  expect(await readdir(join(dir, PROJECT_ID, 'history'))).toEqual([
    `${NAME_SLUG}.project.history.json`
  ]);
  // The name slug must NOT become a second project folder beside the real one.
  expect(await readdir(dir)).toEqual([PROJECT_ID]);
  await rm(dir, { recursive: true, force: true });
});

it('still uses the name for a project that has no folder yet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unspa-history-folder-'));
  const store = new HistoryStore(dir);
  const room = makeRoomId('project', PROJECT_ID);
  store.getOrInit(room, 'project', PROJECT_ID, PROJECT_NAME);
  store.append(room, 'project', PROJECT_ID, entry('e1'));
  await store.flush();

  expect(await readdir(dir)).toEqual([NAME_SLUG]);
  await rm(dir, { recursive: true, force: true });
});
