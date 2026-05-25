import { authStore } from './authStore.svelte';
import { promptDialog } from '$shared/presentation/dialogs/dialogStore.svelte';

/**
 * Wrapper around `fetch` that injects the dashboard auth token (when
 * one is stored) and, on a 401, opens a prompt to capture / update it
 * and retries the request once. All HTTP repositories funnel through
 * this so a missing or stale token surfaces as a single in-app dialog
 * instead of cascading 401s scattered across feature/project/status
 * call sites.
 *
 * Behavior summary:
 *   - No token in store → call goes out unauthenticated. If the server
 *     doesn't require auth (default install), 200. If it does, 401
 *     → prompt → retry.
 *   - Token in store → header attached. On 401, assume the token is
 *     stale (rotated server-side), prompt for a fresh one, retry.
 *   - User cancels the prompt → the original 401 surfaces and the
 *     caller decides what to do. Most repos already render an error;
 *     the user can re-attempt by clicking again after setting a token
 *     via the dashboard somehow (e.g. closing/reopening the tab).
 *
 * Single retry max — no infinite loop if the user keeps cancelling.
 */
const buildHeaders = (init: RequestInit | undefined, token: string): HeadersInit => {
  const headers = new Headers(init?.headers);
  if (token.length > 0) headers.set('Authorization', `Bearer ${token}`);
  return headers;
};

let promptInFlight: Promise<string | null> | null = null;

const requestTokenOnce = async (reason: string): Promise<string | null> => {
  // Multiple concurrent 401s would otherwise stack prompts. Share the
  // single in-flight prompt across all callers so the user sees one
  // dialog and every queued request gets the same answer.
  if (promptInFlight) return promptInFlight;
  promptInFlight = promptDialog({
    title: 'Dashboard access token required',
    message: `${reason}\n\nAsk the admin who started this dashboard for the value of UNSPA_AUTH_TOKEN.`,
    inputLabel: 'Access token',
    password: true,
    confirmLabel: 'Sign in',
    tone: 'info'
  });
  try {
    return await promptInFlight;
  } finally {
    promptInFlight = null;
  }
};

export const apiFetch = async (
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> => {
  const send = (token: string) =>
    fetch(input, { ...init, headers: buildHeaders(init, token) });

  const initialToken = authStore.token;
  const first = await send(initialToken);
  if (first.status !== 401) return first;

  // 401: capture (or update) the token and retry once. The store's
  // setter persists to localStorage so subsequent requests in this
  // session and future reloads don't re-prompt.
  const next = await requestTokenOnce(
    initialToken.length === 0
      ? 'This dashboard is gated by a shared access token.'
      : 'The stored access token was rejected. The admin may have rotated it.'
  );
  if (next === null || next.length === 0) return first;
  authStore.setToken(next);
  return send(next);
};
