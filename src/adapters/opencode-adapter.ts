/**
 * Coding Agent Hub — OpenCode Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class OpenCodeAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, _model: string): string[] {
    return [
      '-p',
      input.prompt,
      '-f',
      'json',
      '-q',
    ];
  }

  buildArgsWithoutPrompt(_input: ToolInput, _model: string): string[] {
    return [
      '-f',
      'json',
      '-q',
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // OpenCode outputs JSON with "response" or "content" field
    try {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
        const content = parsed.response || parsed.content;
        if (content && typeof content === 'string') {
          return {
            content,
            metadata: {
              extractedFromStdout: true,
              jsonFormat: 'opencode',
              exitCode,
            },
          };
        }
      }
    } catch {
      // Fall through to plain text
    }

    // Plain text fallback
    if (trimmed) {
      return {
        content: trimmed,
        metadata: { extractedFromStdout: true, jsonFormat: 'plaintext', exitCode },
      };
    }

    return null;
  }

  buildDescription(config: BackendConfig): string {
    return [
      `Invoke ${config.displayName} (${config.command} CLI) to get an AI response.`,
      `Default model: ${config.defaultModel}.`,
      'Use this to get a response from OpenCode, a multi-provider coding agent.',
      'OpenCode supports multiple LLM providers and excels at code generation and editing.',
    ].join(' ');
  }
}
