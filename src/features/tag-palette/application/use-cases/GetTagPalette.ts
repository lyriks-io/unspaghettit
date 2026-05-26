import type { TagPalette } from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';

export const getTagPaletteUseCase =
  (deps: { repository: TagPaletteRepository }) =>
  async (): Promise<TagPalette> => deps.repository.get();
