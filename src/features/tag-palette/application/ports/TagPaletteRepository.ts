import type { TagPalette } from '$shared/domain/TagPalette';

export interface TagPaletteRepository {
  get(): Promise<TagPalette>;
  save(palette: TagPalette): Promise<void>;
}
