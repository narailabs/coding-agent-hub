/**
 * Coding Agent Hub — Claude Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class ClaudeAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      '--print',
      '--model',
      model,
      '--output-format',
      'text',
      input.prompt,
    ];
  }

  extractResponse(stdout: string, _exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Claude --print --output-format text returns plain text
    return {
      content: trimmed,
      metadata: { extractedFromStdout: true, jsonFormat: 'plaintext' },
    };
  }

  buildDescription(config: BackendConfig): string {
    return [
      `Invoke ${config.displayName} (${config.command} CLI) to get an AI response.`,
      `Default model: ${config.defaultModel}.`,
      'Use this to get a response from Anthropic\'s Claude Code agent.',
      'Claude excels at code analysis, architecture, and reasoning.',
    ].join(' ');
  }
}
