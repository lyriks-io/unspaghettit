<script lang="ts">
  let {
    label,
    value
  }: {
    readonly label: string;
    readonly value: number | null;
  } = $props();

  const normalized = $derived(value === null ? 0 : Math.max(0, Math.min(100, value)));
  const displayValue = $derived(`${normalized}%`);
  const dash = $derived(normalized * 0.87965);
  const toneClass = $derived(
    normalized >= 80
        ? 'is-high'
        : normalized >= 45
          ? 'is-mid'
          : 'is-low'
  );
</script>

<div class="score-meter {toneClass}">
  <div class="score-meter__dial">
    <svg viewBox="0 0 36 36" class="score-meter__svg" aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="none" class="score-meter__outer" stroke-width="1.2" />
      <circle cx="18" cy="18" r="14" fill="none" class="score-meter__track" stroke-width="2.4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        class="score-meter__arc-glow"
        stroke-width="8"
        stroke-linecap={normalized > 0 ? 'round' : 'butt'}
        stroke-dasharray={`${dash} 87.965`}
      />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        class="score-meter__arc"
        stroke-width="2.4"
        stroke-linecap={normalized > 0 ? 'round' : 'butt'}
        stroke-dasharray={`${dash} 87.965`}
      />
    </svg>
    <span class="score-meter__readout">
      {displayValue}
    </span>
  </div>
  <span class="score-meter__label">{label}</span>
</div>

<style>
  .score-meter {
    --accent: #94a3b8;
    --accent-soft: rgba(148, 163, 184, 0.24);
    display: flex;
    min-width: 76px;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .score-meter.is-high {
    --accent: #34d399;
    --accent-soft: rgba(52, 211, 153, 0.34);
  }

  .score-meter.is-mid {
    --accent: #fb923c;
    --accent-soft: rgba(251, 146, 60, 0.28);
  }

  .score-meter.is-low {
    --accent: #f43f5e;
    --accent-soft: rgba(244, 63, 94, 0.24);
  }

  .score-meter.is-empty {
    --accent: #94a3b8;
    --accent-soft: rgba(148, 163, 184, 0.2);
  }

  .score-meter__dial {
    position: relative;
    width: 68px;
    height: 68px;
    border: 1px solid rgba(15, 23, 42, 0.92);
    border-radius: 999px;
    background:
      radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.18), transparent 22%),
      radial-gradient(circle at 50% 66%, rgba(255, 255, 255, 0.08), transparent 43%),
      linear-gradient(180deg, rgba(71, 85, 105, 0.96), rgba(15, 23, 42, 0.98));
    box-shadow:
      0 14px 22px rgba(0, 0, 0, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.18) inset,
      0 -3px 0 rgba(2, 6, 23, 0.9) inset,
      0 0 0 6px rgba(15, 23, 42, 0.66) inset;
  }

  .score-meter__dial::before {
    content: "";
    position: absolute;
    inset: 5px;
    border-radius: inherit;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 42%),
      linear-gradient(180deg, rgba(2, 6, 23, 0.2), rgba(2, 6, 23, 0.72));
    box-shadow:
      0 1px 1px rgba(255, 255, 255, 0.08) inset,
      0 10px 18px rgba(0, 0, 0, 0.4) inset;
  }

  .score-meter__dial::after {
    content: "";
    position: absolute;
    inset: 6px;
    border-radius: inherit;
    background: radial-gradient(circle, var(--accent-soft), transparent 58%);
    opacity: 0.28;
    filter: blur(7px);
  }

  .score-meter__svg {
    position: absolute;
    inset: 6px;
    z-index: 1;
    overflow: visible;
    /* The lit well sits high (top-left light + thick bottom rim), so geometric-center
       content reads as low — lift the arc + readout ~1px into the optical center. */
    transform: translateY(-1px) rotate(-90deg);
  }

  .score-meter__outer {
    stroke: rgba(226, 232, 240, 0.16);
  }

  .score-meter__track {
    stroke: rgba(30, 41, 59, 0.72);
    filter:
      drop-shadow(0 1px 0 rgba(255, 255, 255, 0.08))
      drop-shadow(0 -1px 0 rgba(0, 0, 0, 0.28))
      drop-shadow(0 0 5px rgba(148, 163, 184, 0.12));
  }

  .score-meter.is-empty .score-meter__track {
    stroke: rgba(71, 85, 105, 0.72);
    filter:
      drop-shadow(0 1px 0 rgba(255, 255, 255, 0.08))
      drop-shadow(0 -1px 0 rgba(0, 0, 0, 0.2))
      drop-shadow(0 0 7px rgba(148, 163, 184, 0.16));
  }

  .score-meter__arc-glow {
    stroke: var(--accent);
    opacity: 0.16;
    filter: blur(2.8px);
  }

  .score-meter__arc {
    stroke: var(--accent);
    opacity: 0.68;
    filter:
      drop-shadow(0 1px 0 rgba(255, 255, 255, 0.07))
      drop-shadow(0 0 7px var(--accent-soft));
  }

  .score-meter__readout {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    /* match the arc's optical lift and kill inherited line-height drift */
    transform: translateY(-1px);
    line-height: 1;
    color: white;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 13px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
  }

  .score-meter__label {
    color: rgb(148, 163, 184);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }
</style>
