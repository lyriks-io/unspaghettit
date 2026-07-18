import { join } from 'node:path';
import { removeMarkdownBlock, upsertMarkdownBlock } from './markdown-block';

/**
 * Default context files to seed with the unspa block. Both are widely
 * respected today: `CLAUDE.md` by Claude Code, `AGENTS.md` by Codex / Cursor /
 * Windsurf / Gemini / Kiro and the emerging cross-tool standard (Claude reads
 * it as a fallback). Writing both means most AI clients pick up the
 * Unspaghettit instructions automatically with no per-tool wiring and the
 * user doesn't need to re-init if they later switch hosts.
 */
export const DEFAULT_CONTEXT_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * The body inserted between the `<!-- >>> unspa -->` markers. Designed to
 * give an AI assistant enough context to *use the MCP tools instead of
 * regenerating JSON in its prompt* and to record implementations in the
 * `.unspa.json` behavioral index. Kept dense to spare the host file's
 * token budget.
 */
const UNSPA_CONTEXT_BODY = `## Unspaghettit (auto-managed by \`unspa\` CLI)

This repo models its software as executable behavior with [Unspaghettit](https://unspaghettit.dev).
The model lives in your Unspaghettit snapshots folder: the shared hub
(\`~/.unspa-hub/unspa\`) by default, or this repo's \`unspa/\` folder for a
per-repo install (\`unspa init --local\`). Open the dashboard with
\`unspa dashboard\` (it prints its URL on startup; default port 43171) to see
surfaces, actions, simulator, maturity, and implementation coverage.

When using the CLI hub, treat \`~/.unspa-hub/unspa\` as the source of truth.
Dashboard localhost ports are only views over that folder and may change per
run. Do not inspect Docker containers, unrelated app integrations, or another
product's embedded Unspa data unless the user explicitly asks for that source.

### Editing the model. Use the MCP, don't re-emit JSON

The Unspaghettit **MCP server** is registered for this repo. Prefer its tools over
hand-writing or regenerating the JSON. They validate, preserve cross-references,
and produce smaller diffs. Workflow:

1. Discover with \`list_features\` then \`list_actions\`. \`get_feature\`
   returns an INDEX (ids + names + counts) by default; pass \`verbose:true\` only
   when you genuinely need the full blob (it's ~10× larger).
2. Drill into one entity at a time with \`get_action\`.
3. For multi-step edits use \`apply_batch\`. N ops in one atomic load + validate +
   save. Add ops can capture their new id under \`op.ref\` so later ops in the same
   batch reference it via \`*Ref\` (e.g. \`surfaceRef:"shop"\`).
4. Validate before committing: \`dry_run_simulate\` (pure, no persist),
   \`run_all_scenarios\`, \`model_check\` (bounded state-space exploration:
   invariant counterexamples with the action path, dead actions, deadlocks,
   reachability, reachability-goal results), and \`score_feature\` (maturity).
   Gate the whole feature/project in one call with \`verify\`, the in-chat form
   of the \`unspa check\` CI command. \`get_drift\` finds code audited against an
   older spec than the one now on disk.
5. Run \`find_state_references\` before renaming or removing a state path.

### \`.unspa.json\`. Record implementations in the index

When you implement an entity in code, add or update its entry in the
\`.unspa.json\` behavioral index. **Do not** annotate source code. The index
is the only mapping between code and spec. Keys follow
\`<entityType>:<id-name-or-path>\`:

- \`action:<id>\` (id = 8-char hex minted by the spec)
- \`surface:<id>\`
- \`rule:<id>\`
- \`invariant:<id>\`
- \`transition:<id>\`
- \`surface_rule:<id>\` / \`surface_invariant:<id>\`
- \`entity:<id>\`
- \`event:<event-name>\` (the event's string identifier, not an id)
- \`state:<state.path>\` (e.g. \`cart.itemCount\`)

**Never synthesize ids from slugs.** Read the real id with
\`get_behavioral_index\` or \`get_feature(verbose:true)\`. Slug-shaped keys
(e.g. \`action:add-to-cart\`) are rejected by \`sync_from_index\` and surfaced
in its \`orphans\` block with a fix hint.

Each entry stores \`{ file, line, signature, ... }\`. After editing the index,
call \`sync_from_index\` so the MCP refreshes the coverage report.

To PROVE coverage (not just claim it), run the feature's scenarios against the
real code: \`unspa scenarios export <featureId>\` → \`vitest run --reporter=json\`
→ \`unspa coverage ingest <report>\`. That stamps \`verifiedAt\` on actions whose
scenarios all passed; \`verify\` / \`unspa check --min-verified\` gate on the
proven share.

### Adopting an existing codebase (code → spec)

To model code that already exists, use the evidence-gated adoption flow
instead of hand-writing the index: attach each source file you analyzed with
\`attach_source_path\` (repo-relative path; the server reads the file itself,
so the content is never re-emitted), model what the code actually does,
\`record_element_spans\` (batch) for every element, then
\`finalize_analysis\` (blocked until everything is traced). After that,
\`seed_index_from_analysis\` turns every code span into a \`.unspa.json\` entry
automatically (model, provenance, and coverage from one pass), then
\`sync_from_index\`. \`unspa adopt\` prints this flow; the \`unspa-adopt\` skill
runs it.

For a defensible extraction (optional): rank sources with \`authority\` /
\`artifact\` on attach (or \`classify_source\`), record two sources that disagree
with \`flag_conflict\` (the higher-authority claim is the suggested winner)
instead of silently modeling one, and account for every source behavior with
\`stage_candidate\` + \`dispose_candidate\`; \`get_source_coverage\` then reports the
share of a source that reached the model and what is still unresolved.

### Don't

- Don't regenerate an entire feature JSON from scratch; mutate via the MCP.
- Don't add \`@unspa:\` / \`@lyriks:\` annotations to source code; the index is the only mapping.
- Don't rename a state path without \`find_state_references\` first.`;

export type ContextWriteResult = {
  readonly path: string;
  readonly changed: boolean;
  readonly created: boolean;
};

export const writeUnspaContextBlocks = (
  cwd: string,
  files: readonly string[] = DEFAULT_CONTEXT_FILES
): readonly ContextWriteResult[] =>
  files.map((name) => {
    const path = join(cwd, name);
    const { changed, created } = upsertMarkdownBlock(path, UNSPA_CONTEXT_BODY);
    return { path, changed, created };
  });

export const removeUnspaContextBlocks = (
  cwd: string,
  files: readonly string[] = DEFAULT_CONTEXT_FILES
): readonly { path: string; changed: boolean }[] =>
  files.map((name) => {
    const path = join(cwd, name);
    return { path, ...removeMarkdownBlock(path) };
  });
