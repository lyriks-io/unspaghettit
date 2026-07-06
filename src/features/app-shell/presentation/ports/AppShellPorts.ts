/**
 * Driven ports for the app shell (hexagonal architecture). Each interface is
 * one responsibility the shell's components need from their host; the concrete
 * adapter lives under `infrastructure/adapters` and the store/component
 * modules act as the composition root. Same shape as `SearchHost`.
 */

/** Locates and opens the hub snapshots folder via the dashboard server. */
export interface HubDirectoryGateway {
  /** Resolve the absolute path of the active snapshots folder. */
  locate(): Promise<string>;
  /**
   * Ask the server to reveal the folder in the OS file manager. Resolves with
   * the directory path when the server re-reports it alongside opening, or
   * `null` when it opened the folder without reporting a path.
   */
  reveal(): Promise<string | null>;
}

/**
 * Browser-side persistence the shell can wipe on "Reset local data".
 * localStorage (identity, "asked" flag, preferences) and sessionStorage
 * (transient per-tab state). IndexedDB / Cache API are not currently used by
 * the dashboard - if either gets adopted later, add it to the adapter.
 */
export interface BrowserStateGateway {
  /** Clear every browser-local persistence surface the dashboard uses. */
  clearAll(): void;
  /**
   * Reload the page so in-memory Svelte stores, the YDocClient subscriptions,
   * and the SSE stream all re-initialize from a blank slate.
   */
  reload(): void;
}

/** The composed set of host services the app shell depends on. */
export interface AppShellHost {
  readonly hubDirectory: HubDirectoryGateway;
  readonly browserState: BrowserStateGateway;
}
