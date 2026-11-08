<script lang="ts">
  /**
   * The EARS sentence of a rule, an effect, an invariant or a goal: what the
   * logic below says, in plain words, for a person who does not read the
   * condition blocks or the JSON. Built by a fixed template, never by AI.
   */
  type Props = { text: string };
  let { text }: Props = $props();
</script>

{#if text}
  <p
    class="rounded-md border-l-2 border-violet-400 bg-violet-50/60 px-2 py-1.5 text-xs leading-relaxed text-slate-700"
    data-testid="ears-sentence"
  >
    <span
      class="mr-1 rounded bg-violet-100 px-1 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-violet-700"
      title="The requirement this element states, in EARS form (While / When / If ... then / shall)"
      >EARS</span
    >{text}
  </p>
{/if}
