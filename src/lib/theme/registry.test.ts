import { describe, expect, it } from 'vitest';
import { ALL_THEMES, DEFAULT_THEME_ID, isThemeId, optionalThemes, parseThemeId, resolveTheme } from './registry';

describe('theme registry', () => {
  it('falls back to the Lyriks default for unset / empty / unknown / literal-"default" values', () => {
    for (const raw of [undefined, '', '   ', 'nope', 'expert', 'default', '%unspa.theme%']) {
      expect(parseThemeId(raw)).toBe('lyriks');
      expect(resolveTheme(raw).id).toBe('lyriks');
    }
    expect(DEFAULT_THEME_ID).toBe('lyriks');
  });

  it('resolves the Lyriks theme explicitly, tolerant of case and whitespace', () => {
    for (const raw of ['lyriks', ' Lyriks ', 'LYRIKS']) {
      expect(parseThemeId(raw)).toBe('lyriks');
      expect(resolveTheme(raw).id).toBe('lyriks');
    }
  });

  it('resolves the opt-in Classic theme, tolerant of case and whitespace', () => {
    for (const raw of ['classic', ' Classic ', 'CLASSIC']) {
      expect(parseThemeId(raw)).toBe('classic');
      expect(resolveTheme(raw).id).toBe('classic');
    }
  });

  it('isThemeId accepts known ids (including explicit "default"), rejects unknown', () => {
    expect(isThemeId('default')).toBe(true);
    expect(isThemeId('lyriks')).toBe(true);
    expect(isThemeId('classic')).toBe(true);
    expect(isThemeId(' Classic ')).toBe(true);
    expect(isThemeId('nope')).toBe(false);
    expect(isThemeId('')).toBe(false);
  });

  it('lists the default theme first, then the opt-in themes', () => {
    expect(ALL_THEMES[0]!.id).toBe('lyriks');
    expect(optionalThemes().map((t) => t.id)).toEqual(['classic']);
  });

  it('every theme carries a label, description, and swatch', () => {
    for (const theme of ALL_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatch.length).toBeGreaterThan(0);
    }
  });
});
