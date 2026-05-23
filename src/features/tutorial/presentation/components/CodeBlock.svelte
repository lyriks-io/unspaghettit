<script lang="ts">
  type Props = { code: string; language?: string };
  let { code, language = 'text' }: Props = $props();
</script>

<pre
  class="mono overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-[12px] leading-relaxed text-slate-100"
  data-lang={language}><code>{code}</code></pre>
