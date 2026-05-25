#!/usr/bin/env node
/*
 * cli/skills/ is the canonical home for the three skills that ship with
 * the npm package (`unspa init` reads from there and copies them into
 * each user's repo). .claude/skills/ holds the same three skills so they
 * apply when working on THIS repo, plus a handful of repo-internal
 * specialty skills (quest-modeler, worldbuild, worldplay) that we
 * deliberately do NOT ship.
 *
 * Run this script to push edits from cli/skills/ → .claude/skills/ for
 * the shared three. Run with --check to fail (exit 1) if they have
 * drifted — wired into `npm test` so a one-sided edit can't slip
 * through review.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'cli', 'skills');
const DEST = path.join(ROOT, '.claude', 'skills');

const SHARED = ['unspa-audit', 'unspa-edit', 'unspa-implement'];

const check = process.argv.includes('--check');

function read(name) {
  const srcPath = path.join(SRC, name, 'SKILL.md');
  const destPath = path.join(DEST, name, 'SKILL.md');
  return {
    name,
    srcPath,
    destPath,
    src: fs.readFileSync(srcPath, 'utf8'),
    dest: fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null
  };
}

const drifted = [];
for (const name of SHARED) {
  const e = read(name);
  if (e.src === e.dest) {
    if (!check) console.log(`  = ${name} (already in sync)`);
    continue;
  }
  if (check) {
    drifted.push(name);
    continue;
  }
  fs.mkdirSync(path.dirname(e.destPath), { recursive: true });
  fs.writeFileSync(e.destPath, e.src, 'utf8');
  console.log(`  ✓ ${name} → .claude/skills/`);
}

if (check && drifted.length > 0) {
  console.error(
    `\nSkill drift detected. cli/skills/ and .claude/skills/ disagree on:\n` +
      drifted.map((n) => `  - ${n}`).join('\n') +
      `\n\nFix: edit the cli/skills/ copy (canonical), then run \`npm run skills:sync\`.\n`
  );
  process.exit(1);
}

if (!check) console.log('\nDone. cli/skills/ → .claude/skills/ in sync.');
