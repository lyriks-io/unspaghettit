import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config (ESLint 9). Type-checking is owned by `npm run check`
 * (svelte-check); this layer adds the correctness/cleanliness rules svelte-check
 * doesn't: unused vars, unreachable code, accidental `any`, Svelte template
 * mistakes. We run the NON-type-checked tseslint preset on purpose — it's fast,
 * needs no `parserOptions.project`, and the type-aware rules would duplicate
 * what svelte-check already enforces.
 *
 * eslint-config-prettier is applied last so formatting is left entirely to
 * Prettier — ESLint never fights the formatter.
 */
export default ts.config(
  {
    // Generated, vendored, and build output — never our code to lint.
    ignores: [
      'build/',
      '.svelte-kit/',
      'node_modules/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'samples/',
      'static/',
      'src/lib/views/**',
      '**/*.d.ts',
      // CommonJS CLI/build shims — thin wrappers, and the Svelte core-rule
      // bridge crashes on commonjs-parsed files. Linted by neither layer; their
      // logic lives in the .ts sources that ARE linted.
      '**/*.cjs'
    ]
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      // The codebase deliberately avoids `any` (the few escapes are explicit
      // `as unknown as` casts at serialization boundaries), so keep this an error.
      '@typescript-eslint/no-explicit-any': 'error',
      // Dynamic code construction is a real smell; the only legitimate uses are
      // two codegen tests that already carry a local disable directive.
      'no-new-func': 'error',
      // Allow intentionally-unused names when prefixed with `_` (e.g. `_evt`,
      // destructured rest used only to drop a key).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ]
    }
  },
  {
    // Svelte components are parsed by svelte-eslint-parser with the TS parser
    // for their <script lang="ts"> blocks.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser }
    },
    rules: {
      // Reading a rune (e.g. `filteredGraph.nodes;`) as a bare statement inside
      // `$effect(() => { ... })` is the idiomatic way to register a reactive
      // dependency in Svelte 5. It reads as a "useless expression" to ESLint but
      // is load-bearing, so this rule is off for components.
      '@typescript-eslint/no-unused-expressions': 'off',
      // This rule checks ignore-directive necessity against the plugin's own
      // bundled Svelte compiler, which lags the project's Svelte version — so it
      // false-flags directives that `svelte-check` (the source of truth for
      // compiler warnings) still needs. Leave necessity enforcement to check.
      'svelte/no-unused-svelte-ignore': 'off'
    }
  }
);
