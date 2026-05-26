import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * cli/skills/ is the canonical home for the skills that ship via
 * `unspa init`. .claude/skills/ holds the same set so they apply when
 * working on THIS repo (plus repo-internal extras we don't ship,
 * currently quest-modeler).
 *
 * These two locations have drifted before — a docs edit landed in one
 * and not the other, and the next `unspa init` quietly pushed stale
 * skills into every user's repo. This test fails loudly if the shared
 * set ever diverges again. Fix by editing the cli/skills/ copy and
 * running `npm run skills:sync`.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SHARED = [
  'unspa-audit',
  'unspa-edit',
  'unspa-implement',
  'unspa-worldbuild',
  'unspa-worldplay'
] as const;

describe('skills sync (cli/skills ↔ .claude/skills)', () => {
  for (const name of SHARED) {
    it(`${name}/SKILL.md is byte-identical in both locations`, () => {
      const cliCopy = readFileSync(join(ROOT, 'cli', 'skills', name, 'SKILL.md'), 'utf8');
      const claudeCopy = readFileSync(
        join(ROOT, '.claude', 'skills', name, 'SKILL.md'),
        'utf8'
      );
      expect(claudeCopy).toBe(cliCopy);
    });
  }
});
