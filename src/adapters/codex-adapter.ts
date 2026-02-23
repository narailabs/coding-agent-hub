/**
 * Coding Agent Hub — Codex Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

export class CodexAdapter implements BackendAdapter {
  promptDelivery = 'stdin' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      'exec',
      input.prompt,
      '--json',
      '--model',
      model,
      '--full-auto',
      '--skip-git-repo-check',
      ...(input.workingDir ? ['--cd', input.workingDir] : []),
    ];
  }

  buildArgsWithoutPrompt(input: ToolInput, model: string): string[] {
    return [
      'exec',
      '--json',
      '--model',
      model,
      '--full-auto',
      '--skip-git-repo-check',
      ...(input.workingDir ? ['--cd', input.workingDir] : []),
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Codex outputs JSON with "content" or "result" field
    try {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const parsed = JSON.parse(trimmed.slice(startIdx, endIdx + 1));
        const content = parsed.content || parsed.result;
        if (content && typeof content === 'string') {
          return {
            content,
            metadata: {
              extractedFromStdout: true,
              jsonFormat: 'codex',
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
      'Use this to get a response from OpenAI\'s Codex.',
      'Codex specializes in code implementation and review.',
    ].join(' ');
  }
}
