<script lang="ts">
  import { featureStore } from '$features/behavior-model/presentation/stores/featureStore.svelte';
  import type { HistoryEntry } from '$lib/sync/protocol';
  import { confirmDialog } from '$shared/presentation/dialogs/dialogStore.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  // Show the timeline newest-first so the current/recent edits are at the top.
  // The underlying log is oldest-first; we reverse for display only.
  const reversed = $derived<HistoryEntry[]>([...featureStore.historyEntries].reverse());

  // Disable the Clear button when there's nothing meaningful to clear (zero
  // entries, or exactly one entry — likely already a fresh anchor).
  const canClear = $derived(featureStore.historyEntries.length > 1);

  async function confirmAndClear() {
    const count = featureStore.historyEntries.length;
    if (count <= 1) return;
    const ok = await confirmDialog({
      title: 'Clear history?',
      message:
        `${count} entries will be wiped from this feature's shared timeline. ` +
        `The feature's current state is kept — only the past edits and the ` +
        `ability to time-travel to them are removed. This cannot be undone.`,
      confirmLabel: 'Clear history',
      cancelLabel: 'Keep history',
      tone: 'danger'
    });
    if (ok) featureStore.clearHistory();
  }

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return time;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  };

  const authorBadgeClass = (author: string): string => {
    if (author === 'mcp') return 'bg-purple-100 text-purple-700';
    if (author === 'system') return 'bg-neutral-100 text-neutral-600';
    return 'bg-sky-100 text-sky-700';
  };

  const authorLabel = (author: string): string => {
    if (author === 'mcp') return 'AI';
    if (author === 'system') return 'sys';
    // Strip the legacy `user-` prefix and the new anonymous `Anon-`
    // prefix so the badge stays compact. Real display names pass
    // through unchanged.
    return author.replace(/^user-/, '').replace(/^Anon-/, '');
  };
</script>

<aside
  class="flex h-full w-80 flex-col border-l border-neutral-200 bg-white"
  class:hidden={!open}
>
  <header class="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
    <div>
      <h2 class="text-sm font-semibold text-neutral-900">History</h2>
      <p class="text-[11px] text-neutral-500">
        {featureStore.historyEntries.length} edit(s) · shared timeline
      </p>
    </div>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
        onclick={confirmAndClear}
        disabled={!canClear}
        title={canClear ? 'Clear the shared history (keeps current state)' : 'Nothing to clear'}
      >
        Clear
      </button>
      <button
      type="button"
      class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
      onclick={() => (open = false)}
      aria-label="Close history"
      title="Close"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    </button>
    </div>
  </header>
  {#if reversed.length === 0}
    <div class="flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500">
      No edits yet. Make a change and it will appear here.
    </div>
  {:else}
    <ol class="flex-1 overflow-y-auto py-1">
      {#each reversed as entry, i (entry.id)}
        {@const originalIndex = featureStore.historyEntries.length - 1 - i}
        {@const isCurrent = originalIndex === featureStore.historyCursor}
        {@const isPast = originalIndex < featureStore.historyCursor}
        <li>
          <button
            type="button"
            class="flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left text-xs transition hover:bg-neutral-50 {isCurrent
              ? 'border-brand-600 bg-brand-50/40'
              : isPast
                ? 'border-transparent'
                : 'border-transparent opacity-60'}"
            onclick={() => featureStore.jumpToHistory(entry.id)}
            title={isCurrent ? 'Current state' : 'Jump to this state'}
          >
            <span
              class="mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold {authorBadgeClass(
                entry.author
              )}"
            >
              {authorLabel(entry.author)}
            </span>
            <span class="flex-1 space-y-0.5">
              <span class="block font-medium text-neutral-800">
                {entry.label ?? 'Edit'}
              </span>
              <span class="block text-[11px] text-neutral-500">
                {formatTime(entry.ts)}
                {#if entry.actingFor}
                  <!-- AI-driven entry attributed to the human currently at
                       the dashboard. Renders as "by John" so the AI badge
                       stays the primary cue and the human is the
                       supporting attribution. -->
                  <span class="ml-1 text-purple-700">· for {entry.actingFor}</span>
                {/if}
                {#if isCurrent}<span class="ml-1 text-brand-700">· current</span>{/if}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</aside>
