/**
 * Coding Agent Hub — Shared Types
 */

export { DEFAULT_BACKENDS, getDefaultBackend } from './backends.js';
export type { SessionConfig, SessionInfo, SessionTurn } from './session-manager.js';

/**
 * Configuration for a backend (coding agent CLI).
 */
export interface BackendConfig {
  /** Unique backend identifier */
  name: string;
  /** Human-readable name */
  displayName: string;
  /** CLI command to invoke */
  command: string;
  /** Whether this backend is enabled */
  enabled: boolean;
  /** Default model for this backend */
  defaultModel: string;
  /** Environment variable containing the API key */
  authEnvVar?: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Arg builder strategy */
  argBuilder: 'claude' | 'gemini' | 'codex' | 'generic';
}

/**
 * Input to a tool invocation.
 */
export interface ToolInput {
  /** The prompt to send to the agent */
  prompt: string;
  /** Model override */
  model?: string;
  /** Working directory for the CLI */
  workingDir?: string;
  /** Timeout override in milliseconds */
  timeoutMs?: number;
}

/**
 * Result from a tool invocation.
 */
export interface ToolResult {
  /** The response content from the agent */
  content: string;
  /** Whether the invocation succeeded */
  success: boolean;
  /** Process exit code */
  exitCode: number | null;
  /** How long the invocation took in ms */
  durationMs: number;
  /** Which backend was used */
  backend: string;
  /** Which model was used */
  model: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Hub configuration loaded from file or env.
 */
export interface HubConfig {
  /** Backend configurations (overrides defaults) */
  backends?: Partial<Record<string, Partial<BackendConfig>>>;
  /** Global default timeout in ms */
  defaultTimeoutMs?: number;
  /** Session manager configuration */
  session?: import('./session-manager.js').SessionConfig;
}
