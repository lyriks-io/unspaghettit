<script lang="ts">
  type Props = {
    id: string;
    title: string;
    children: import('svelte').Snippet;
  };
  let { id, title, children }: Props = $props();
</script>

<section {id} class="scroll-mt-24 space-y-3 border-b border-hairline pb-8 last:border-b-0">
  <h2 class="text-xl font-semibold tracking-tight">
    <a href={`#${id}`} class="text-slate-950 hover:text-brand-700">{title}</a>
  </h2>
  <div class="space-y-3 text-sm leading-7 text-slate-700">
    {@render children()}
  </div>
</section>
