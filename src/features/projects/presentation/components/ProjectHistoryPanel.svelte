<script lang="ts">
  import { projectStore } from '$features/projects/presentation/stores/projectStore.svelte';
  import type { HistoryEntry } from '$lib/sync/protocol';

  /**
   * Read-only timeline of every change made to the project (name,
   * description, tags, feature add/remove, queue mutations, …). Mirrors
   * the feature-level HistoryPanel's *visual* language but intentionally
   * drops the interactive bits — no jumpTo, no Clear — so a stray click
   * can't time-travel a project out from under its features.
   *
   * Pulls from `projectStore.historyEntries` which the store subscribes
   * to via `YDocClient.observeHistory`.
   */
  const reversed = $derived<HistoryEntry[]>(
    [...projectStore.historyEntries].reverse()
  );

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
    return author.replace(/^user-/, '').replace(/^Anon-/, '');
  };
</script>

<section class="rounded-lg border border-hairline bg-white">
  <header class="flex items-center justify-between border-b border-hairline px-4 py-3">
    <div>
      <h2 class="text-sm font-semibold text-slate-950">Project history</h2>
      <p class="mt-0.5 text-xs text-slate-500">
        {projectStore.historyEntries.length} edit{projectStore.historyEntries.length === 1
          ? ''
          : 's'} · read-only
      </p>
    </div>
    <span class="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
      Audit
    </span>
  </header>

  {#if reversed.length === 0}
    <div class="px-6 py-10 text-center text-xs text-slate-500">
      No edits yet. Project metadata changes, feature add/remove, queue mutations - they all land here.
    </div>
  {:else}
    <ol class="divide-y divide-slate-100">
      {#each reversed as entry (entry.id)}
        <li class="flex items-start gap-3 px-4 py-2.5 text-xs">
          <span
            class="mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold {authorBadgeClass(
              entry.author
            )}"
            title={`Author: ${entry.author}`}
          >
            {authorLabel(entry.author)}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-slate-800">
              {entry.label ?? 'Edit'}
            </p>
            <p class="mt-0.5 text-[11px] text-slate-500">
              {formatTime(entry.ts)}
              {#if entry.actingFor}
                <span class="ml-1 text-purple-700">· for {entry.actingFor}</span>
              {/if}
            </p>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>
