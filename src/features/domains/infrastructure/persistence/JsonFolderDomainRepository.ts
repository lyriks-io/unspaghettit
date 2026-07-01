import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync
} from 'node:fs';
import { join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import type {
  DomainRepository,
  DomainSummary
} from '$features/domains/application/ports/DomainRepository';
import type { Domain } from '$features/domains/domain/entities/Domain';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import {
  exportDomainToJson,
  importDomainFromJson
} from '$features/domains/infrastructure/io/DomainJson';
import { assertSafeSegment } from '$shared/infrastructure/persistence/snapshotLayout';

const DOMAIN_SUFFIX = '.domain.json';

type LoadedDomain = { readonly slug: string; readonly domain: Domain };

const toSummary = (d: Domain): DomainSummary => ({
  id: d.id,
  name: d.name,
  description: d.description,
  projectCount: d.projectIds.length,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt
});

const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'domain';
};

export class JsonFolderDomainRepository implements DomainRepository {
  constructor(private readonly directory: string) {}

  async list(): Promise<readonly DomainSummary[]> {
    return this.readAll()
      .map((s) => s.domain)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .map(toSummary);
  }

  async get(id: DomainId): Promise<Domain | null> {
    const found = this.readAll().find((s) => s.domain.id === id);
    return found ? found.domain : null;
  }

  /**
   * Server-only bulk read: every full Domain in ONE directory pass. Not on the
   * {@link DomainRepository} port — used by derived artifacts (the
   * global-search index) so they avoid an O(N²) `get()`-per-id scan.
   */
  async listFull(): Promise<readonly Domain[]> {
    return this.readAll().map((s) => s.domain);
  }

  async save(domain: Domain): Promise<void> {
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true });
    const all = this.readAll();
    const previous = all.find((s) => s.domain.id === domain.id);
    const taken = all
      .filter((s) => s.domain.id !== domain.id)
      .map((s) => s.slug);
    const target = slugify(domain.name);
    const finalSlug = assertSafeSegment(
      taken.includes(target) ? `${target}-${domain.id.slice(0, 8)}` : target,
      'domain slug'
    );

    if (previous && previous.slug !== finalSlug) {
      const oldPath = join(this.directory, `${previous.slug}${DOMAIN_SUFFIX}`);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }

    const path = join(this.directory, `${finalSlug}${DOMAIN_SUFFIX}`);
    await writeFileAtomic(path, exportDomainToJson(domain), 'utf8');
  }

  async delete(id: DomainId): Promise<void> {
    const found = this.readAll().find((s) => s.domain.id === id);
    if (!found) return;
    const path = join(this.directory, `${found.slug}${DOMAIN_SUFFIX}`);
    if (existsSync(path)) unlinkSync(path);
  }

  private readAll(): readonly LoadedDomain[] {
    if (!existsSync(this.directory)) return [];
    const files = readdirSync(this.directory).filter((f) => f.endsWith(DOMAIN_SUFFIX));
    const out: LoadedDomain[] = [];
    for (const file of files) {
      const raw = readFileSync(join(this.directory, file), 'utf8');
      try {
        const domain = importDomainFromJson(raw);
        out.push({ slug: file.slice(0, -DOMAIN_SUFFIX.length), domain });
      } catch {
        // Malformed files skipped so one bad file can't kill the API.
      }
    }
    return out;
  }
}
