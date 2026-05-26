import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { emptyTagPalette, type TagPalette } from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';
import {
  exportTagPaletteToJson,
  importTagPaletteFromJson
} from '$features/tag-palette/infrastructure/io/TagPaletteJson';

const PALETTE_FILE = 'tag-palette.json';

export class JsonFileTagPaletteRepository implements TagPaletteRepository {
  constructor(private readonly directory: string) {}

  async get(): Promise<TagPalette> {
    const path = join(this.directory, PALETTE_FILE);
    if (!existsSync(path)) return emptyTagPalette;
    try {
      return importTagPaletteFromJson(readFileSync(path, 'utf8'));
    } catch {
      // A corrupt palette file shouldn't break the index pages — fall back
      // to defaults and let the next save overwrite it.
      return emptyTagPalette;
    }
  }

  async save(palette: TagPalette): Promise<void> {
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, PALETTE_FILE);
    await writeFileAtomic(path, exportTagPaletteToJson(palette), 'utf8');
  }
}
