import pc from 'picocolors';
import { log } from '../util/log';
import { readRepoLink, type RepoLink } from '../util/link';

/**
 * `unspa adopt`: the code → spec on-ramp. The heavy lifting is done by the
 * AI agent through the MCP (it reads the code; the MCP never does), so this
 * command's job is to check the two prerequisites and hand the user a
 * paste-ready prompt that drives the whole adoption workflow:
 * attach code sources → model → trace spans → finalize → seed the
 * behavioral index → sync coverage → verify.
 */

export type AdoptOptions = {
  readonly cwd?: string;
  /** Print only the agent prompt (no status banner), for piping. */
  readonly promptOnly?: boolean;
};

export const buildAdoptPrompt = (link: RepoLink | null): string => {
  const linkStep = link
    ? `This repo is linked to project "${link.projectName ?? link.projectId}" (${link.projectId}); scope everything to it.`
    : 'If get_repo_context says the repo is not linked, create a project (create_project), then run `unspa link --project-id <id>` in the terminal before seeding.';
  return `Adopt this codebase into Unspaghettit (code -> spec), using the Unspaghettit MCP tools.

1. Call get_repo_context once. ${linkStep}
2. Explore the codebase and split its behavior into features: one coherent slice each (a flow, a screen, a capability), sized 1-15 surfaces. Propose the split before modeling.
3. For each feature, work surface by surface:
   a. Read the source files that implement it.
   b. attach_source_file with kind:"code", fileName = the file's repo-relative path, content = the exact file content you read.
   c. Model what the code ACTUALLY does (not what it should do) via apply_batch: surfaces, actions, parameters, state, rules, invariants, transitions, events, plus scenarios for the paths the code clearly handles.
   d. record_element_span for EVERY element, with offsets into the attached file content pointing at the exact code it was extracted from.
   e. finalize_analysis - it refuses until every element is traced, so nothing gets invented without a source.
   f. seed_index_from_analysis - every code span becomes a .unspa.json implementation entry - then sync_from_index to push coverage to the dashboard.
4. Prove it: run verify and score_feature; close the gaps it reports until the verdict is clean.

The result must be a model where every element traces to real code, implementation coverage is non-zero from day one, and drift detection is armed.`;
};

export const runAdoptCommand = async (options: AdoptOptions = {}): Promise<number> => {
  const cwd = options.cwd ?? process.cwd();
  const link = readRepoLink(cwd);
  const prompt = buildAdoptPrompt(link);

  if (options.promptOnly === true) {
    process.stdout.write(`${prompt}\n`);
    return 0;
  }

  log.info(`Adopt an existing codebase into Unspaghettit (${pc.cyan('code -> spec')}).`);
  log.dim('Your AI agent does the reading and modeling through the MCP; one analysis pass');
  log.dim('yields the model, its provenance, and the spec-to-code mapping in .unspa.json.');
  log.blank();

  if (link) {
    log.ok(`Repo linked to project ${pc.cyan(link.projectName ?? link.projectId)} (${link.projectId}).`);
  } else {
    log.warn('No .unspa.json link in this folder yet.');
    log.dim('The prompt below tells the agent to create a project and link it (`unspa link`).');
  }
  log.blank();
  log.info('Paste this into your AI agent:');
  log.blank();
  process.stdout.write(`${prompt}\n`);
  log.blank();
  log.dim('Claude Code users: the bundled /unspa-adopt skill runs this workflow directly.');
  log.dim('Re-print without the banner: unspa adopt --prompt-only');
  return 0;
};
