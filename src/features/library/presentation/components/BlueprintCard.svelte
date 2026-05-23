<script lang="ts">
  import type { SurfaceBlueprint } from '$features/library/domain/entities/SurfaceBlueprint';
  import { blueprintCategoryLabel } from '$features/library/domain/value-objects/BlueprintCategory';

  type Props = {
    blueprint: SurfaceBlueprint;
    selected: boolean;
    onToggle: () => void;
  };
  let { blueprint, selected, onToggle }: Props = $props();
</script>

<button
  type="button"
  onclick={onToggle}
  aria-pressed={selected}
  class="flex w-full flex-col gap-2 rounded-lg border bg-white p-3 text-left transition {selected
    ? 'border-brand-600 ring-2 ring-brand-100'
    : 'border-hairline hover:border-slate-300'}"
>
  <header class="flex flex-wrap items-center gap-2">
    <h3 class="text-sm font-semibold text-slate-950">{blueprint.name}</h3>
    <span
      class="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
    >
      {blueprintCategoryLabel(blueprint.category)}
    </span>
    <span
      class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
      title="Verified to score 100% on the maturity check"
    >
      100% mature
    </span>
    {#if selected}
      <span
        class="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-white"
        aria-hidden="true"
      >
        ✓
      </span>
    {/if}
  </header>

  <p class="text-xs leading-relaxed text-slate-600">{blueprint.summary}</p>

  {#if blueprint.tags.length > 0}
    <ul class="flex flex-wrap gap-1">
      {#each blueprint.tags as tag (tag)}
        <li class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
          {tag}
        </li>
      {/each}
    </ul>
  {/if}
</button>
