#!/usr/bin/env node
/*
 * EditorConfig declares `charset = utf-8` for this repo, which per the
 * EditorConfig spec means UTF-8 WITHOUT a BOM (the BOM variant is
 * `utf-8-bom`). Some Windows editors silently prepend a BOM anyway.
 *
 * That bit us once: `mcp-server/bin.cjs` got BOM-prefixed and the POSIX
 * kernel's shebang loader doesn't skip BOMs, so the bin's `#!/usr/bin/env
 * node` was invisible and `unspa-mcp` died with `exec format error` on
 * Linux/macOS. Every other source file with a BOM is harmless (Node/tsx/
 * Vite/svelte-check all silently skip it) until the next one happens to
 * be a shebang script.
 *
 * Run without args to strip BOM from every tracked source file. Run with
 * --check to fail (exit 1) if any BOM survives; this mode is wired into
 * `prepublishOnly` and into a vitest test so a BOM never reaches npm.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  'build',
  'dist',
  'coverage',
  '.unspa-world'
]);

const EXTS = new Set([
  '.cjs',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.svelte',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml'
]);

const check = process.argv.includes('--check');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name))) {
      const fd = fs.openSync(full, 'r');
      const head = Buffer.alloc(3);
      const n = fs.readSync(fd, head, 0, 3, 0);
      fs.closeSync(fd);
      if (n === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
        out.push(full);
      }
    }
  }
}

const hits = [];
walk(ROOT, hits);

if (hits.length === 0) {
  if (!check) console.log('No BOMs found. Clean.');
  process.exit(0);
}

if (check) {
  console.error(
    `\nFound ${hits.length} file(s) with a leading UTF-8 BOM:\n` +
      hits.map((h) => '  - ' + path.relative(ROOT, h).replace(/\\/g, '/')).join('\n') +
      `\n\nFix: run \`npm run bom:strip\`. The project's .editorconfig declares ` +
      `charset=utf-8 (no BOM); see scripts/strip-bom.cjs for context.\n`
  );
  process.exit(1);
}

for (const f of hits) {
  const buf = fs.readFileSync(f);
  fs.writeFileSync(f, buf.subarray(3));
  console.log('  stripped ' + path.relative(ROOT, f).replace(/\\/g, '/'));
}
console.log(`\nDone. Stripped BOM from ${hits.length} file(s).`);
