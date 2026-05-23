#!/usr/bin/env node
// Bin shim. Registers tsx so we can ship the CLI as TypeScript without a
// build step. `npm link` and `npm install -g` both find this file via the
// `bin` entry in package.json.
//
// Why we resolve aliases ourselves instead of relying on tsx's tsconfig
// `paths`: tsx hard-skips its path-alias resolver whenever the parent file
// lives inside a `node_modules/` directory (to avoid rewriting imports in
// third-party packages). That guard kills us under `npm install -g`, where
// the CLI's own TypeScript source sits at `<global>/node_modules/unspaghettit/...`.
// `npm link` happens to work because Node resolves the symlink to a realpath
// outside node_modules, but install-from-tarball doesn't. We patch
// `Module._resolveFilename` to rewrite `$shared/...`, `$features/...`,
// `$lib/...` to absolute paths before tsx ever sees them.
const path = require('path');
process.env.TSX_TSCONFIG_PATH ||= path.join(__dirname, '..', 'tsconfig.runtime.json');
require('tsx/cjs/api').register();
require('./_aliases.cjs');
require('./unspa.ts');
