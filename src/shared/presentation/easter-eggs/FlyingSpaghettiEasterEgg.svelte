<script lang="ts">
  const WORD_TRIGGER = "spaghetti";
  const KONAMI_SEQUENCE = [
    "arrowup", "arrowup", "arrowdown", "arrowdown",
    "arrowleft", "arrowright", "arrowleft", "arrowright",
    "b", "a"
  ] as const;
  const VISIBLE_MS = 5200;

  let visible = $state(false);
  let wordBuffer = "";
  let konamiIndex = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function isTextEntryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function launch() {
    visible = false;
    if (hideTimer) clearTimeout(hideTimer);
    requestAnimationFrame(() => {
      visible = true;
      hideTimer = setTimeout(() => { visible = false; }, VISIBLE_MS);
    });
  }

  function trackKonami(key: string): boolean {
    if (key === KONAMI_SEQUENCE[konamiIndex]) {
      konamiIndex += 1;
      if (konamiIndex < KONAMI_SEQUENCE.length) return false;
      konamiIndex = 0;
      return true;
    }
    // Wrong key restarts the sequence; allow the wrong key to count as the
    // first key of a fresh attempt if it matches the head of the sequence.
    konamiIndex = key === KONAMI_SEQUENCE[0] ? 1 : 0;
    return false;
  }

  function trackWord(key: string): boolean {
    if (key.length !== 1) return false;
    wordBuffer = (wordBuffer + key).slice(-WORD_TRIGGER.length);
    if (wordBuffer !== WORD_TRIGGER) return false;
    wordBuffer = "";
    return true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isTextEntryTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (trackKonami(key) || trackWord(key)) launch();
  }

  $effect(() => () => {
    if (hideTimer) clearTimeout(hideTimer);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
  <div class="untangler-sky" aria-hidden="true">
    <div class="untangler">
      <svg viewBox="0 0 240 110" role="img">
        <g class="tangle tangle-outline">
          <path d="M5 55 C 32 12, 48 95, 72 32 S 116 80, 148 42 S 196 22, 232 62" />
          <path d="M5 70 C 28 32, 52 95, 78 22 S 124 72, 156 44 S 200 30, 232 76" />
          <path d="M5 40 C 36 82, 60 12, 92 70 S 118 30, 150 52 S 196 70, 230 30" />
          <path d="M5 88 C 30 60, 48 100, 80 65 S 130 95, 165 70 S 210 88, 232 60" />
        </g>
        <g class="tangle tangle-fill">
          <path d="M5 55 C 32 12, 48 95, 72 32 S 116 80, 148 42 S 196 22, 232 62" />
          <path d="M5 70 C 28 32, 52 95, 78 22 S 124 72, 156 44 S 200 30, 232 76" />
          <path d="M5 40 C 36 82, 60 12, 92 70 S 118 30, 150 52 S 196 70, 230 30" />
          <path d="M5 88 C 30 60, 48 100, 80 65 S 130 95, 165 70 S 210 88, 232 60" />
        </g>

        <g class="clean clean-outline">
          <line x1="5" y1="30" x2="232" y2="30" />
          <line x1="5" y1="50" x2="232" y2="50" />
          <line x1="5" y1="70" x2="232" y2="70" />
          <line x1="5" y1="90" x2="232" y2="90" />
        </g>
        <g class="clean clean-fill">
          <line x1="5" y1="30" x2="232" y2="30" />
          <line x1="5" y1="50" x2="232" y2="50" />
          <line x1="5" y1="70" x2="232" y2="70" />
          <line x1="5" y1="90" x2="232" y2="90" />
        </g>

        <g class="glint">
          <rect x="-18" y="18" width="14" height="78" rx="3" />
        </g>
      </svg>
    </div>
  </div>
{/if}

<style>
  .untangler-sky {
    position: fixed;
    inset: 0;
    z-index: 100;
    pointer-events: none;
    overflow: hidden;
  }

  .untangler {
    --duration: 5s;
    --ease: cubic-bezier(0.3, 0, 0.2, 1);
    --outline: #0f172a;
    --shadow: drop-shadow(0 4px 4px rgb(15 23 42 / 0.35));
    --strand-1: #f43f5e;
    --strand-2: #f59e0b;
    --strand-3: #10b981;
    --strand-4: #0ea5e9;

    position: absolute;
    left: -260px;
    top: 26vh;
    width: 260px;
    height: 120px;
    animation: untangler-flight var(--duration) var(--ease) forwards;
    filter: drop-shadow(0 14px 18px rgb(15 23 42 / 0.16));
  }

  svg {
    width: 100%;
    height: auto;
    overflow: visible;
  }

  /*
   * Tangle and clean share the same SVG slot and cross-fade via inverse
   * clip-paths: tangle clips away from the left while clean reveals from
   * the left, giving the illusion of a single wipe boundary moving across.
   */
  .tangle,
  .clean {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tangle {
    animation: tangle-wipe var(--duration) var(--ease) forwards;
  }
  .clean {
    animation: clean-reveal var(--duration) var(--ease) forwards;
  }

  .tangle-outline,
  .clean-outline {
    stroke: var(--outline);
    stroke-width: 11;
    filter: var(--shadow);
  }
  .tangle-fill,
  .clean-fill {
    stroke-width: 7;
  }

  .tangle-fill > :nth-child(1),
  .clean-fill > :nth-child(1) { stroke: var(--strand-1); }
  .tangle-fill > :nth-child(2),
  .clean-fill > :nth-child(2) { stroke: var(--strand-2); }
  .tangle-fill > :nth-child(3),
  .clean-fill > :nth-child(3) { stroke: var(--strand-3); }
  .tangle-fill > :nth-child(4),
  .clean-fill > :nth-child(4) { stroke: var(--strand-4); }

  /* Bright highlight bar that sweeps across the resolved strands. */
  .glint {
    fill: #ffffff;
    opacity: 0;
    filter: drop-shadow(0 0 6px rgb(255 255 255 / 0.9));
    mix-blend-mode: screen;
    animation: glint-sweep var(--duration) var(--ease) forwards;
  }

  /*
   * Enter quickly, hold near centre while the wipe + glint play, then exit
   * right. The held window (22%-78%) is when the eye should be on the
   * transition rather than on the lateral motion.
   */
  @keyframes untangler-flight {
    0% {
      opacity: 0;
      transform: translate3d(-20vw, 28px, 0) rotate(-3deg) scale(0.95);
    }
    22%,
    78% {
      opacity: 1;
      transform: translate3d(42vw, 0, 0) rotate(0deg) scale(1);
    }
    90% {
      opacity: 1;
      transform: translate3d(60vw, -6px, 0) rotate(2deg) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate3d(calc(100vw + 280px), -22px, 0) rotate(6deg) scale(0.96);
    }
  }

  @keyframes tangle-wipe {
    0%, 28% { clip-path: inset(0 0 0 0); }
    72%, 100% { clip-path: inset(0 0 0 100%); }
  }
  @keyframes clean-reveal {
    0%, 28% { clip-path: inset(0 100% 0 0); }
    72%, 100% { clip-path: inset(0 0 0 0); }
  }
  @keyframes glint-sweep {
    0%, 70% { transform: translateX(0); opacity: 0; }
    74% { opacity: 1; }
    88% { transform: translateX(258px); opacity: 1; }
    94%, 100% { transform: translateX(264px); opacity: 0; }
  }

  /* Skip the flight + wipe; just cross-fade in place. */
  @media (prefers-reduced-motion: reduce) {
    .untangler { animation: untangler-peek 2.6s ease-out forwards; }
    .tangle    { animation: tangle-fade 2.6s ease-out forwards; clip-path: none; }
    .clean     { animation: clean-fade 2.6s ease-out forwards; clip-path: none; }
  }

  @keyframes untangler-peek {
    0%        { opacity: 0; transform: translate3d(38vw, 20px, 0) scale(0.96); }
    20%, 80%  { opacity: 1; transform: translate3d(38vw, 0, 0) scale(0.96); }
    100%      { opacity: 0; transform: translate3d(38vw, -10px, 0) scale(0.96); }
  }
  @keyframes tangle-fade {
    0%, 40%   { opacity: 1; }
    65%, 100% { opacity: 0; }
  }
  @keyframes clean-fade {
    0%, 40%   { opacity: 0; }
    65%, 100% { opacity: 1; }
  }
</style>
