#!/usr/bin/env node
'use strict';

/**
 * Rewrite the `$features/*` / `$shared/*` / `$lib/*` path aliases in the
 * emitted `.d.ts` tree to relative specifiers.
 *
 * TypeScript resolves path aliases when it TYPE-CHECKS but emits them verbatim
 * into declaration files, so `dist/types/**` would ship import specifiers no
 * consumer can resolve. Rewriting them here is what makes the published types
 * usable without asking every consumer to replicate our tsconfig paths.
 *
 * Deterministic and total: the alias roots map 1:1 onto directories under
 * `dist/types`, so each specifier has exactly one correct relative form. Any
 * alias we fail to rewrite is a hard error rather than a broken publish.
 */

const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, dirname, sep } = require('node:path');

const TYPES_ROOT = join(__dirname, '..', 'dist', 'types');
const ALIAS_ROOTS = { $features: 'features', $shared: 'shared', $lib: 'lib' };
const ALIAS_RE = /(['"])(\$(?:features|shared|lib))\/([^'"]+)\1/g;

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.d.ts')) out.push(full);
  }
  return out;
};

const toRelative = (fromFile, alias, rest) => {
  const target = join(TYPES_ROOT, ALIAS_ROOTS[alias], rest);
  let spec = relative(dirname(fromFile), target).split(sep).join('/');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return spec;
};

let files;
try {
  files = walk(TYPES_ROOT);
} catch {
  console.error(`[lib-types] ${TYPES_ROOT} not found. Run \`tsc -p tsconfig.lib.json\` first.`);
  process.exit(1);
}

let rewritten = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(ALIAS_RE, (_m, quote, alias, rest) => {
    rewritten += 1;
    return `${quote}${toRelative(file, alias, rest)}${quote}`;
  });
  if (after !== before) writeFileSync(file, after, 'utf8');
}

// Belt-and-suspenders: nothing may reach the published tree still aliased.
const leftovers = files.filter((file) => ALIAS_RE.test(readFileSync(file, 'utf8')));
if (leftovers.length > 0) {
  console.error(`[lib-types] unresolved aliases remain in:\n  ${leftovers.join('\n  ')}`);
  process.exit(1);
}

console.log(`[lib-types] rewrote ${rewritten} alias specifier(s) across ${files.length} file(s)`);
