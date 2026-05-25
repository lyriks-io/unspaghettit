<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { syncToastStore, type SyncToast } from './syncToastStore.svelte';

  onMount(() => {
    // Idempotent — starts the SSE subscription on first mount, no-ops on
    // re-mount during HMR / nav. We never call stop(): the stream lives
    // for the lifetime of the tab.
    syncToastStore.start();
  });

  function kindLabel(kind: 'feature' | 'project' | 'implementation-status'): string {
    switch (kind) {
      case 'feature':
        return 'feature';
      case 'project':
        return 'project';
      case 'implementation-status':
        return 'status';
    }
  }

  function kindAccent(kind: 'feature' | 'project' | 'implementation-status'): string {
    switch (kind) {
      case 'feature':
        return 'border-cyan-200 bg-cyan-50';
      case 'project':
        return 'border-violet-200 bg-violet-50';
      case 'implementation-status':
        return 'border-emerald-200 bg-emerald-50';
    }
  }

  // The change verb the user actually performed (added a surface, removed
  // an action, renamed, ...). Falls back to the broad save/delete bucket
  // when no specific diff was computed (e.g. delete events, or older MCP
  // payloads that predate the diff pipeline).
  function opLabel(toast: SyncToast): string {
    if (toast.op === 'delete') return 'deleted';
    switch (toast.changeOp) {
      case 'added':
        return 'added';
      case 'removed':
        return 'removed';
      case 'renamed':
        return 'renamed';
      case 'edited':
        return 'edited';
      case 'queued':
        return 'queued';
      case 'unqueued':
        return 'unqueued';
      case 'created':
        return 'created';
      case 'deleted':
        return 'deleted';
      case 'saved':
      default:
        return 'saved';
    }
  }

  // Full breadcrumb: project name (when known) → entity name → deep path
  // from the diff. Duplicate segments (e.g. when the path's first item
  // IS the entity name) are collapsed so we don't render
  // "Recipe Box › Inbox › Inbox › Inbox List".
  function breadcrumb(toast: SyncToast): string[] {
    const parts: string[] = [];
    if (toast.projectName) parts.push(toast.projectName);
    const root = toast.changePath?.[0];
    const headIsEntity = root !== undefined && (toast.name === root || !toast.name);
    if (toast.name && !headIsEntity) parts.push(toast.name);
    if (toast.changePath && toast.changePath.length > 0) {
      for (const segment of toast.changePath) parts.push(segment);
    } else if (toast.name && parts[parts.length - 1] !== toast.name) {
      parts.push(toast.name);
    }
    // Drop the descriptor's "unknown" sentinel — it's only emitted when
    // the diff couldn't read the post-snapshot, and showing it confuses
    // the breadcrumb. Also dedupe adjacent duplicates so the entity name
    // doesn't render twice when the diff path's root IS the entity.
    const cleaned: string[] = [];
    for (const seg of parts) {
      if (seg === 'unknown') continue;
      if (cleaned[cleaned.length - 1] !== seg) cleaned.push(seg);
    }
    if (cleaned.length === 0) cleaned.push(toast.entityId);
    return cleaned;
  }
</script>

{#if syncToastStore.toasts.length > 0}
  <div
    class="pointer-events-none fixed top-20 right-4 z-50 flex w-full max-w-md flex-col gap-2"
    role="status"
    aria-live="polite"
  >
    {#each syncToastStore.toasts as toast (toast.id)}
      {@const crumbs = breadcrumb(toast)}
      <div
        class="pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2 shadow-md shadow-slate-950/10 {kindAccent(toast.kind)}"
        in:fly={{ x: 24, duration: 180, easing: cubicOut }}
        out:fade={{ duration: 140 }}
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-semibold uppercase tracking-wide">
            <span class="text-slate-500">
              MCP · {opLabel(toast)} {kindLabel(toast.kind)}
            </span>
            {#if toast.actingFor}
              <!-- AI driving on behalf of a named human. Purple chip
                   matches the "AI" badge color in the History panel so
                   the two surfaces feel like one attribution system. -->
              <span class="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-800">
                for {toast.actingFor}
              </span>
            {/if}
          </div>
          <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-slate-900">
            {#each crumbs as segment, i}
              {#if i > 0}
                <span class="shrink-0 text-slate-400" aria-hidden="true">&rsaquo;</span>
              {/if}
              <span
                class="truncate {i === crumbs.length - 1 ? 'font-semibold' : 'text-slate-600'}"
              >
                {segment}
              </span>
            {/each}
          </div>
          {#if toast.changeOp === 'renamed' && toast.previousName}
            <div class="mt-0.5 truncate text-[11px] text-slate-500">
              was &ldquo;{toast.previousName}&rdquo;
            </div>
          {/if}
        </div>
        <div class="flex shrink-0 items-center gap-1">
          {#if toast.href}
            <a
              href={toast.href}
              class="rounded-md bg-white/70 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white hover:text-brand-800"
              onclick={() => syncToastStore.dismiss(toast.id)}
            >
              View
            </a>
          {/if}
          <button
            type="button"
            class="rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-white/70 hover:text-slate-900"
            onclick={() => syncToastStore.dismiss(toast.id)}
            aria-label="Dismiss"
          >
            âœ•
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}
