import { apiFetch } from '$shared/security/apiFetch';
import type { AppShellHost } from '$features/app-shell/presentation/ports/AppShellPorts';

/**
 * Default adapter binding the app shell's driven ports to the dashboard app's
 * services: the hub-directory endpoint and the browser's storage surfaces.
 * Mirrors `defaultSearchHost` - the one place that knows the concrete
 * endpoints; to host the shell elsewhere, supply a different `AppShellHost`.
 */

async function readDirectory(response: Response): Promise<string | null> {
  if (!response.ok) throw new Error(await response.text());
  const payload = (await response.json()) as { directory?: unknown };
  return typeof payload.directory === 'string' ? payload.directory : null;
}

export const defaultAppShellHost: AppShellHost = {
  hubDirectory: {
    locate: async () => {
      const directory = await readDirectory(await apiFetch('/api/system/hub-directory'));
      if (directory === null) throw new Error('The server returned an invalid directory.');
      return directory;
    },
    reveal: async () =>
      readDirectory(await apiFetch('/api/system/hub-directory', { method: 'POST' }))
  },
  browserState: {
    clearAll: () => {
      try {
        localStorage.clear();
      } catch {
        // Storage blocked (private browsing on some browsers) - nothing to clear.
      }
      try {
        sessionStorage.clear();
      } catch {
        // Same as above.
      }
    },
    reload: () => location.reload()
  }
};
