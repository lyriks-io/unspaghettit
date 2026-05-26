import type { TagColor } from '$shared/domain/TagPalette';

/**
 * Inline-style values for rendering a tag in either a colored or "no color"
 * state. The presentation layer reads these and applies them via `style="..."`
 * so any user-picked hex works without Tailwind's content scanner needing to
 * know it in advance.
 *
 * For colored tags, pill background / ring / text are derived from the base
 * color via `color-mix` so a single hex drives a coherent chip. For the
 * absent case we fall back to neutral slate so the "no color" pill still
 * reads as a tag without leaning on any palette entry.
 */
export type TagColorStyle = {
  readonly isAbsent: boolean;
  readonly dotBackground: string | null;
  readonly pillBackground: string;
  readonly pillRing: string;
  readonly pillText: string;
};

const ABSENT: TagColorStyle = {
  isAbsent: true,
  dotBackground: null,
  pillBackground: '#ffffff',
  pillRing: '#e2e8f0', // slate-200
  pillText: '#475569' // slate-600
};

export const stylesFor = (color: TagColor | null): TagColorStyle => {
  if (!color) return ABSENT;
  return {
    isAbsent: false,
    dotBackground: color,
    pillBackground: `color-mix(in srgb, ${color} 18%, white)`,
    pillRing: `color-mix(in srgb, ${color} 45%, white)`,
    pillText: `color-mix(in srgb, ${color} 55%, black)`
  };
};
