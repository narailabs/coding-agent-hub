/**
 * Coding Agent Hub — Copilot CLI Backend Adapter
 */

import type { ExtractedMessage } from '../message-extractor.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from './types.js';

/**
 * Strip ANSI escape codes from terminal output.
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export class CopilotAdapter implements BackendAdapter {
  promptDelivery = 'arg' as const;

  buildArgs(input: ToolInput, model: string): string[] {
    return [
      '-p',
      input.prompt,
      '--model',
      model,
      '--allow-all-paths',
    ];
  }

  buildArgsWithoutPrompt(input: ToolInput, model: string): string[] {
    return [
      '--model',
      model,
      '--allow-all-paths',
    ];
  }

  extractResponse(stdout: string, exitCode: number | null): ExtractedMessage | null {
    const cleaned = stripAnsi(stdout).trim();
    if (!cleaned) return null;

    // Copilot CLI outputs plain text with possible ANSI codes
    return {
      content: cleaned,
      metadata: {
        extractedFromStdout: true,
        jsonFormat: 'plaintext',
        exitCode,
      },
    };
  }

  buildDescription(config: BackendConfig): string {
    return [
      `Invoke ${config.displayName} (${config.command} CLI) to get an AI response.`,
      `Default model: ${config.defaultModel}.`,
      'Use this to get a response from GitHub Copilot CLI.',
      'Copilot integrates with the GitHub ecosystem for code generation and assistance.',
    ].join(' ');
  }
}
