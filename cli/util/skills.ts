import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Source directory inside the Unspaghettit CLI install that holds the bundled
 * skills (one folder per skill, each with a `SKILL.md` at minimum).
 */
const SOURCE_DIR = resolve(__dirname, '..', 'skills');

/**
 * Project-scoped destination for Claude Code skills. The folder name is
 * Claude-specific, so `init` only installs these when a selected client
 * declares `installsSkills: true` (currently Claude only). If another client
 * ships first-class skills support later, flip the flag on its adapter.
 */
const DEST_SUBDIR = join('.claude', 'skills');

const listSkillNames = (): readonly string[] => {
  if (!existsSync(SOURCE_DIR)) return [];
  return readdirSync(SOURCE_DIR).filter((name) => {
    const p = join(SOURCE_DIR, name);
    return statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md'));
  });
};

const copyDir = (src: string, dest: string): void => {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dest, name);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
};

export type SkillInstallResult = {
  readonly name: string;
  readonly path: string;
  readonly installed: boolean;
};

/**
 * Copy every bundled skill into `<cwd>/.claude/skills/<name>/`. Always
 * overwrites. The skills ship with the CLI, so the latest version is
 * authoritative. Returns one entry per skill the CLI shipped.
 */
export const installUnspaSkills = (cwd: string): readonly SkillInstallResult[] => {
  const names = listSkillNames();
  const root = join(cwd, DEST_SUBDIR);
  return names.map((name) => {
    const src = join(SOURCE_DIR, name);
    const dest = join(root, name);
    copyDir(src, dest);
    return { name, path: dest, installed: true };
  });
};

export type SkillRemovalResult = {
  readonly name: string;
  readonly path: string;
  readonly removed: boolean;
};

/**
 * Remove every bundled skill from `<cwd>/.claude/skills/`. Only deletes
 * folders that match a skill the CLI shipped. Never wipes user-authored
 * skills sitting alongside.
 */
export const removeUnspaSkills = (cwd: string): readonly SkillRemovalResult[] => {
  const names = listSkillNames();
  const root = join(cwd, DEST_SUBDIR);
  return names.map((name) => {
    const dest = join(root, name);
    if (!existsSync(dest)) return { name, path: dest, removed: false };
    rmSync(dest, { recursive: true, force: true });
    return { name, path: dest, removed: true };
  });
};
