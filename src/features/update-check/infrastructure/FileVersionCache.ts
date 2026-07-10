import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CachedVersionCheck, VersionCache } from '../application/ports/VersionCache';

/**
 * A JSON-file cache of the last registry lookup. Best-effort throughout: a
 * missing, unreadable, or malformed file reads as `null`, and a failed write
 * (read-only home, permissions) is swallowed. The update check is a courtesy —
 * it must never be the thing that fails the command the user actually ran.
 */
export const fileVersionCache = (filePath: string): VersionCache => ({
  read(): CachedVersionCheck | null {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<CachedVersionCheck>;
      if (typeof parsed.latest === 'string' && typeof parsed.checkedAt === 'number') {
        return { latest: parsed.latest, checkedAt: parsed.checkedAt };
      }
      return null;
    } catch {
      return null;
    }
  },
  write(entry: CachedVersionCheck): void {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(entry));
    } catch {
      // Ignore: a cache we can't persist just means we re-check next time.
    }
  }
});
