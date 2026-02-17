/**
 * Coding Agent Hub — Gemini Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class GeminiAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      '-p',
      input.prompt,
      '--output-format',
      'json',
      '--yolo',
      '-m',
      model,
      ...(input.workingDir ? ['--include-directories', input.workingDir] : []),
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Gemini outputs JSON with a "response" field
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
              jsonFormat: 'gemini',
              exitCode,
            },
          };
        }
      }
    } catch {
      // Fall through to plain text
    }

    // Plain text fallback — no 10-char minimum for short replies
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
      'Use this to get a response from Google\'s Gemini model.',
      'Gemini has access to web search and code analysis tools.',
    ].join(' ');
  }
}
