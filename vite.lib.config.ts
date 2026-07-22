import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Library build for the `unspaghettit` npm entry point (`src/lib-entry`).
 *
 * Separate from the SvelteKit build on purpose: this produces a plain,
 * dependency-free ESM module a consumer can import, with the `$features` /
 * `$shared` aliases resolved at build time (they can't be, at their end). The
 * SvelteKit build keeps owning the dashboard; the two never share output.
 *
 * Everything reachable from the entry point is pure TypeScript with no runtime
 * dependencies, so the bundle is self-contained and `external` stays empty.
 */
const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $features: resolve('./src/features'),
      $shared: resolve('./src/shared'),
      $lib: resolve('./src/lib')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve('./src/lib-entry/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // Fail loudly rather than silently shipping a bundle that expects a
      // dependency the consumer doesn't have.
      external: []
    }
  }
});
