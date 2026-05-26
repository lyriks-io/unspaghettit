import type { TagColor } from '$shared/domain/TagPalette';

export type TagPreset = {
  readonly name: string;
  readonly color: TagColor;
};

/**
 * Built-in palette presets. Hex values chosen from Tailwind's *-500 step so
 * they share saturation with the existing UI accents. Order matches the
 * rainbow-ish flow shown in the picker.
 */
export const TAG_PRESETS: readonly TagPreset[] = [
  { name: 'Rose', color: '#f43f5e' },
  { name: 'Orange', color: '#f97316' },
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Lime', color: '#84cc16' },
  { name: 'Emerald', color: '#10b981' },
  { name: 'Teal', color: '#14b8a6' },
  { name: 'Sky', color: '#0ea5e9' },
  { name: 'Violet', color: '#8b5cf6' },
  { name: 'Fuchsia', color: '#d946ef' },
  { name: 'Slate', color: '#64748b' }
];
