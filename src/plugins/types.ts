/**
 * Coding Agent Hub — Plugin Interfaces
 */

import type { BackendConfig, ToolInput } from '../types.js';
import type { ErrorType, ToolResult } from '../types.js';
import type { ExtractedMessage } from '../message-extractor.js';

export type ContinuityMode = 'hub' | 'native';

export interface PluginCapabilitySnapshot {
  /** Plugin identity that produced this snapshot. */
  pluginId: string;
  /** Backend command version if discoverable. */
  version?: string;
  /** Raw CLI help text used for detection. */
  helpText?: string;
  /** Whether this backend has been probed for capabilities. */
  detectedAt: number;
  /** Whether snapshot was loaded from cache. */
  cached: boolean;
  /** Whether native session-style continuity is believed to work. */
  supportsNativeSession: boolean;
  /** Preferred native strategy flag (if any). */
  nativeSessionFlag?: string;
  /** Preferred native strategy subcommand (if any). */
  nativeSessionSubcommand?: string;
  /** Whether native mode uses positional resume tokens. */
  nativeSessionResumeMode?: 'flag' | 'subcommand';
  /** Whether native start is believed to be supported. */
  supportsNativeStart?: boolean;
  /** Whether native continuation is believed to be supported. */
  supportsNativeContinue?: boolean;
  /** Internal debug text for diagnostics. */
  note?: string;
}

export interface PluginInvocation {
  /** Full CLI args (excluding command). */
  args: string[];
  /** Optional stdin payload if plugin wants stdin delivery. */
  stdinData?: string;
}

export interface PluginDetectionContext {
  command: string;
  timeoutMs?: number;
}

export interface AgentPlugin {
  /** Stable plugin id used in configuration and persistence. */
  readonly id: string;
  /** Human-readable plugin label. */
  readonly displayName: string;
  /** Default continuity choice before probing. */
  readonly preferredContinuity: ContinuityMode;

  /** Determine whether this plugin applies to a backend. */
  matches(config: BackendConfig): boolean;

  /** Runtime capability probe. */
  detectCapabilities(context: PluginDetectionContext): Promise<PluginCapabilitySnapshot>;

  /** Build one-shot invocation args (no persistence/session id). */
  buildOneShotInvocation(
    config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
  ): Promise<PluginInvocation>;

  /** Build invocation for first native continuity turn. */
  buildNativeStartInvocation(
    config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
    sessionRef: string,
    capabilities: PluginCapabilitySnapshot,
  ): Promise<PluginInvocation>;

  /** Build invocation for native continuation turn. */
  buildNativeContinueInvocation(
    config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
    sessionRef: string,
    capabilities: PluginCapabilitySnapshot,
  ): Promise<PluginInvocation>;

  /** Parse stdout into a response message for this plugin. */
  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null;

  /** Optional hook to classify errors. */
  classifyError?(result: ToolResult): ToolResult;

  /** Fallback/placeholder snapshot when probing is unavailable. */
  fallbackCapabilities(config: BackendConfig): PluginCapabilitySnapshot;
}

export interface PluginRuntimeOptions {
  /** Plugin module paths loaded through HubConfig.plugins.paths. */
  pluginPaths?: string[];
  /** TTL for capability cache. */
  capabilityCacheTtlMs?: number;
  /** Whether detection failures should be surfaced. */
  strict?: boolean;
}

export interface RuntimeInvocationContext {
  config: BackendConfig;
  input: ToolInput;
  resolvedModel: string;
  isSessionStart?: boolean;
  capabilities?: PluginCapabilitySnapshot;
  sessionRef?: string;
  mode?: ContinuityMode;
}

export interface RuntimeInvocation {
  plugin: AgentPlugin;
  pluginId: string;
  mode: ContinuityMode;
  invocation: PluginInvocation;
  capabilities: PluginCapabilitySnapshot;
}

export interface ClassifiedError {
  errorType: ErrorType;
  retryable: boolean;
}
