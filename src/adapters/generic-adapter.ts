/**
 * Coding Agent Hub — Generic Backend Adapter
 *
 * Fallback adapter for custom backends with no specific extraction logic.
 */

import { extractMessageContent } from '../message-extractor.js';
import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class GenericAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, _model: string): string[] {
    return [input.prompt];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    // Delegate to the shared extractor which handles JSON + plain text
    return extractMessageContent(stdout, exitCode);
  }

  buildDescription(config: BackendConfig): string {
    return [
      `Invoke ${config.displayName} (${config.command} CLI) to get an AI response.`,
      `Default model: ${config.defaultModel}.`,
    ].join(' ');
  }
}
