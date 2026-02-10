/**
 * Coding Agent Hub — Backend Definitions
 *
 * Default configurations for supported coding agent CLIs.
 */

import type { BackendConfig } from './types.js';

/**
 * Default backend configurations for all supported coding agent CLIs.
 */
export const DEFAULT_BACKENDS: BackendConfig[] = [
  {
    name: 'claude',
    displayName: 'Claude Code',
    command: 'claude',
    enabled: true,
    defaultModel: 'claude-sonnet-4-5',
    authEnvVar: 'ANTHROPIC_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'claude',
  },
  {
    name: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    enabled: true,
    defaultModel: 'gemini-2.5-pro',
    authEnvVar: 'GEMINI_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'gemini',
  },
  {
    name: 'codex',
    displayName: 'Codex CLI',
    command: 'codex',
    enabled: true,
    defaultModel: 'codex-1',
    authEnvVar: 'OPENAI_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'codex',
  },
];

/**
 * Get a default backend config by name.
 */
export function getDefaultBackend(name: string): BackendConfig | undefined {
  return DEFAULT_BACKENDS.find((b) => b.name === name);
}
