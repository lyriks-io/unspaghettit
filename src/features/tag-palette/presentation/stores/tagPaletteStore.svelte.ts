import {
  emptyTagPalette,
  explicitColorOf,
  isExplicitlyCleared,
  setTypeColor,
  type TagColor,
  type TagPalette
} from '$shared/domain/TagPalette';
import { getBrowserContainer } from '$shared/infrastructure/browserContainer';
import type { Tag } from '$shared/domain/Tags';
import { assignAutoColors } from '$features/tag-palette/presentation/services/autoColorAssigner';

/**
 * Single source of truth for tag colors in the browser. Resolves the
 * effective color for a given tag type by combining:
 *
 *   - the persisted palette (explicit colors and explicit "cleared" entries)
 *   - the live set of known tag types (registered by index pages on load)
 *
 * Components ask `colorFor(type)` and don't need to know whether the result
 * came from an explicit user choice or an auto-picked preset.
 */
class TagPaletteStore {
  palette = $state<TagPalette>(emptyTagPalette);
  loaded = $state(false);
  error = $state<string | null>(null);

  // Lowercased + normalized type names currently visible somewhere in the
  // app. Index pages call `registerTypes` after each refresh so the auto
  // assignment is stable across views.
  private knownTypes = $state<readonly string[]>([]);

  private autoColors = $derived<ReadonlyMap<string, TagColor>>(
    assignAutoColors(this.knownTypes, this.palette)
  );

  async refresh(): Promise<void> {
    try {
      const container = await getBrowserContainer();
      this.palette = await container.useCases.getTagPalette();
      this.loaded = true;
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /**
   * Merge a batch of type names into the known set. Called from pages once
   * features/projects have loaded so auto-color assignment can see them.
   * Doesn't replace — registrations from different surfaces accumulate.
   */
  registerTypes(types: readonly string[]): void {
    if (types.length === 0) return;
    const merged = new Set(this.knownTypes);
    let changed = false;
    for (const t of types) {
      const normalized = t.trim().toLowerCase();
      if (!normalized) continue;
      if (!merged.has(normalized)) {
        merged.add(normalized);
        changed = true;
      }
    }
    if (changed) this.knownTypes = [...merged];
  }

  /**
   * Resolved color for a type. Returns:
   *   - the user's color if explicitly set
   *   - null if the user explicitly cleared the type ("no color")
   *   - an auto-picked preset if neither (most common path)
   */
  colorFor(type: string): TagColor | null {
    if (isExplicitlyCleared(this.palette, type)) return null;
    const explicit = explicitColorOf(this.palette, type);
    if (explicit) return explicit;
    return this.autoColors.get(type.trim().toLowerCase()) ?? null;
  }

  colorForTag(tag: Tag): TagColor | null {
    return this.colorFor(tag.type);
  }

  /** The user-set value, ignoring auto-assignment. Used by the picker UI. */
  explicitAssignmentFor(type: string): TagColor | null | undefined {
    if (isExplicitlyCleared(this.palette, type)) return null;
    const explicit = explicitColorOf(this.palette, type);
    return explicit ?? undefined;
  }

  isExplicitlyCleared(type: string): boolean {
    return isExplicitlyCleared(this.palette, type);
  }

  async setTypeColor(type: string, color: TagColor | null): Promise<void> {
    // Optimistic update so the chip recolors instantly; the server response
    // is the next authoritative read.
    const previous = this.palette;
    if (color !== null) this.palette = setTypeColor(previous, type, color);
    try {
      const container = await getBrowserContainer();
      const next = await container.useCases.setTagTypeColor({ type, color });
      this.palette = next;
    } catch (e) {
      this.palette = previous;
      this.error = (e as Error).message;
      throw e;
    }
  }

  async renameTag(from: Tag, to: Tag): Promise<{
    readonly projectsUpdated: number;
    readonly featuresUpdated: number;
  }> {
    const container = await getBrowserContainer();
    const result = await container.useCases.renameTag({ from, to });
    // Palette may have moved the color over; refresh from server.
    await this.refresh();
    return {
      projectsUpdated: result.projectsUpdated,
      featuresUpdated: result.featuresUpdated
    };
  }
}

export const tagPaletteStore = new TagPaletteStore();
