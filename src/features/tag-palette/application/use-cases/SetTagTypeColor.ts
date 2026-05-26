import {
  clearTypeColor,
  isTagColor,
  setTypeColor,
  type TagColor,
  type TagPalette
} from '$shared/domain/TagPalette';
import type { TagPaletteRepository } from '$features/tag-palette/application/ports/TagPaletteRepository';

export type SetTagTypeColorInput = {
  readonly type: string;
  // null clears the explicit assignment so the type renders as "no color".
  readonly color: TagColor | null;
};

export const setTagTypeColorUseCase =
  (deps: { repository: TagPaletteRepository }) =>
  async (input: SetTagTypeColorInput): Promise<TagPalette> => {
    if (input.color !== null && !isTagColor(input.color)) {
      throw new Error(
        `Invalid tag color "${String(input.color)}". Expected a 6-digit hex like "#3b82f6".`
      );
    }
    const current = await deps.repository.get();
    const next =
      input.color === null
        ? clearTypeColor(current, input.type)
        : setTypeColor(current, input.type, input.color);
    if (next === current) return current;
    await deps.repository.save(next);
    return next;
  };
