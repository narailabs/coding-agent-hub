/**
 * Coding Agent Hub — Adapter Registry
 */

import type { BackendAdapter } from './types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { CopilotAdapter } from './copilot-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { GenericAdapter } from './generic-adapter.js';

export type { BackendAdapter } from './types.js';

const adapters: Record<string, BackendAdapter> = {
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter(),
  codex: new CodexAdapter(),
  opencode: new OpenCodeAdapter(),
  copilot: new CopilotAdapter(),
  cursor: new CursorAdapter(),
  generic: new GenericAdapter(),
};

/**
 * Get the adapter for a given backend arg builder type.
 */
export function getAdapter(argBuilder: string): BackendAdapter {
  return adapters[argBuilder] ?? adapters.generic;
}
