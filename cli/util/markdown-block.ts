import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MARKER_BEGIN = '<!-- >>> unspa -->';
const MARKER_END = '<!-- <<< unspa -->';

/**
 * Insert (or refresh) a `<!-- >>> unspa --> ... <!-- <<< unspa -->` block
 * inside a markdown file. The markers let us own a slice of the doc without
 * stepping on user-authored content. Re-running with identical body content
 * is a no-op.
 *
 * - When the file doesn't exist, creates it with just the block.
 * - When markers exist, replaces only the body between them.
 * - When markers don't exist, appends a new block at the end of the file.
 */
export const upsertMarkdownBlock = (
  path: string,
  body: string
): { changed: boolean; created: boolean } => {
  const block = `${MARKER_BEGIN}\n${body.trim()}\n${MARKER_END}\n`;
  const created = !existsSync(path);
  const current = created ? '' : readFileSync(path, 'utf8');

  const beginIdx = current.indexOf(MARKER_BEGIN);
  const endIdx = current.indexOf(MARKER_END);

  let next: string;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    next =
      current.slice(0, beginIdx) +
      block.trimEnd() +
      current.slice(endIdx + MARKER_END.length);
  } else if (created) {
    next = block;
  } else {
    const sep = current.endsWith('\n') ? '\n' : '\n\n';
    next = `${current}${sep}${block}`;
  }

  if (next === current) return { changed: false, created: false };
  writeFileSync(path, next, 'utf8');
  return { changed: true, created };
};

/**
 * Strip the managed unspa block from a markdown file. Leaves surrounding
 * content untouched. Returns true when a write happened. No-ops when the
 * file or markers are absent.
 */
export const removeMarkdownBlock = (path: string): { changed: boolean } => {
  if (!existsSync(path)) return { changed: false };
  const current = readFileSync(path, 'utf8');
  const beginIdx = current.indexOf(MARKER_BEGIN);
  const endIdx = current.indexOf(MARKER_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return { changed: false };

  const before = current.slice(0, beginIdx).replace(/\n+$/, '');
  const after = current.slice(endIdx + MARKER_END.length).replace(/^\n+/, '');
  const joined = before.length > 0 && after.length > 0 ? `${before}\n\n${after}` : `${before}${after}`;
  const next = joined.length > 0 && !joined.endsWith('\n') ? `${joined}\n` : joined;
  if (next === current) return { changed: false };
  writeFileSync(path, next, 'utf8');
  return { changed: true };
};
