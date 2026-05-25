#!/usr/bin/env node
// ESM shim for the dashboard server. We MUST load dashboard-server.ts
// through the ESM tsx loader (not tsx/cjs) so that `import * as Y from
// 'yjs'` resolves to `yjs/dist/yjs.mjs` — the same file the bundled
// SvelteKit `build/handler.js` imports at runtime. Otherwise tsx/cjs
// would resolve `require('yjs')` to `yjs/dist/yjs.cjs`, two distinct
// module objects would collide in the process, and Yjs prints the
// "Yjs was already imported. This breaks constructor checks" warning
// followed by silent `instanceof Y.Doc` failures.
//
// `tsImport()` is tsx's ESM-scoped loader API (the legacy
// `module.register('tsx/esm', ...)` path tripped Node's "use --import,
// not --loader" guard on 20.6+). It registers the loader just for this
// import call, runs dashboard-server.ts as native ESM, and applies the
// loader to its transitive imports too.
//
// The path alias setup (`$shared/...`, `$features/...`) is configured
// in tsconfig.runtime.json which tsx picks up via TSX_TSCONFIG_PATH.
import { tsImport } from 'tsx/esm/api';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.TSX_TSCONFIG_PATH ??= path.join(__dirname, '..', 'tsconfig.runtime.json');

await tsImport('./dashboard-server.ts', import.meta.url);
