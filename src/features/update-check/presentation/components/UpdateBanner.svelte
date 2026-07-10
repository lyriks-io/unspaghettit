<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * A slim, dismissible strip under the header that appears only when a newer
   * unspaghettit release is out. It fetches the server-side check on mount
   * (never blocking render) and reads the same VersionStatus the CLI and MCP
   * surfaces do, so all three agree. Dismissal is remembered per target version,
   * so hiding 0.9.0 doesn't also hide 0.10.0 when it lands.
   */

  type UpdateStatus = {
    readonly current: string;
    readonly latest: string | null;
    readonly updateAvailable: boolean;
  };

  const DISMISS_KEY = 'unspa:update-dismissed';
  const UPGRADE_COMMAND = 'npm i -g unspaghettit@latest';

  let status = $state<UpdateStatus | null>(null);
  let dismissed = $state<string | null>(null);

  onMount(() => {
    try {
      dismissed = localStorage.getItem(DISMISS_KEY);
    } catch {
      dismissed = null;
    }
    void fetch('/api/update-status')
      .then((res) => (res.ok ? (res.json() as Promise<UpdateStatus>) : null))
      .then((s) => {
        status = s;
      })
      .catch(() => {
        status = null;
      });
  });

  const show = $derived(
    status?.updateAvailable === true && status.latest !== null && dismissed !== status.latest
  );

  const dismiss = (): void => {
    const latest = status?.latest;
    if (!latest) return;
    dismissed = latest;
    try {
      localStorage.setItem(DISMISS_KEY, latest);
    } catch {
      // A private-mode / disabled storage just means the banner returns next load.
    }
  };
</script>

{#if show && status}
  <div
    class="relative flex items-center justify-center gap-2 border-b border-brand-200 bg-brand-50 px-10 py-2 text-center text-sm text-brand-900"
  >
    <span>
      A new version of Unspaghettit is available:
      <strong class="font-semibold">{status.current} → {status.latest}</strong>. Update with
      <code class="rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[0.8em] text-brand-900"
        >{UPGRADE_COMMAND}</code
      >.
    </span>
    <button
      type="button"
      onclick={dismiss}
      aria-label="Dismiss update notice"
      class="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-brand-700 transition hover:bg-brand-100 hover:text-brand-900"
    >
      ✕
    </button>
  </div>
{/if}
