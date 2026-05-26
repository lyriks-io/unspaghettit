<script lang="ts">
  import type { ProjectSummary } from '$features/projects/application/ports/ProjectRepository';
  import { projectsStore } from '$features/projects/presentation/stores/projectsStore.svelte';
  import TagDotStrip from '$features/tag-palette/presentation/components/TagDotStrip.svelte';

  type Props = {
    summary: ProjectSummary;
    onDelete: () => void;
    onAddTag?: (type: string, value: string) => void | Promise<void>;
    onRemoveTag?: (type: string, value: string) => void | Promise<void>;
    tagTypeOptions?: readonly string[];
    deleteLabel?: string;
  };

  let {
    summary,
    onDelete,
    onAddTag,
    onRemoveTag,
    tagTypeOptions = [],
    deleteLabel = 'Delete'
  }: Props = $props();

  function markOpened() {
    projectsStore.openProject(String(summary.id));
  }
</script>

<article
  data-tour="project-card"
  class="group relative flex h-full min-h-52 flex-col justify-between overflow-hidden rounded-xl border border-cyan-100 bg-white p-5 shadow-sm shadow-cyan-950/5 transition duration-150 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50/20 hover:shadow-md hover:shadow-cyan-950/10 focus-within:border-cyan-300"
>
  <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-brand-mint to-violet-400"></div>
  <div class="space-y-3">
    <div class="flex items-start justify-between gap-3">
      <a href={`/projects/${summary.id}`} class="block min-w-0 flex-1" onclick={markOpened}>
        <h3 class="truncate text-base font-semibold text-slate-950 group-hover:text-brand-800">
          {summary.name}
        </h3>
      </a>
      <span
        class="shrink-0 rounded-md border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-xs font-medium text-brand-800"
        title="Features in project"
      >
        {summary.featureCount} feature{summary.featureCount === 1 ? '' : 's'}
      </span>
    </div>

    {#if summary.description}
      <a href={`/projects/${summary.id}`} class="block" onclick={markOpened}>
        <p class="line-clamp-3 text-sm leading-6 text-slate-600">{summary.description}</p>
      </a>
    {:else}
      <p class="text-sm leading-6 text-slate-500">No description yet. Add a note so collaborators know what belongs here.</p>
    {/if}
  </div>

  <div class="mt-5 flex items-end justify-between gap-3 border-t border-hairline pt-3 text-xs text-slate-500">
    <div class="min-w-0 flex-1 space-y-2">
      <TagDotStrip tags={summary.tags} {onAddTag} {onRemoveTag} typeOptions={tagTypeOptions} />
      <span class="block truncate">
        Updated {new Date(summary.updatedAt).toLocaleDateString()}
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-1">
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
