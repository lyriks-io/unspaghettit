import type { AppShellHost } from '$features/app-shell/presentation/ports/AppShellPorts';
import { defaultAppShellHost } from '$features/app-shell/infrastructure/adapters/defaultAppShellHost';

/**
 * Hub snapshots folder state for the header's settings menu: the resolved
 * path (shown as the menu row's subtitle/tooltip) and the open-in-file-manager
 * action. Depends only on the {@link AppShellHost} port; this module is the
 * composition root wiring in the default adapter.
 */
class HubDirectoryStore {
  directory = $state('');
  error = $state('');
  opening = $state(false);

  constructor(private readonly host: AppShellHost = defaultAppShellHost) {}

  /** Resolve the path once so the menu can show it before any click. */
  async load(): Promise<void> {
    try {
      this.directory = await this.host.hubDirectory.locate();
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not locate the hub.';
    }
  }

  /**
   * Reveal the folder in the OS file manager. Resolves `true` on success so
   * the caller can close the menu; on failure the error sticks to the row.
   */
  async openFolder(): Promise<boolean> {
    this.opening = true;
    this.error = '';
    try {
      const directory = await this.host.hubDirectory.reveal();
      if (directory !== null) this.directory = directory;
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open the hub folder.';
      return false;
    } finally {
      this.opening = false;
    }
  }
}

export const hubDirectoryStore = new HubDirectoryStore();
