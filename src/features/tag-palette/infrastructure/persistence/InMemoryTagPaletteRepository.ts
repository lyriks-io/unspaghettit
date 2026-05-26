import { emptyTagPalette, type TagPalette } from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';

export class InMemoryTagPaletteRepository implements TagPaletteRepository {
  constructor(private palette: TagPalette = emptyTagPalette) {}

  async get(): Promise<TagPalette> {
    return this.palette;
  }

  async save(palette: TagPalette): Promise<void> {
    this.palette = palette;
  }
}
