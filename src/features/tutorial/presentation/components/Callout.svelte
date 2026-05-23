<script lang="ts">
  type Props = {
    tone?: 'info' | 'warning' | 'success';
    title?: string;
    children: import('svelte').Snippet;
  };
  let { tone = 'info', title, children }: Props = $props();

  const cls = $derived(
    tone === 'warning'
      ? 'bg-amber-50 border-amber-200 text-amber-900'
      : tone === 'success'
        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
        : 'bg-brand-50 border-brand-200 text-brand-900'
  );
</script>

<div class="rounded-md border p-3 text-sm {cls}">
  {#if title}
    <p class="mb-1 font-semibold">{title}</p>
  {/if}
  <div class="leading-6">{@render children()}</div>
</div>
