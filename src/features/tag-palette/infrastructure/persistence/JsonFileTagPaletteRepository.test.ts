import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyTagPalette } from '$shared/domain/TagPalette';
import { importTagPaletteFromJson } from '../io/TagPaletteJson';
import { JsonFileTagPaletteRepository } from './JsonFileTagPaletteRepository';

const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'unspa-palette-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('JsonFileTagPaletteRepository', () => {
  it('reads back what it saved, the "no color" choice included, creating its folder', async () => {
    const dir = join(freshDir(), 'nested', 'hub');
    const repo = new JsonFileTagPaletteRepository(dir);
    expect(await repo.get()).toBe(emptyTagPalette);
    const palette = { assignments: { team: '#3b82f6', phase: null } };
    await repo.save(palette);
    expect(await new JsonFileTagPaletteRepository(dir).get()).toEqual(palette);
    expect(JSON.parse(readFileSync(join(dir, 'tag-palette.json'), 'utf8'))).toEqual({ version: 1, ...palette });
  });

  it('falls back to an empty palette on a file that is not a palette', async () => {
    const dir = freshDir();
    for (const raw of ['', '{oops', '42', '{"assignments": "red"}']) {
      writeFileSync(join(dir, 'tag-palette.json'), raw);
      expect(await new JsonFileTagPaletteRepository(dir).get()).toEqual(emptyTagPalette);
    }
  });
});

describe('importTagPaletteFromJson', () => {
  it('keeps valid entries under normalized type names, lowercases colors, and drops the rest', () => {
    const raw = JSON.stringify({
      version: 1,
      assignments: { ' Team ': '#3B82F6', phase: null, owner: 'blue', short: '#fff', '  ': '#000000' }
    });
    expect(importTagPaletteFromJson(raw)).toEqual({ assignments: { team: '#3b82f6', phase: null } });
  });
});
