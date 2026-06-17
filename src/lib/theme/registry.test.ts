import { describe, expect, it } from 'vitest';
import { ALL_THEMES, isThemeId, optionalThemes, parseThemeId, resolveTheme } from './registry';

describe('theme registry', () => {
  it('falls back to the default theme for unset / empty / unknown values', () => {
    for (const raw of [undefined, '', '   ', 'nope', 'expert', '%unspa.theme%']) {
      expect(parseThemeId(raw)).toBe('default');
      expect(resolveTheme(raw).id).toBe('default');
    }
  });

  it('resolves the Lyriks theme, tolerant of case and whitespace', () => {
    for (const raw of ['lyriks', ' Lyriks ', 'LYRIKS']) {
      expect(parseThemeId(raw)).toBe('lyriks');
      expect(resolveTheme(raw).id).toBe('lyriks');
    }
  });

  it('isThemeId accepts known ids (including explicit "default"), rejects unknown', () => {
    expect(isThemeId('default')).toBe(true);
    expect(isThemeId('lyriks')).toBe(true);
    expect(isThemeId(' Lyriks ')).toBe(true);
    expect(isThemeId('nope')).toBe(false);
    expect(isThemeId('')).toBe(false);
  });

  it('lists the default theme first, then the opt-in themes', () => {
    expect(ALL_THEMES[0]!.id).toBe('default');
    expect(optionalThemes().map((t) => t.id)).toEqual(['lyriks']);
  });

  it('every theme carries a label, description, and swatch', () => {
    for (const theme of ALL_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatch.length).toBeGreaterThan(0);
    }
  });
});
