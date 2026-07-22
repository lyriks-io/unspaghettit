import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { unspaSyncPlugin } from './src/lib/server/sync/vitePlugin';
import { DEFAULT_DASHBOARD_PORT } from './src/lib/server/sync/dashboardEndpoint';
import pkg from './package.json';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), unspaSyncPlugin()],
  define: {
    // The running release, inlined at build time so the UI can show it without
    // a fetch and without shipping package.json to the browser. Server code
    // that needs it (the update check) keeps importing package.json directly.
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  ssr: {
    // Keep Yjs (and its companion CRDT packages) external in the SSR
    // build. The custom dashboard server (cli/dashboard-server.ts) runs
    // under tsx/cjs and statically imports Yjs through
    // src/lib/server/sync. If `build/handler.js` ALSO ships its own
    // bundled copy of Yjs, two distinct module objects end up in the
    // process at once — Yjs detects this and prints the
    //   "Yjs was already imported. This breaks constructor checks..."
    // warning, and downstream `instanceof Y.Doc` checks start failing.
    // Listing them as external forces handler.js to `import 'yjs'` at
    // runtime, which Node's module cache dedupes with whatever tsx
    // already loaded. Browser bundles are unaffected — Vite only
    // honors `ssr.external` on the server side.
    external: ['yjs', 'y-protocols', 'lib0']
  },
  server: {
    // Start on the uncommon shared default (so dev doesn't fight :5173/:3000);
    // Vite still advances to the next free port if it's taken, and the sync
    // plugin publishes whichever port it actually bound so the MCP notifier
    // finds it (see src/lib/server/sync/dashboardEndpoint).
    port: DEFAULT_DASHBOARD_PORT,
    // Runtime data in unspa/ is written by Y.Doc persists. Watching it would
    // turn every save into a full-page reload, undoing the live sync. The
    // samples/ folder is source content (read-only at runtime), so we watch
    // it normally — editing a sample JSON should rebuild the bundle.
    watch: {
      ignored: ['**/unspa/**']
    },
    fs: {
      // samples/ holds read-only sample snapshots loaded by the Load samples button.
      // Outside SvelteKit's default allow list, so list it explicitly.
      allow: ['.', './samples']
    }
  },
  test: {
    include: [
      'src/**/*.{test,spec}.ts',
      'mcp-server/**/*.{test,spec}.ts',
      'cli/**/*.{test,spec}.ts',
      'scripts/**/*.{test,spec}.ts'
    ],
    environment: 'node',
    globals: false
  }
});
