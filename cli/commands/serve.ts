import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run the bundled MCP server. We spawn `tsx mcp-server/bin.ts` rather than
 * importing the bin directly so the child inherits a clean argv (the MCP
 * protocol parses `process.argv` for `--snapshots`).
 *
 * The child's CWD is the user's CWD (where they invoked `unspa serve`),
 * which is what the snapshot-discovery walker needs to find the right
 * `unspa/` folder.
 */
export const runServeCommand = async (
  args: { readonly snapshots?: string }
): Promise<number> => {
  const repoRoot = resolve(__dirname, '..', '..');
  const binPath = resolve(repoRoot, 'mcp-server', 'bin.ts');
  // Invoke tsx through its JS entry directly via process.execPath so we
  // never spawn a .cmd file. Node 22 tightened the rules for spawning
  // .cmd/.bat on Windows (requires shell:true), so going via the .bin shim
  // fails with EINVAL. Pointing at tsx's cli.mjs sidesteps the shim entirely
  // and works the same on every platform.
  const tsxEntry = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  // Pass the published runtime tsconfig explicitly so the child can locate
  // the Unspaghettit source. `tsconfig.json` (the dev one) extends the
  // SvelteKit-generated `.svelte-kit/tsconfig.json`, which isn't shipped in
  // the npm tarball — pointing at it under `npm install -g` would crash tsx
  // on load before MCP could speak a byte. The aliases themselves are
  // resolved by `cli/_aliases.cjs` in the bin shim, not by this tsconfig.
  const tsconfigPath = resolve(repoRoot, 'tsconfig.runtime.json');
  // `--tsconfig` is a tsx flag, so it lives between the tsx entry and the
  // script. `process.execPath` sees a flat node argv: [cli.mjs, --tsconfig,
  // <path>, bin.ts, ...]. Node ignores everything past cli.mjs and hands it
  // to tsx.
  const childArgs = [tsxEntry, '--tsconfig', tsconfigPath, binPath];
  if (args.snapshots) childArgs.push('--snapshots', args.snapshots);

  return await new Promise<number>((resolvePromise) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    child.on('exit', (code) => resolvePromise(code ?? 0));
  });
};
