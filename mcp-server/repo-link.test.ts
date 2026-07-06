import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverRepoLink } from './repo-link';

const LINK = JSON.stringify({ projectId: 'proj-1', projectName: 'One' });
const FOREIGN_LINK = JSON.stringify({ projectId: 'proj-other', projectName: 'Other' });

describe('discoverRepoLink', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'unspa-link-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the link in cwd itself', () => {
    writeFileSync(join(root, '.unspa.json'), LINK);
    const lookup = discoverRepoLink(root);
    expect(lookup.link?.projectId).toBe('proj-1');
    expect(lookup.path).toBe(join(root, '.unspa.json'));
    expect(lookup.repoBoundary).toBeNull();
  });

  it('walks up to the repo root within the same git repo', () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.unspa.json'), LINK);
    const sub = join(root, 'packages', 'api');
    mkdirSync(sub, { recursive: true });
    const lookup = discoverRepoLink(sub);
    expect(lookup.link?.projectId).toBe('proj-1');
    expect(lookup.repoBoundary).toBeNull();
  });

  it('stops at the git boundary instead of adopting a parent checkout link', () => {
    // Layout: root/.unspa.json (foreign) + root/inner/.git (unlinked repo).
    // Binding inner to root's project is the "wrong sibling repo" failure;
    // the walk must stop at inner and report the boundary.
    writeFileSync(join(root, '.unspa.json'), FOREIGN_LINK);
    const inner = join(root, 'inner');
    mkdirSync(join(inner, 'src'), { recursive: true });
    mkdirSync(join(inner, '.git'));
    const lookup = discoverRepoLink(join(inner, 'src'));
    expect(lookup.link).toBeNull();
    expect(lookup.path).toBeNull();
    expect(lookup.repoBoundary).toBe(inner);
  });

  it('treats a .git FILE (worktree/submodule) as a boundary too', () => {
    writeFileSync(join(root, '.unspa.json'), FOREIGN_LINK);
    const worktree = join(root, 'wt');
    mkdirSync(worktree);
    writeFileSync(join(worktree, '.git'), 'gitdir: ../.git/worktrees/wt\n');
    const lookup = discoverRepoLink(worktree);
    expect(lookup.link).toBeNull();
    expect(lookup.repoBoundary).toBe(worktree);
  });

  it('still walks past plain directories when no git repo is involved', () => {
    writeFileSync(join(root, '.unspa.json'), LINK);
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const lookup = discoverRepoLink(nested);
    expect(lookup.link?.projectId).toBe('proj-1');
    expect(lookup.repoBoundary).toBeNull();
  });

  it('a repo root holding both .git and .unspa.json resolves to its own link', () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.unspa.json'), LINK);
    const lookup = discoverRepoLink(root);
    expect(lookup.link?.projectId).toBe('proj-1');
    expect(lookup.repoBoundary).toBeNull();
  });

  it('explicit path override bypasses boundary discovery entirely', () => {
    writeFileSync(join(root, '.unspa.json'), LINK);
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(join(elsewhere, '.git'), { recursive: true });
    const lookup = discoverRepoLink(elsewhere, join(root, '.unspa.json'));
    expect(lookup.link?.projectId).toBe('proj-1');
    expect(lookup.repoBoundary).toBeNull();
  });
});
