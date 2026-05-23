#!/usr/bin/env node
// Bin shim. Registers tsx so we can ship the MCP server as TypeScript without a
// build step. Mirrors cli/unspa.cjs — same pattern, different entrypoint.
// `npx unspa-mcp` and any globally-installed CLI find this file via the `bin`
// entry in package.json. See ../cli/_aliases.cjs for why we patch
// `Module._resolveFilename` ourselves.
const path = require('path');
process.env.TSX_TSCONFIG_PATH ||= path.join(__dirname, '..', 'tsconfig.runtime.json');
require('tsx/cjs/api').register();
require('../cli/_aliases.cjs');
require('./bin.ts');
