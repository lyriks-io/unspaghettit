import { identityStore } from '$shared/identity/identityStore.svelte';
import { promptDialog } from '$shared/presentation/dialogs/dialogStore.svelte';

/**
 * Open the display-name dialog and persist the answer. Shared by the header's
 * identity menu ("Set/Change display name") and the first-visit auto-prompt in
 * the shell bootstrap, so both flows stay word-for-word identical.
 */
export async function promptForDisplayName(): Promise<void> {
  const next = await promptDialog({
    title: 'Your display name',
    message:
      'Shown on every history entry you create. Stored locally in this browser - never sent off-machine. Leave empty to stay anonymous.',
    inputLabel: 'Display name',
    defaultValue: identityStore.name,
    placeholder: 'e.g. John',
    confirmLabel: 'Save',
    tone: 'info'
  });
  if (next !== null) identityStore.setName(next);
}
