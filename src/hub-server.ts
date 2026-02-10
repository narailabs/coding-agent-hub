/**
 * Coding Agent Hub — MCP Server
 *
 * Creates an MCP server that exposes coding agent CLIs as tools.
 * Uses @modelcontextprotocol/sdk directly (no Claude Agent SDK dependency).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invokeCli } from './cli-invoker.js';
import type { BackendConfig } from './types.js';

/**
 * Build a tool description for a backend.
 */
export function buildToolDescription(config: BackendConfig): string {
  const parts = [
    `Invoke ${config.displayName} (${config.command} CLI) to get an AI response.`,
    `Default model: ${config.defaultModel}.`,
  ];

  switch (config.name) {
    case 'claude':
      parts.push(
        'Use this to get a response from Anthropic\'s Claude Code agent.',
      );
      parts.push('Claude excels at code analysis, architecture, and reasoning.');
      break;
    case 'gemini':
      parts.push(
        'Use this to get a response from Google\'s Gemini model.',
      );
      parts.push('Gemini has access to web search and code analysis tools.');
      break;
    case 'codex':
      parts.push(
        'Use this to get a response from OpenAI\'s Codex.',
      );
      parts.push('Codex specializes in code implementation and review.');
      break;
  }

  return parts.join(' ');
}

/**
 * Create an MCP server exposing backends as tools.
 */
export function createHubServer(configs: BackendConfig[]): McpServer {
  const enabledConfigs = configs.filter((c) => c.enabled);

  const server = new McpServer({
    name: 'coding-agent-hub',
    version: '0.1.0',
  });

  for (const config of enabledConfigs) {
    server.tool(
      `${config.name}-agent`,
      buildToolDescription(config),
      {
        prompt: z.string().describe(`The prompt/question to send to ${config.displayName}`),
        model: z.string().optional().describe(`Model override (default: ${config.defaultModel})`),
        workingDir: z.string().optional().describe('Working directory for the CLI invocation'),
        timeoutMs: z.number().optional().describe(`Timeout in milliseconds (default: ${config.timeoutMs})`),
      },
      async (args) => {
        const result = await invokeCli(config, {
          prompt: args.prompt,
          model: args.model,
          workingDir: args.workingDir,
          timeoutMs: args.timeoutMs,
        });

        if (result.success) {
          const metadata = [
            `Backend: ${result.backend}`,
            `Model: ${result.model}`,
            `Duration: ${result.durationMs}ms`,
          ].join(' | ');

          return {
            content: [
              {
                type: 'text' as const,
                text: `${result.content}\n\n---\n_${metadata}_`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Hub invocation failed: ${result.error || 'Unknown error'}\n\nBackend: ${result.backend}\nExit code: ${result.exitCode}`,
            },
          ],
          isError: true,
        };
      },
    );
  }

  return server;
}
