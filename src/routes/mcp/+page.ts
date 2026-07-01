import { redirect } from '@sveltejs/kit';

/**
 * The MCP playground is project-scoped now (/projects/[id]/mcp): the page
 * needs a selected project to be meaningful, so the old global route sends
 * visitors to the project list to pick one. Kept as a redirect rather than
 * deleted so bookmarks and older docs don't 404.
 */
export const load = () => {
  throw redirect(307, '/projects');
};
