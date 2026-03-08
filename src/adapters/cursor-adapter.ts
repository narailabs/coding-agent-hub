/**
 * Coding Agent Hub — Cursor CLI Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class CursorAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      '--print',
      '--output-format',
      'json',
      '--model',
      model,
      '--force',
      input.prompt,
    ];
  }

  buildArgsWithoutPrompt(input: ToolInput, model: string): string[] {
    return [
      '--print',
      '--output-format',
      'json',
      '--model',
      model,
      '--force',
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Cursor may output NDJSON — take the last complete JSON object
    try {
      const lines = trimmed.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        const startIdx = line.indexOf('{');
        const endIdx = line.lastIndexOf('}');
        if (startIdx !== -1 && endIdx > startIdx) {
          const parsed = JSON.parse(line.slice(startIdx, endIdx + 1));
          const content = parsed.message || parsed.content || parsed.response;
          if (content && typeof content === 'string') {
            return {
              content,
              runtimeModel: typeof parsed.model === 'string' ? parsed.model : undefined,
              metadata: {
                extractedFromStdout: true,
                jsonFormat: 'cursor',
                exitCode,
              },
            };
          }
        }
      }
    } catch {
      // Fall through to plain text
    }

    // Try parsing the whole output as a single JSON object
    try {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
        const content = parsed.message || parsed.content || parsed.response;
        if (content && typeof content === 'string') {
          return {
            content,
            runtimeModel: typeof parsed.model === 'string' ? parsed.model : undefined,
            metadata: {
              extractedFromStdout: true,
              jsonFormat: 'cursor',
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
      'Use this to get a response from Cursor CLI.',
      'Cursor excels at codebase-aware editing and generation.',
    ].join(' ');
  }
}
