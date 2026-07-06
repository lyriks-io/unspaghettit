import { confirmDialog } from '$shared/presentation/dialogs/dialogStore.svelte';
import type { BrowserStateGateway } from '$features/app-shell/presentation/ports/AppShellPorts';
import { defaultAppShellHost } from '$features/app-shell/infrastructure/adapters/defaultAppShellHost';

/**
 * "Reset local data": confirm, wipe every browser-side persistence surface
 * the dashboard uses, then reload for a blank-slate re-init of the in-memory
 * stores, the YDocClient subscriptions, and the SSE stream.
 *
 * Server-side data (project files, feature JSONs, history under unspa/) is
 * untouched - this is strictly about the browser-local state the user can't
 * otherwise reach without devtools.
 */
export async function resetLocalData(
  browserState: BrowserStateGateway = defaultAppShellHost.browserState
): Promise<void> {
  const ok = await confirmDialog({
    title: 'Reset local browser data?',
    message:
      "Clears your display name, the dashboard's local preferences, and any cached per-tab state in this browser. Your projects, features, history, and queue stay on disk untouched. The page will reload to apply a fresh state.",
    confirmLabel: 'Reset everything',
    cancelLabel: 'Cancel',
    tone: 'danger'
  });
  if (!ok) return;
  browserState.clearAll();
  browserState.reload();
}
