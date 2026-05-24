/**
 * MCP host integrations. Each client knows where its config file lives and
 * how to merge the unspa server entry without clobbering the user's other
 * server registrations.
 */
export type ConfigScope = 'project' | 'global';

export type ClientAdapter = {
  /** Stable id used in CLI flags (e.g. `--clients claude-code,cursor`). */
  readonly id: string;
  /** Human label printed in prompts and reports. */
  readonly label: string;
  /**
   * Which scopes the client supports. Most clients support both project-local
   * and global config; some (like Windsurf, Claude Desktop) only support one.
   */
  readonly scopes: readonly ConfigScope[];
  /** Free-form note shown when this client is selected (e.g. caveats). */
  readonly note?: string;
  /**
   * Whether this client reads bundled skills from `.claude/skills/`. Currently
   * Claude-only — the folder name is Claude-specific, and no other client has
   * shipped first-class support yet. `init` skips the skills step entirely
   * when no selected client wants them. Context files (CLAUDE.md / AGENTS.md)
   * are NOT scoped this way: `init` seeds both unconditionally, because the
   * managed block is non-destructive (HTML-comment markers) and AGENTS.md is
   * the cross-tool standard, so writing both avoids a re-init when the user
   * adds a different AI client later.
   */
  readonly installsSkills?: boolean;
  /**
   * Resolve the absolute config file path for a given scope. Returns null
   * when the scope is not supported. `cwd` is the project root for
   * `project` scope; `home` is os.homedir() for `global` scope.
   */
  resolvePath(scope: ConfigScope, params: { cwd: string; home: string }): string | null;
  /**
   * Best-effort signal that this AI client is actually installed on the
   * current machine — typically "does its config dir exist already". `init`
   * uses this to pre-select only the clients the user already uses, so the
   * common path doesn't silently create dotfolders (`.kiro/`, `.cursor/`,
   * `.gemini/`, ...) for tools the user has never touched. Returning `false`
   * doesn't hide the client; it just leaves it unchecked in the multiselect
   * so the user has to opt in explicitly. Adapters with no reliable on-disk
   * signal (Codex VS Code preview) can omit this; they default to
   * undetected.
   */
  detect?(params: { cwd: string; home: string }): boolean;
  /**
   * Apply the merge to the resolved file, returning whether a write happened.
   * The default implementation in `applyMcpServerEntry` covers JSON-based
   * configs; clients with non-JSON configs (TOML etc.) override this.
   */
  apply(
    scope: ConfigScope,
    params: { cwd: string; home: string; serverEntry: McpServerEntry }
  ): Promise<ApplyResult>;
};

export type McpServerEntry = {
  readonly type: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

export type ApplyResult = {
  readonly path: string;
  readonly changed: boolean;
  readonly skipped?: 'unsupported-scope' | 'unimplemented';
  readonly note?: string;
};
