<script lang="ts">
  import { humanizeTagText, tagKey, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import { stylesFor } from '$features/tag-palette/presentation/services/tagColorStyles';
  import TagSwatch from '$features/tag-palette/presentation/components/TagSwatch.svelte';
  import type { TagFilterValue } from '$features/tag-palette/presentation/components/TagFilterSelect.svelte';

  type Props = {
    tags: readonly Tag[];
    value: TagFilterValue;
    onChange: (next: TagFilterValue) => void;
    countLabel?: (filter: TagFilterValue) => number | undefined;
  };

  let { tags, value, onChange, countLabel }: Props = $props();

  // Bucket distinct tags by normalized type so the bar can show
  // "Status: [Alpha] [Beta]" rows instead of a single flat list.
  const groups = $derived.by(() => {
    const byType = new Map<string, { typeKey: string; display: string; tags: Tag[] }>();
    for (const tag of tags) {
      const typeKey = tag.type.trim().toLowerCase();
      if (!typeKey) continue;
      const bucket = byType.get(typeKey);
      if (bucket) {
        if (!bucket.tags.some((t) => tagKey(t) === tagKey(tag))) bucket.tags.push(tag);
      } else {
        byType.set(typeKey, {
          typeKey,
          display: humanizeTagText(typeKey),
          tags: [tag]
        });
      }
    }
    return [...byType.values()]
      .sort((a, b) => a.display.localeCompare(b.display))
      .map((group) => ({
        ...group,
        tags: [...group.tags].sort((a, b) => a.value.localeCompare(b.value))
      }));
  });

  function isActive(tag: Tag): boolean {
    if (value === 'all' || value === 'untagged') return false;
    return tagKey(value) === tagKey(tag);
  }

  function toggle(tag: Tag) {
    if (isActive(tag)) onChange('all');
    else onChange({ type: tag.type, value: tag.value });
  }
</script>

{#if groups.length > 0}
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <button
      type="button"
      class="rounded-full border px-2.5 py-1 font-medium transition {value === 'all'
        ? 'border-slate-900 bg-slate-900 text-white'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
      onclick={() => onChange('all')}
    >
      All{countLabel ? ` (${countLabel('all') ?? 0})` : ''}
    </button>
    <button
      type="button"
      class="rounded-full border px-2.5 py-1 font-medium transition {value === 'untagged'
        ? 'border-slate-900 bg-slate-900 text-white'
        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}"
      onclick={() => onChange('untagged')}
    >
      Untagged{countLabel ? ` (${countLabel('untagged') ?? 0})` : ''}
    </button>

    {#each groups as group (group.typeKey)}
      {@const color = tagPaletteStore.colorFor(group.typeKey)}
      {@const style = stylesFor(color)}
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {group.display}
        </span>
        {#each group.tags as tag (tagKey(tag))}
          {@const active = isActive(tag)}
          {@const count = countLabel?.({ type: tag.type, value: tag.value })}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition hover:brightness-95"
            style={active
              ? `background-color: ${style.pillBackground}; color: ${style.pillText}; box-shadow: inset 0 0 0 1px ${style.pillRing};`
              : 'background-color: #ffffff; color: #475569; box-shadow: inset 0 0 0 1px #e2e8f0;'}
            onclick={() => toggle(tag)}
            aria-pressed={active}
          >
            <TagSwatch {color} size={1.5} />
            <span>{humanizeTagText(tag.value)}{count !== undefined ? ` (${count})` : ''}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}
