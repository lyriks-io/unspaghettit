<script lang="ts">
  import { onDestroy } from "svelte";

  const WORD_TRIGGER = "spaghetti";
  const KONAMI_SEQUENCE = [
    "ArrowUp",
    "ArrowUp",
    "ArrowDown",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowLeft",
    "ArrowRight",
    "b",
    "a"
  ];

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
      hideTimer = setTimeout(() => {
        visible = false;
      }, 5200);
    });

    console.info("Unspaghettit easter egg: al dente mode engaged.");
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isTextEntryTarget(event.target)) return;

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    const expectedKonamiKey = KONAMI_SEQUENCE[konamiIndex]?.toLowerCase();
    if (expectedKonamiKey && key === expectedKonamiKey) {
      konamiIndex += 1;
      if (konamiIndex === KONAMI_SEQUENCE.length) {
        konamiIndex = 0;
        launch();
      }
    } else {
      konamiIndex = key === "arrowup" ? 1 : 0;
    }

    if (event.key.length !== 1) return;
    wordBuffer = `${wordBuffer}${event.key.toLowerCase()}`.slice(-WORD_TRIGGER.length);
    if (wordBuffer === WORD_TRIGGER) {
      wordBuffer = "";
      launch();
    }
  }

  onDestroy(() => {
    if (hideTimer) clearTimeout(hideTimer);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
  <div class="spaghetti-sky" aria-hidden="true">
    <div class="spaghetti">
      <svg viewBox="0 0 180 130" role="img">
        <g class="wing wing-left">
          <path d="M49 55c-22-17-37-12-44 3 14-2 24 1 32 10-14 0-23 5-29 16 18-4 31-1 41 11" />
        </g>
        <g class="wing wing-right">
          <path d="M131 55c22-17 37-12 44 3-14-2-24 1-32 10 14 0 23 5 29 16-18-4-31-1-41 11" />
        </g>

        <ellipse class="bowl-shadow" cx="90" cy="102" rx="56" ry="13" />
        <path class="bowl" d="M35 73h110c-5 31-22 46-55 46S40 104 35 73Z" />
        <path class="bowl-lip" d="M31 72c0-9 26-16 59-16s59 7 59 16-26 16-59 16-59-7-59-16Z" />

        <g class="noodles">
          <path d="M43 68c12-20 31-16 32 0s-26 13-18-4 36-15 42 1-20 17-21 0 28-21 44-3" />
          <path d="M49 61c18-12 30-10 36 2s-8 20-19 13 7-25 29-19 19 25 4 25-8-25 26-22" />
          <path d="M55 77c5-12 23-18 35-8s-1 22-17 14 0-24 27-17 29 19 13 25-25-6-8-17" />
          <path d="M63 53c7-10 20-15 31-7s-1 17-10 12 7-18 28-12 21 16 10 20" />
        </g>

        <g class="sauce">
          <circle cx="69" cy="65" r="9" />
          <circle cx="105" cy="70" r="11" />
          <circle cx="91" cy="55" r="7" />
        </g>

        <g class="face">
          <circle cx="76" cy="78" r="3.5" />
          <circle cx="104" cy="78" r="3.5" />
          <path d="M82 88c7 6 16 6 23 0" />
        </g>

        <g class="fork">
          <path d="M132 24l-25 78" />
          <path d="M124 22l21 7" />
          <path d="M128 14l-7 21" />
          <path d="M136 16l-7 21" />
          <path d="M144 19l-7 21" />
        </g>
      </svg>
      <div class="label">al dente mode</div>
    </div>
  </div>
{/if}

<style>
  .spaghetti-sky {
    position: fixed;
    inset: 0;
    z-index: 100;
    pointer-events: none;
    overflow: hidden;
  }

  .spaghetti {
    position: absolute;
    left: -230px;
    top: 22vh;
    width: 190px;
    height: 145px;
    animation: spaghetti-flight 5s cubic-bezier(0.3, 0, 0.2, 1) forwards;
    filter: drop-shadow(0 18px 18px rgb(15 23 42 / 0.18));
  }

  svg {
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .bowl-shadow {
    fill: rgb(15 23 42 / 0.12);
  }

  .bowl {
    fill: #f8fafc;
    stroke: #94a3b8;
    stroke-width: 3;
  }

  .bowl-lip {
    fill: #fff7ed;
    stroke: #94a3b8;
    stroke-width: 3;
  }

  .noodles {
    fill: none;
    stroke: #facc15;
    stroke-width: 7;
    stroke-linecap: round;
    stroke-linejoin: round;
    animation: noodle-wiggle 760ms ease-in-out infinite alternate;
  }

  .sauce {
    fill: #ef4444;
    stroke: #991b1b;
    stroke-width: 2;
  }

  .face {
    fill: #0f172a;
    stroke: #78350f;
    stroke-width: 3;
    stroke-linecap: round;
  }

  .face circle {
    stroke: none;
  }

  .fork {
    fill: none;
    stroke: #64748b;
    stroke-width: 5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .wing {
    fill: #f8fafc;
    stroke: #14b8a6;
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform-box: fill-box;
    transform-origin: center;
    animation: wing-flap 360ms ease-in-out infinite alternate;
  }

  .wing-right {
    animation-delay: 110ms;
  }

  .label {
    position: absolute;
    left: 44px;
    top: 114px;
    border-radius: 999px;
    background: rgb(15 23 42 / 0.92);
    padding: 3px 8px;
    color: white;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  @keyframes spaghetti-flight {
    0% {
      opacity: 0;
      transform: translate3d(0, 48px, 0) rotate(-12deg) scale(0.9);
    }
    10% {
      opacity: 1;
    }
    45% {
      transform: translate3d(48vw, -8vh, 0) rotate(8deg) scale(1);
    }
    75% {
      opacity: 1;
      transform: translate3d(76vw, 18vh, 0) rotate(-6deg) scale(0.98);
    }
    100% {
      opacity: 0;
      transform: translate3d(calc(100vw + 220px), -4vh, 0) rotate(18deg) scale(0.92);
    }
  }

  @keyframes noodle-wiggle {
    from {
      transform: translateX(-1px);
    }
    to {
      transform: translateX(2px);
    }
  }

  @keyframes wing-flap {
    from {
      transform: rotate(-4deg);
    }
    to {
      transform: rotate(8deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spaghetti {
      animation: spaghetti-peek 2.5s ease-out forwards;
    }

    .noodles,
    .wing {
      animation: none;
    }
  }

  @keyframes spaghetti-peek {
    0% {
      opacity: 0;
      transform: translate3d(40vw, 24px, 0) scale(0.96);
    }
    15%,
    85% {
      opacity: 1;
      transform: translate3d(40vw, 0, 0) scale(0.96);
    }
    100% {
      opacity: 0;
      transform: translate3d(40vw, -12px, 0) scale(0.96);
    }
  }
</style>
