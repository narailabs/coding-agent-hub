/**
 * Coding Agent Hub — Claude Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class ClaudeAdapter implements BackendAdapter {
  promptDelivery = 'stdin' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      '--print',
      '--model',
      model,
      '--output-format',
      'json',
      input.prompt,
    ];
  }

  buildArgsWithoutPrompt(input: ToolInput, model: string): string[] {
    return [
      '--print',
      '--model',
      model,
      '--output-format',
      'json',
      '-',  // Claude reads from stdin when prompt is '-'
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Claude --print --output-format json returns JSON with result and model fields
    try {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
        const content = parsed.result || parsed.content;
        if (content && typeof content === 'string') {
          return {
            content,
            runtimeModel: typeof parsed.model === 'string' ? parsed.model : undefined,
            metadata: {
              extractedFromStdout: true,
              jsonFormat: 'claude',
              exitCode,
            },
          };
        }
      }
    } catch {
      // Fall through to plain text
    }

    // Plain text fallback
    return {
      content: trimmed,
      metadata: { extractedFromStdout: true, jsonFormat: 'plaintext', exitCode },
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
