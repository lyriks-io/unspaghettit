<script lang="ts">
  import type { TagColor } from '$shared/domain/TagPalette';

  type Props = {
    color: TagColor | null;
    // Diameter in Tailwind size units (e.g. 1.5 -> size-1.5). Defaults to 2.
    size?: 1.5 | 2 | 2.5 | 3 | 4 | 5;
  };

  let { color, size = 2 }: Props = $props();

  // Static class strings so Tailwind's content scanner sees them.
  const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
    1.5: 'size-1.5',
    2: 'size-2',
    2.5: 'size-2.5',
    3: 'size-3',
    4: 'size-4',
    5: 'size-5'
  };

  const sizeClass = $derived(SIZE_CLASS[size]);
</script>

{#if color}
  <span
    class="block shrink-0 rounded-full ring-1 ring-inset ring-black/10 {sizeClass}"
    style="background-color: {color};"
    aria-hidden="true"
  ></span>
{:else}
  <!--
    "No color" affordance: blank circle with a red diagonal so the absence
    reads as intentional rather than a missing-style bug. SVG keeps the line
    crisp at any size without depending on Tailwind classes.
  -->
  <svg
    viewBox="0 0 16 16"
    class="block shrink-0 {sizeClass}"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="6.5" fill="white" stroke="#cbd5e1" stroke-width="1" />
    <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" />
  </svg>
{/if}
