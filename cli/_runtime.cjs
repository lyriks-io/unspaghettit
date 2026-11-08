// What a process needs before it can load the engine's TypeScript: tsx, and the
// $features / $shared / $lib aliases (see _aliases.cjs). The MCP and CLI shims
// do the same inline; a proof module requires this file first in each process
// it starts, then the engine's kernel (src/features/prover/kernel.ts).
const path = require('path');
process.env.TSX_TSCONFIG_PATH ||= path.join(__dirname, '..', 'tsconfig.runtime.json');
require('tsx/cjs/api').register();
require('./_aliases.cjs');
