import { readFileSync } from 'node:fs';
import { asProjectId } from '../../src/features/projects/domain/value-objects/ids';
import { trackTokens } from '../metrics';
import { text, type ToolDeps } from './_shared';
import { indexStats } from './behavioralIndex';

/**
 * Surface the host-repo binding to the LLM so it can scope queries to the
 * right project without manually choosing one. The link itself is set by the
 * developer via `unspa link`; this tool just lets the model discover it.
 *
 * Returns the project plus its `features[]` list so the model can pick the
 * right feature for the task at hand based on context (file paths being
 * edited, action name in the prompt, ...) without a separate `list_features`
 * round-trip. Always present (returns `linked: false` when the repo isn't
 * bound) so the LLM can call this once at session start without conditional
 * logic.
 */
export const registerRepoContextTool = ({
  server,
  projectRepo,
  repo,
  repoContext
}: ToolDeps): void => {
  server.registerTool(
    'get_repo_context',
    {
      description:
        'Returns whether this repo is bound to one Unspaghettit project via .unspa.json. Call once at session start; if linked, the project owns one or more features and you scope all subsequent calls to that project. The response includes the project\'s `features[]` so you can pick the right featureId for the task without a separate list_features call (use file paths, action name, and the user prompt to choose). Also returns behavioralIndex stats so you know whether the index is fresh or needs a pass.',
      inputSchema: {}
    },
    async () => {
      if (!repoContext) {
        return text(
          trackTokens('get_repo_context', { linked: false, cwd: process.cwd(), linkPath: null })
        );
      }
      const linked = repoContext.link !== null;
      let behavioralIndex: ReturnType<typeof indexStats> | null = null;
      if (linked && repoContext.linkPath) {
        try {
          const raw = JSON.parse(readFileSync(repoContext.linkPath, 'utf8'));
          behavioralIndex = indexStats(raw.index ?? {});
        } catch {
          // Unreadable link. Surface stats as null rather than crashing.
        }
      }

      let features: readonly { readonly id: string; readonly name: string }[] = [];
      const linkedProjectId = repoContext.link?.projectId ?? null;
      if (linkedProjectId) {
        try {
          const project = await projectRepo.get(asProjectId(linkedProjectId));
          if (project) {
            const allFeatures = await repo.list();
            const memberIds = new Set(project.featureIds.map((id) => String(id)));
            features = allFeatures
              .filter((summary) => memberIds.has(String(summary.id)))
              .map((summary) => ({ id: String(summary.id), name: summary.name }));
          }
        } catch {
          // Project repo unavailable or stale link id — surface empty features[] rather than crash.
        }
      }

      // When the walk stopped at a git boundary without a link, say so
      // explicitly: the alternative (binding to whatever .unspa.json sits
      // above or beside this repo) is how sessions end up scoped to the
      // wrong sibling project.
      const repoBoundary = repoContext.repoBoundary ?? null;
      const hint =
        !linked && repoBoundary
          ? `No .unspa.json between ${repoContext.cwd} and the repository root ${repoBoundary}. ` +
            `This repo is not linked to a project; run \`unspa link\` at the repo root. ` +
            `Discovery stops at the repo boundary on purpose so a parent or sibling checkout's link is never picked up by accident.`
          : null;

      const payload = {
        cwd: repoContext.cwd,
        linkPath: repoContext.linkPath,
        linked,
        linkedProjectId,
        linkedProjectName: repoContext.link?.projectName ?? null,
        ...(hint ? { hint } : {}),
        features,
        behavioralIndex
      };
      return text(trackTokens('get_repo_context', payload));
    }
  );
};
