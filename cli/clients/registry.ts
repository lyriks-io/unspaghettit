import { claudeCodeClient } from './claude-code';
import { claudeDesktopClient } from './claude-desktop';
import { codexClient } from './codex';
import { cursorClient } from './cursor';
import { geminiClient } from './gemini';
import { kiroClient } from './kiro';
import { windsurfClient } from './windsurf';
import type { ClientAdapter } from './types';

export { SERVER_NAME } from './constants';

/** Order matters. Used as the default selection order in interactive init. */
export const ALL_CLIENTS: readonly ClientAdapter[] = [
  claudeCodeClient,
  claudeDesktopClient,
  cursorClient,
  windsurfClient,
  geminiClient,
  kiroClient,
  codexClient
];

export const clientById = (id: string): ClientAdapter | null =>
  ALL_CLIENTS.find((c) => c.id === id) ?? null;

export type { ClientAdapter, ApplyResult, McpServerEntry } from './types';
