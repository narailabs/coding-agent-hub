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
    defaultModel: 'claude-sonnet-4-6',
    authEnvVar: 'ANTHROPIC_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'claude',
  },
  {
    name: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    enabled: true,
    defaultModel: 'gemini-3.1-pro-preview',
    authEnvVar: 'GEMINI_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'gemini',
  },
  {
    name: 'codex',
    displayName: 'Codex CLI',
    command: 'codex',
    enabled: true,
    defaultModel: 'gpt-5.4',
    authEnvVar: 'OPENAI_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'codex',
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    enabled: true,
    defaultModel: 'claude-sonnet-4-6',
    authEnvVar: 'ANTHROPIC_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'opencode',
  },
  {
    name: 'copilot',
    displayName: 'Copilot CLI',
    command: 'copilot',
    enabled: true,
    defaultModel: 'claude-sonnet-4-6',
    authEnvVar: 'GITHUB_TOKEN',
    timeoutMs: 120_000,
    argBuilder: 'copilot',
  },
  {
    name: 'cursor',
    displayName: 'Cursor CLI',
    command: 'cursor-agent',
    enabled: true,
    defaultModel: 'claude-sonnet-4-6',
    authEnvVar: 'CURSOR_API_KEY',
    timeoutMs: 120_000,
    argBuilder: 'cursor',
  },
];

/**
 * Get a default backend config by name.
 */
export function getDefaultBackend(name: string): BackendConfig | undefined {
  return DEFAULT_BACKENDS.find((b) => b.name === name);
}
