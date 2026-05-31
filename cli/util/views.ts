import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Persisted dashboard-view enablement, stored next to the model the dashboard
 * shows (`<snapshots>/views.json`). Expert is always on and is never stored;
 * this file only lists the opt-in views the user has added. `unspa dashboard`
 * reads it and exposes it to the app as `PUBLIC_UNSPA_VIEWS`.
 */
const FILE_NAME = 'views.json';

type ViewsConfig = { readonly views?: readonly unknown[] };

export const viewsConfigPath = (snapshotsDir: string): string => join(snapshotsDir, FILE_NAME);

/** Read enabled opt-in view ids; tolerant of a missing/malformed file. */
export const readEnabledViews = (snapshotsDir: string): string[] => {
  try {
    const parsed = JSON.parse(readFileSync(viewsConfigPath(snapshotsDir), 'utf8')) as ViewsConfig;
    if (!Array.isArray(parsed.views)) return [];
    return normalize(parsed.views.filter((v): v is string => typeof v === 'string'));
  } catch {
    return [];
  }
};

/** Persist the enabled opt-in view ids (normalized: trimmed, lowercased, unique). */
export const writeEnabledViews = (snapshotsDir: string, views: readonly string[]): string[] => {
  const next = normalize(views);
  const path = viewsConfigPath(snapshotsDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ views: next }, null, 2)}\n`, 'utf8');
  return next;
};

const normalize = (views: readonly string[]): string[] => [
  ...new Set(views.map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))
];
