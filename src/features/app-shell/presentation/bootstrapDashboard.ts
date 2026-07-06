import { identityStore } from '$shared/identity/identityStore.svelte';
import { authStore } from '$shared/security/authStore.svelte';
import { themeStore } from '$lib/theme/themeStore.svelte';
import { onboardingStore } from '$features/tutorial/presentation/stores/onboardingStore.svelte';
import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
import { promptForDisplayName } from '$features/app-shell/presentation/identityPrompt';

/**
 * One-time client boot for the dashboard, run from the root layout's onMount.
 * Hydrates every browser-persisted store, fires the first-visit name prompt,
 * and reconciles orphan features. Idempotent on re-mount (each init guards
 * itself).
 */
export async function bootstrapDashboard(): Promise<void> {
  // Hydrate the display-name store from localStorage before anything
  // tries to read identityStore.author (notably the YDocClient
  // building its WebSocket URL).
  identityStore.init();
  // Mirror the active colour theme from the <html data-theme> attribute
  // (server default + the inline head script's localStorage override) into
  // reactive state so the header switcher and chrome track it live.
  themeStore.init();
  // Hydrate the optional dashboard auth token the same way. When
  // unset, every API/SSE/WS request goes out unauthenticated; the
  // first 401 from the server triggers `apiFetch`'s prompt-and-retry
  // path which fills this store and persists the value.
  authStore.init();
  // Getting-started banner state (open / completed / dismissed). Must
  // hydrate before first paint decisions: until init the status is
  // 'unknown' and the banner stays hidden, so returning users never
  // see it flash.
  onboardingStore.init();
  // First visit only: auto-prompt for a name. Once the user has been
  // asked (even if they dismissed without setting one), the flag in
  // localStorage suppresses the dialog on every subsequent reload.
  // The header avatar remains the explicit affordance to set/change
  // the name later. Deferred through queueMicrotask so the layout
  // has painted before the dialog opens.
  if (!identityStore.name && !identityStore.hasBeenAsked) {
    identityStore.markAsked();
    queueMicrotask(() => {
      void promptForDisplayName();
    });
  }
  // Auto-bucket orphan features into an "Unknown" project. Runs silently
  // once per session. The Unknown project is a normal project the user can
  // rename or empty.
  try {
    await projectsStore.reconcileOrphanFeatures();
  } catch (e) {
    console.warn('Orphan reconciliation failed:', e);
  }
}
