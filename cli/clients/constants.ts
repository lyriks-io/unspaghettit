/**
 * The key under `mcpServers.<name>` that every host client writes when init
 * registers Unspaghettit. Must match the CLI command name so users can
 * eyeball the config and recognize the entry.
 *
 * Lives in its own module to avoid an import cycle between registry.ts
 * (which imports each client adapter) and the individual client adapters
 * (which need this constant).
 */
export const SERVER_NAME = 'unspa';
