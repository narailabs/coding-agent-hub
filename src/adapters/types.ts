/**
 * Coding Agent Hub — Backend Adapter Interface
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';

/**
 * Adapter interface for backend-specific behavior.
 */
export interface BackendAdapter {
  /** Build CLI arguments for invocation. */
  buildArgs(input: ToolInput, model: string): string[];

  /** Extract the response from CLI stdout. */
  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null;

  /** Build a human-readable tool description. */
  buildDescription(config: BackendConfig): string;

  /** How the prompt is delivered to the CLI. */
  promptDelivery: 'arg' | 'stdin';

  /** Build args without the prompt (used when promptDelivery is 'stdin'). */
  buildArgsWithoutPrompt?(input: ToolInput, model: string): string[];
}
