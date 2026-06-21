<script lang="ts">
  type Props = { code: string; language?: string };
  let { code, language = 'text' }: Props = $props();
</script>

<!-- Literal dark colours (not the slate-* token classes) so the code block keeps
     its default near-black background under every theme/skin — the Lyriks
     skin remaps `--color-slate-*` and the `.bg-slate-950` utility to violet,
     which would otherwise recolour these blocks. -->
<pre
  class="mono overflow-x-auto rounded-lg border border-[#1e293b] bg-[#020617] p-4 text-[12px] leading-relaxed text-[#eaeef4]"
  data-lang={language}><code>{code}</code></pre>
