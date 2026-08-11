import { redirect } from '@sveltejs/kit';
import { withBase } from '$shared/routing/appBase';

// The /features route is currently hidden from the UI. The +page.svelte is
// preserved on disk so we can restore it without rebuilding, but visiting the
// URL bounces back to /projects. Delete this file (or comment out its body)
// to re-enable the page.
export const load = () => {
  throw redirect(307, withBase('/projects'));
};
