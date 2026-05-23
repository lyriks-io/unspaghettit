<script lang="ts">
  import type { FeatureCardModel } from '$features/behavior-model/application/use-cases/ListFeaturesWithMaturity';
  import TagList from '$shared/presentation/components/TagList.svelte';
  import ProgressBar from '$shared/presentation/components/ProgressBar.svelte';

  type Props = {
    summary: FeatureCardModel;
    onDelete: () => void;
    onAddTag?: (type: string, value: string) => void | Promise<void>;
    onRemoveTag?: (type: string, value: string) => void | Promise<void>;
    tagTypeOptions?: readonly string[];
    deleteLabel?: string;
    openLabel?: string;
    /**
     * Optional queue toggle. Provided by the parent (ProjectFeaturesPanel) when
     * the card is rendered inside a project, where "implement next" is
     * meaningful. Standalone usages (e.g. /features index) leave both undefined
     * so the button doesn't render and the card stays minimal.
     */
    onAddToQueue?: () => void | Promise<void>;
    onRemoveFromQueue?: () => void | Promise<void>;
    queued?: boolean;
  };

  let {
    summary,
    onDelete,
    onAddTag,
    onRemoveTag,
    tagTypeOptions = [],
    deleteLabel = 'Delete',
    openLabel = 'Open feature',
    onAddToQueue,
    onRemoveFromQueue,
    queued = false
  }: Props = $props();

  const badgeColor = $derived(
    summary.maturityPercentage >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : summary.maturityPercentage >= 50
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200'
  );

  const cardAccent = $derived(
    summary.maturityPercentage >= 80
      ? 'from-emerald-400 via-brand-mint to-brand-500'
      : summary.maturityPercentage >= 50
        ? 'from-amber-400 via-brand-ochre to-brand-peach'
        : 'from-red-400 via-brand-coral to-brand-pink'
  );
</script>

<article
  class="group relative flex h-full min-h-52 flex-col justify-between overflow-hidden rounded-xl border border-cyan-100 bg-white p-5 shadow-sm shadow-cyan-950/5 transition duration-150 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50/20 hover:shadow-md hover:shadow-cyan-950/10 focus-within:border-cyan-300"
>
  <div class="absolute inset-x-0 top-0 h-1 bg-linear-to-r {cardAccent}"></div>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <a href={`/features/${summary.id}`} class="block min-w-0 flex-1">
        <h3 class="truncate text-base font-semibold text-slate-950 group-hover:text-brand-800">
          {summary.name}
        </h3>
      </a>
      <span
        class="shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium {badgeColor}"
        title="Maturity score"
      >
        {summary.maturityPercentage}%
      </span>
    </div>

    {#if summary.description}
      <a href={`/features/${summary.id}`} class="block">
        <p class="line-clamp-3 text-sm leading-6 text-slate-600">{summary.description}</p>
      </a>
    {:else}
      <p class="text-sm leading-6 text-slate-500">
        No description yet. Open this feature to shape its behavior model.
      </p>
    {/if}

    <TagList tags={summary.tags} {onAddTag} {onRemoveTag} typeOptions={tagTypeOptions} />

    <div class="space-y-2">
      <ProgressBar
        percentage={summary.maturityPercentage}
        size="sm"
        ariaLabel="Maturity {summary.maturityPercentage}%"
      />
      <div class="text-xs text-slate-500">
        {#if summary.criticalIssueCount > 0}
          <span class="text-red-600">{summary.criticalIssueCount} critical</span>
          {#if summary.recommendedIssueCount > 0}<span class="px-1">/</span>{/if}
        {/if}
        {#if summary.recommendedIssueCount > 0}
          <span class="text-amber-700">{summary.recommendedIssueCount} recommended</span>
        {/if}
        {#if summary.criticalIssueCount === 0 && summary.recommendedIssueCount === 0}
          <span class="text-emerald-700">All checks pass</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="mt-5 flex items-center justify-between gap-3 border-t border-hairline pt-3 text-xs text-slate-500">
    <span class="min-w-0 flex-1 truncate">
      {summary.surfaceCount} surface{summary.surfaceCount === 1 ? '' : 's'} / {summary.actionCount}
      capabilit{summary.actionCount === 1 ? 'y' : 'ies'} / Updated {new Date(summary.updatedAt).toLocaleDateString()}
    </span>
    <div class="flex shrink-0 items-center gap-1">
      {#if onAddToQueue || onRemoveFromQueue}
        <button
          type="button"
          class="rounded px-2 py-1 transition {queued
            ? 'font-medium text-brand-700 opacity-100 hover:bg-cyan-50 hover:text-brand-900'
            : 'text-slate-400 opacity-0 hover:bg-cyan-50 hover:text-brand-800 group-hover:opacity-100 group-focus-within:opacity-100'}"
          onclick={queued ? onRemoveFromQueue : onAddToQueue}
          title={queued ? 'In implementation queue (click to remove)' : 'Add to implementation queue'}
        >
          {queued ? '✓ queued' : '+ queue'}
        </button>
      {/if}
      <a href={`/features/${summary.id}`} class="rounded px-2 py-1 font-medium text-brand-800 hover:bg-cyan-50 hover:text-brand-900">
        {openLabel}
      </a>
      <button
        type="button"
        class="rounded px-2 py-1 text-slate-400 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-50 hover:text-red-600"
        onclick={onDelete}
      >
        {deleteLabel}
      </button>
    </div>
  </div>
</article>
