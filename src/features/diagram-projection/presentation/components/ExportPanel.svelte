<script lang="ts">
  import type { DiagramFormat, DiagramSpec } from '$features/diagram-projection/domain/DiagramSpec';
  import type { DiagramExporter } from '$features/diagram-projection/domain/ports/DiagramExporter';
  import {
    dotTextExporter,
    imageExporter,
    mermaidTextExporter
  } from '$features/diagram-projection/application/projectionComposition';
  import { projectionEvents } from '$features/diagram-projection/application/projectionEvents';

  type Props = {
    spec: DiagramSpec | null;
    format: DiagramFormat;
    loaded: boolean;
    onClose: () => void;
  };
  let { spec, format, loaded, onClose }: Props = $props();

  type ExportStatus = 'idle' | 'copied' | 'downloading' | 'downloaded' | 'error';
  let status = $state<ExportStatus>('idle');
  let note = $state('');

  // The free graph has no Mermaid serialization (spec rule); DOT/SVG still work.
  const canMermaid = $derived(loaded && spec !== null && format !== 'graph');
  const canExport = $derived(loaded && spec !== null);

  const slug = (title: string): string =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';

  const flash = (message: string): void => {
    note = message;
  };

  const copyText = async (exporter: DiagramExporter, label: string): Promise<void> => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(exporter.export(spec));
      status = 'copied';
      flash(`Copied as ${label}.`);
      projectionEvents.emit({ type: 'projection.copied', format: exporter.id });
    } catch {
      status = 'error';
      flash('Copy failed.');
    }
  };

  const triggerDownload = (filename: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const svgToPng = (svg: string): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width || 800;
        canvas.height = image.height || 600;
        const ctx = canvas.getContext('2d');
        URL.revokeObjectURL(url);
        if (!ctx) {
          reject(new Error('No 2D canvas context'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('SVG image load failed'));
      };
      image.src = url;
    });

  const downloadImage = async (kind: 'svg' | 'png'): Promise<void> => {
    if (!spec) return;
    status = 'downloading';
    try {
      const svg = imageExporter.export(spec);
      const blob = kind === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      triggerDownload(`${slug(spec.title)}.${kind}`, blob);
      status = 'downloaded';
      flash(`Downloaded ${kind.toUpperCase()}.`);
      projectionEvents.emit({ type: 'projection.exported', imageFormat: kind });
    } catch {
      status = 'error';
      flash('Download failed.');
    }
  };

  const close = (): void => {
    status = 'idle';
    note = '';
    onClose();
  };
</script>

<div class="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
  <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
    <div>
      <p class="text-xs font-semibold uppercase tracking-wide text-cyan-700">Export</p>
      <h3 class="text-sm font-semibold text-slate-900">Get this diagram out</h3>
    </div>
    <button
      type="button"
      onclick={close}
      class="inline-flex h-8 items-center rounded-md border border-slate-200 px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
    >
      Close
    </button>
  </div>

  <div class="flex flex-wrap items-center gap-2 px-4 py-4">
    <button
      type="button"
      disabled={!canMermaid}
      onclick={() => copyText(mermaidTextExporter, 'Mermaid')}
      class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Copy as Mermaid
    </button>
    <button
      type="button"
      disabled={!canExport}
      onclick={() => copyText(dotTextExporter, 'DOT')}
      class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Copy as DOT
    </button>
    <button
      type="button"
      disabled={!canExport || status === 'downloading'}
      onclick={() => downloadImage('svg')}
      class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Download SVG
    </button>
    <button
      type="button"
      disabled={!canExport || status === 'downloading'}
      onclick={() => downloadImage('png')}
      class="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Download PNG
    </button>

    <span class="ml-auto text-xs text-slate-500" aria-live="polite">
      {#if note}
        {note}
      {:else if !canMermaid && format === 'graph'}
        The free graph exports to DOT and image only.
      {/if}
    </span>
  </div>
</div>
