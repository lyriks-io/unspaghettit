import { loadSearchIndexUseCase } from '$features/global-search/application/use-cases/LoadSearchIndex';
import {
  SEARCH_GROUP_ORDER,
  type SearchDoc,
  type SearchEntityKind
} from '$features/global-search/domain/SearchDoc';
import { rankDocs } from '$features/global-search/domain/searchScoring';
import type { SearchHost } from '$features/global-search/presentation/ports/SearchHostPorts';
import { defaultSearchHost } from '$features/global-search/infrastructure/adapters/defaultSearchHost';

export type SearchResultGroup = {
  readonly kind: SearchEntityKind;
  readonly docs: readonly SearchDoc[];
};

/** Wait this long after a model change before rebuilding the open index. */
const REBUILD_DEBOUNCE_MS = 400;
/** Max results surfaced at once — keeps the panel scannable and ranking cheap. */
const RESULT_LIMIT = 40;

/**
 * Drives the header global search: a single, lazily-built index over the whole
 * model, ranked live as the user types. Depends only on the {@link SearchHost}
 * port (dependency inversion); the composition root at the bottom wires the
 * default adapter, exactly like `builderModeStore`.
 *
 * Index lifecycle: built on first open, cached thereafter. A model change
 * (sync event) rebuilds in the background while the panel is open, or marks the
 * index stale to be rebuilt on the next open — so we never re-read the whole
 * hub on every keystroke.
 */
class GlobalSearchStore {
  constructor(private readonly host: SearchHost) {}

  open = $state(false);
  query = $state('');
  loading = $state(false);
  error = $state<string | null>(null);
  /** Index of the keyboard-highlighted result within `results`. */
  activeIndex = $state(0);

  private indexDocs = $state<readonly SearchDoc[]>([]);
  // Non-reactive bookkeeping (only read inside methods, never in templates).
  private built = false;
  private stale = false;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  private ranked = $derived(rankDocs(this.indexDocs, this.query, RESULT_LIMIT));
  hasQuery = $derived(this.query.trim().length > 0);

  /** Results bucketed by kind, in the canonical group order (score order kept
   *  within each bucket). This is the visual layout of the panel. */
  grouped = $derived.by<readonly SearchResultGroup[]>(() => {
    const buckets = new Map<SearchEntityKind, SearchDoc[]>();
    for (const { doc } of this.ranked) {
      const list = buckets.get(doc.kind);
      if (list) list.push(doc);
      else buckets.set(doc.kind, [doc]);
    }
    return SEARCH_GROUP_ORDER.filter((kind) => buckets.has(kind)).map((kind) => ({
      kind,
      docs: buckets.get(kind) as SearchDoc[]
    }));
  });

  /** Flat list in *visual* (grouped) order — what keyboard nav walks, so the
   *  highlight moves straight down the rendered panel. */
  results = $derived<readonly SearchDoc[]>(this.grouped.flatMap((group) => group.docs));
  resultCount = $derived(this.results.length);

  activeDoc = $derived<SearchDoc | null>(this.results[this.activeIndex] ?? null);

  /** Subscribe to model changes once. Idempotent across re-mounts. */
  init(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.host.sync.subscribe(() => this.onModelChanged());
  }

  private onModelChanged(): void {
    if (!this.built) return; // nothing indexed yet → next open builds fresh
    if (this.open) this.scheduleRebuild();
    else this.stale = true;
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuild();
    }, REBUILD_DEBOUNCE_MS);
  }

  /** Build the index if it has never been built or is stale; otherwise no-op. */
  async ensureIndex(): Promise<void> {
    if (this.built && !this.stale) return;
    await this.rebuild();
  }

  /**
   * (Re)load the index. Primary path is one fetch of the server-built index;
   * the heavy walk happens once server-side and is cached to a file. If that
   * endpoint ever fails we fall back to building the index in-browser from the
   * repositories — slower, but search keeps working.
   */
  async rebuild(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.indexDocs = await this.host.search.load();
      this.built = true;
      this.stale = false;
    } catch (e) {
      try {
        const container = await this.host.data.getContainer();
        const load = loadSearchIndexUseCase({
          features: container.repository,
          projects: container.projectRepository,
          domains: container.domainRepository
        });
        this.indexDocs = await load();
        this.built = true;
        this.stale = false;
      } catch {
        // Surface the primary failure — it's the actionable one.
        this.error = (e as Error).message;
      }
    } finally {
      this.loading = false;
    }
  }

  openPanel(): void {
    this.open = true;
    void this.ensureIndex();
  }

  close(): void {
    this.open = false;
    this.activeIndex = 0;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  setQuery(query: string): void {
    this.query = query;
    this.activeIndex = 0;
    if (query.trim().length > 0 && !this.open) this.openPanel();
  }

  clear(): void {
    this.query = '';
    this.activeIndex = 0;
  }

  /** Move the highlight, wrapping around the result list. */
  move(delta: number): void {
    const count = this.results.length;
    if (count === 0) return;
    this.activeIndex = (this.activeIndex + delta + count) % count;
  }

  setActive(index: number): void {
    this.activeIndex = index;
  }
}

export const globalSearchStore = new GlobalSearchStore(defaultSearchHost);
