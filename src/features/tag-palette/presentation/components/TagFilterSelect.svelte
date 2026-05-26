<script lang="ts" module>
  export type TagFilterValue =
    | 'all'
    | 'untagged'
    | { readonly type: string; readonly value: string };
</script>

<script lang="ts">
  import { humanizeTagText, tagKey, type Tag } from '$shared/domain/Tags';
  import { tagPaletteStore } from '$features/tag-palette/presentation/stores/tagPaletteStore.svelte';
  import TagSwatch from '$features/tag-palette/presentation/components/TagSwatch.svelte';

  type Props = {
    tags: readonly Tag[];
    value: TagFilterValue;
    onChange: (next: TagFilterValue) => void;
    onManage?: () => void;
    countLabel?: (filter: TagFilterValue) => number | undefined;
  };

  let { tags, value, onChange, onManage, countLabel }: Props = $props();

  // Dedupe + bucket tags by their normalized type so the dropdown can render
  // one <optgroup> per type with the values listed beneath.
  const groupedOptions = $derived.by(() => {
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

  const flatOptions = $derived(groupedOptions.flatMap((group) => group.tags));

  const SENTINEL_ALL = '__all__';
  const SENTINEL_UNTAGGED = '__untagged__';

  const selectValue = $derived.by(() => {
    if (value === 'all') return SENTINEL_ALL;
    if (value === 'untagged') return SENTINEL_UNTAGGED;
    return tagKey(value);
  });

  function handleChange(event: Event) {
    const raw = (event.target as HTMLSelectElement).value;
    if (raw === SENTINEL_ALL) {
      onChange('all');
      return;
    }
    if (raw === SENTINEL_UNTAGGED) {
      onChange('untagged');
      return;
    }
    const picked = flatOptions.find((tag) => tagKey(tag) === raw);
    if (picked) onChange({ type: picked.type, value: picked.value });
  }

  const activeColor = $derived(
    value !== 'all' && value !== 'untagged'
      ? tagPaletteStore.colorFor(value.type)
      : null
  );
  const showActiveSwatch = $derived(value !== 'all' && value !== 'untagged');

  const allCount = $derived(countLabel?.('all'));
  const untaggedCount = $derived(countLabel?.('untagged'));
</script>

<label class="group/tagfilter flex h-10 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-sm text-slate-600">
  <span class="text-xs font-medium">Tag</span>
  {#if showActiveSwatch}
    <TagSwatch color={activeColor} size={2} />
  {/if}
  <select
    value={selectValue}
    onchange={handleChange}
    class="bg-transparent text-sm font-medium text-slate-800 outline-none"
    aria-label="Filter by tag"
  >
    <option value={SENTINEL_ALL}>
      All{allCount !== undefined ? ` (${allCount})` : ''}
    </option>
    <option value={SENTINEL_UNTAGGED}>
      Untagged{untaggedCount !== undefined ? ` (${untaggedCount})` : ''}
    </option>
    {#each groupedOptions as group (group.typeKey)}
      <optgroup label={group.display}>
        {#each group.tags as tag (tagKey(tag))}
          {@const c = countLabel?.({ type: tag.type, value: tag.value })}
          <option value={tagKey(tag)}>
            {humanizeTagText(tag.value)}{c !== undefined ? ` (${c})` : ''}
          </option>
        {/each}
      </optgroup>
    {/each}
  </select>
  {#if onManage}
    <button
      type="button"
      class="ml-0 max-w-0 overflow-hidden whitespace-nowrap rounded px-0 py-1 text-xs font-medium text-slate-500 opacity-0 transition-all duration-200 delay-0 ease-out group-hover/tagfilter:ml-1 group-hover/tagfilter:max-w-24 group-hover/tagfilter:px-2 group-hover/tagfilter:opacity-100 group-hover/tagfilter:delay-300 group-focus-within/tagfilter:ml-1 group-focus-within/tagfilter:max-w-24 group-focus-within/tagfilter:px-2 group-focus-within/tagfilter:opacity-100 group-focus-within/tagfilter:delay-300 hover:bg-slate-100 hover:text-slate-900"
      onclick={onManage}
      title="Rename tags or set colors"
    >
      Manage
    </button>
  {/if}
</label>
