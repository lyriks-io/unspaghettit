// Runtime alias resolver for the published CLI / MCP shims.
//
// SvelteKit-style aliases ($shared, $features, $lib) only work in tsx's tsconfig
// `paths` when the importing file lives outside `node_modules/`. Under
// `npm install -g`, our own TypeScript sits inside `node_modules/unspaghettit/`,
// which trips tsx's hardcoded guard and the aliases stop resolving. We patch
// `Module._resolveFilename` here, after tsx has already wrapped it, to rewrite
// alias requests to absolute paths before any other resolution runs.
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..');
const ALIASES = {
  $features: path.join(ROOT, 'src', 'features'),
  $shared: path.join(ROOT, 'src', 'shared'),
  $lib: path.join(ROOT, 'src', 'lib')
};

const inner = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (request === alias) {
      return inner.call(this, target, parent, ...rest);
    }
    if (request.startsWith(alias + '/')) {
      const rewritten = path.join(target, request.slice(alias.length + 1));
      return inner.call(this, rewritten, parent, ...rest);
    }
  }
  return inner.call(this, request, parent, ...rest);
};
