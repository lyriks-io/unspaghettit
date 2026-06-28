<script lang="ts">
  import { loadMermaid } from '$features/diagram-projection/infrastructure/render/mermaidLoader';

  type Props = { code: string };
  let { code }: Props = $props();

  let svg = $state('');
  let status = $state<'idle' | 'rendering' | 'ready' | 'error'>('idle');

  let viewport = $state<HTMLDivElement | null>(null);
  // Pan/zoom transform applied to the diagram. Scroll zooms toward the cursor,
  // drag pans — so even a very tall/wide chart stays navigable in a fixed frame.
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  // Natural (unscaled) diagram size, read from the rendered SVG's viewBox.
  let natW = 0;
  let natH = 0;

  // Monotonic token so a slow render can't overwrite a newer one.
  let renderSeq = 0;

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4;
  const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const render = async (source: string): Promise<void> => {
    if (!source) {
      svg = '';
      status = 'idle';
      return;
    }
    const seq = ++renderSeq;
    status = 'rendering';
    try {
      const mermaid = await loadMermaid();
      const result = await mermaid.render(`mermaid-${seq}`, source);
      if (seq !== renderSeq) return; // superseded by a newer render
      svg = result.svg;
      status = 'ready';
    } catch {
      if (seq !== renderSeq) return;
      svg = '';
      status = 'error';
    }
  };

  // Scale the diagram to fit the frame and center it.
  const fit = (): void => {
    if (!viewport || !natW || !natH) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const next = clampScale(Math.min(vw / natW, vh / natH));
    scale = next;
    tx = (vw - natW * next) / 2;
    ty = (vh - natH * next) / 2;
  };

  // Zoom about a viewport point, keeping that point fixed under the cursor.
  const zoomAround = (factor: number, cx: number, cy: number): void => {
    const next = clampScale(scale * factor);
    if (next === scale) return;
    tx = cx - (cx - tx) * (next / scale);
    ty = cy - (cy - ty) * (next / scale);
    scale = next;
  };

  const zoomByButton = (factor: number): void => {
    if (!viewport) return;
    zoomAround(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };

  const onWheel = (event: WheelEvent): void => {
    if (!viewport) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top);
  };

  let panning = $state(false);
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  const onPointerDown = (event: PointerEvent): void => {
    panning = true;
    startX = event.clientX;
    startY = event.clientY;
    startTx = tx;
    startTy = ty;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!panning) return;
    tx = startTx + (event.clientX - startX);
    ty = startTy + (event.clientY - startY);
  };
  const endPan = (event: PointerEvent): void => {
    if (!panning) return;
    panning = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  // Re-render whenever the Mermaid source changes.
  $effect(() => {
    void render(code);
  });

  // Once a fresh SVG is in the DOM, read its natural size and fit it. Mermaid's
  // own `max-width:100%` clamp would fight our transform, so we size the SVG
  // explicitly from its viewBox and let the transform drive what's shown.
  $effect(() => {
    if (status !== 'ready' || !svg || !viewport) return;
    const el = viewport.querySelector('svg');
    if (!el) return;
    const box = el.viewBox?.baseVal;
    const rect = el.getBoundingClientRect();
    natW = box && box.width ? box.width : rect.width;
    natH = box && box.height ? box.height : rect.height;
    el.style.maxWidth = 'none';
    el.style.width = `${natW}px`;
    el.style.height = `${natH}px`;
    fit();
  });

  // Refit when the frame itself resizes (e.g. the sidebar collapses).
  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(viewport);
    return () => observer.disconnect();
  });
</script>

<div class="relative h-[60vh] w-full overflow-hidden bg-white">
  {#if status === 'error'}
    <div class="grid h-full place-items-center px-4 text-center text-sm text-slate-500">
      <div>
        <p class="font-medium text-slate-700">Couldn't draw this diagram.</p>
        <p class="mt-1">Use “Copy as Mermaid” to view the source elsewhere.</p>
      </div>
    </div>
  {:else}
    <div
      bind:this={viewport}
      role="application"
      aria-label="Diagram canvas. Scroll to zoom, drag to pan."
      class="h-full w-full touch-none select-none {panning ? 'cursor-grabbing' : 'cursor-grab'}"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endPan}
      onpointerleave={endPan}
    >
      {#if status === 'ready' && svg}
        <div
          class="mermaid-host absolute left-0 top-0 origin-top-left will-change-transform"
          style={`transform: translate(${tx}px, ${ty}px) scale(${scale});`}
        >
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html svg}
        </div>
      {:else}
        <div class="grid h-full place-items-center text-sm text-slate-400">Rendering…</div>
      {/if}
    </div>

    <!-- Bottom-right: Google-Maps-style zoom + fit control (matches the graph). -->
    <div
      class="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur"
    >
      <button
        type="button"
        aria-label="Zoom in"
        onclick={() => zoomByButton(1.25)}
        class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
      >
        +
      </button>
      <div class="h-px bg-slate-200"></div>
      <button
        type="button"
        aria-label="Zoom out"
        onclick={() => zoomByButton(0.8)}
        class="grid h-9 w-9 place-items-center text-lg font-semibold leading-none text-slate-700 transition hover:bg-slate-100"
      >
        −
      </button>
      <div class="h-px bg-slate-200"></div>
      <button
        type="button"
        aria-label="Fit diagram to view"
        onclick={fit}
        class="grid h-9 w-9 place-items-center text-slate-700 transition hover:bg-slate-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M4 9V5a1 1 0 0 1 1-1h4" />
          <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
          <path d="M4 15v4a1 1 0 0 0 1 1h4" />
          <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
        </svg>
      </button>
    </div>

    {#if status === 'ready'}
      <div
        class="absolute bottom-3 left-3 z-10 rounded-md bg-white/85 px-2 py-1 text-xs font-medium text-slate-500 backdrop-blur"
      >
        {Math.round(scale * 100)}%
      </div>
    {/if}
  {/if}
</div>

<style>
  .mermaid-host :global(svg) {
    display: block;
  }
</style>
