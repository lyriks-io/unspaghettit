import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER_BEGIN = '# >>> unspa';
const MARKER_END = '# <<< unspa';

/**
 * Append (or refresh) a `# >>> unspa` ... `# <<< unspa` block in the repo's
 * `.gitignore`. Idempotent: re-running with the same entries is a no-op; new
 * entries replace the existing block in place.
 */
export const upsertGitignoreBlock = (
  cwd: string,
  entries: readonly string[]
): { changed: boolean; created: boolean } => {
  const path = join(cwd, '.gitignore');
  const created = !existsSync(path);
  const current = created ? '' : readFileSync(path, 'utf8');
  const block = [MARKER_BEGIN, ...entries, MARKER_END].join('\n');

  const beginIdx = current.indexOf(MARKER_BEGIN);
  const endIdx = current.indexOf(MARKER_END);

  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    next =
      current.slice(0, beginIdx) +
      block +
      current.slice(endIdx + MARKER_END.length);
  } else {
    const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    next = `${current}${sep}${current.length > 0 ? '\n' : ''}${block}\n`;
  }

  if (next === current) return { changed: false, created: false };
  writeFileSync(path, next, 'utf8');
  return { changed: true, created };
};

/**
 * Strip the managed `# >>> unspa ... # <<< unspa` block from `.gitignore`.
 * Leaves the rest of the file untouched. Returns true when a write happened.
 */
export const removeGitignoreBlock = (cwd: string): { changed: boolean } => {
  const path = join(cwd, '.gitignore');
  if (!existsSync(path)) return { changed: false };
  const current = readFileSync(path, 'utf8');
  const beginIdx = current.indexOf(MARKER_BEGIN);
  const endIdx = current.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return { changed: false };

  const before = current.slice(0, beginIdx).replace(/\n+$/, '');
  const after = current.slice(endIdx + MARKER_END.length).replace(/^\n+/, '');
  const joined = before.length > 0 && after.length > 0 ? `${before}\n${after}` : `${before}${after}`;
  const next = joined.length > 0 && !joined.endsWith('\n') ? `${joined}\n` : joined;
  if (next === current) return { changed: false };
  writeFileSync(path, next, 'utf8');
  return { changed: true };
};
