import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Persisted dashboard-theme selection, stored next to the model the dashboard
 * shows (`<snapshots>/theme.json`). Purely cosmetic — picks the colour skin the
 * UI renders with. `unspa dashboard` reads it and exposes it to the app as
 * `PUBLIC_UNSPA_THEME`; the in-app header switcher can still override it live
 * in the browser. A missing/malformed file means the default theme.
 */
const FILE_NAME = 'theme.json';

type ThemeConfig = { readonly theme?: unknown };

export const themeConfigPath = (snapshotsDir: string): string => join(snapshotsDir, FILE_NAME);

/** Read the selected theme id; tolerant of a missing/malformed file. */
export const readSelectedTheme = (snapshotsDir: string): string => {
  try {
    const parsed = JSON.parse(readFileSync(themeConfigPath(snapshotsDir), 'utf8')) as ThemeConfig;
    return typeof parsed.theme === 'string' ? parsed.theme.trim().toLowerCase() : 'default';
  } catch {
    return 'default';
  }
};

/** Persist the selected theme id (normalized: trimmed, lowercased). */
export const writeSelectedTheme = (snapshotsDir: string, theme: string): string => {
  const next = theme.trim().toLowerCase() || 'default';
  const path = themeConfigPath(snapshotsDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ theme: next }, null, 2)}\n`, 'utf8');
  return next;
};
