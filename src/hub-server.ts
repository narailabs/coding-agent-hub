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
import { HubSessionManager, type SessionConfig } from './session-manager.js';

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
 * Optionally supports persistent sessions for multi-turn conversations.
 */
export function createHubServer(
  configs: BackendConfig[],
  sessionConfig?: SessionConfig,
): McpServer {
  const enabledConfigs = configs.filter((c) => c.enabled);

  const server = new McpServer({
    name: 'coding-agent-hub',
    version: '0.1.0',
  });

  const sessionManager = new HubSessionManager(sessionConfig);

  // Register per-backend agent tools
  for (const config of enabledConfigs) {
    server.tool(
      `${config.name}-agent`,
      buildToolDescription(config),
      {
        prompt: z.string().describe(`The prompt/question to send to ${config.displayName}`),
        model: z.string().optional().describe(`Model override (default: ${config.defaultModel})`),
        workingDir: z.string().optional().describe('Working directory for the CLI invocation'),
        timeoutMs: z.number().optional().describe(`Timeout in milliseconds (default: ${config.timeoutMs})`),
        sessionId: z.string().optional().describe('Session ID for multi-turn conversation continuity'),
      },
      async (args) => {
        let effectivePrompt = args.prompt;

        if (args.sessionId) {
          try {
            effectivePrompt = sessionManager.buildPrompt(args.sessionId, args.prompt);
          } catch (err) {
            return {
              content: [{ type: 'text' as const, text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
              isError: true,
            };
          }
        }

        const result = await invokeCli(config, {
          prompt: effectivePrompt,
          model: args.model,
          workingDir: args.workingDir,
          timeoutMs: args.timeoutMs,
        });

        if (result.success && args.sessionId) {
          sessionManager.recordResponse(args.sessionId, result.content);
        }

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

  // --- Session lifecycle tools ---

  server.tool(
    'hub-session-start',
    'Start a new persistent conversation session with a coding agent backend. Returns a session ID for use with subsequent messages.',
    {
      backend: z.string().describe('Backend to use for this session (e.g., "claude", "gemini", "codex")'),
      model: z.string().optional().describe('Model override for this session'),
      workingDir: z.string().optional().describe('Working directory for CLI invocations in this session'),
    },
    async (args) => {
      const backendConfig = enabledConfigs.find((c) => c.name === args.backend);
      if (!backendConfig) {
        const available = enabledConfigs.map((c) => c.name).join(', ');
        return {
          content: [{ type: 'text' as const, text: `Unknown or disabled backend: "${args.backend}". Available: ${available}` }],
          isError: true,
        };
      }

      const sessionId = sessionManager.startSession(args.backend, {
        model: args.model,
        workingDir: args.workingDir,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ sessionId, backend: args.backend, model: args.model || backendConfig.defaultModel }) }],
      };
    },
  );

  server.tool(
    'hub-session-message',
    'Send a message in an existing session. Conversation history is automatically prepended for context continuity.',
    {
      sessionId: z.string().describe('Session ID from hub-session-start'),
      message: z.string().describe('The message to send'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
    },
    async (args) => {
      const session = sessionManager.getSession(args.sessionId);
      if (!session) {
        return {
          content: [{ type: 'text' as const, text: `Session not found: ${args.sessionId}` }],
          isError: true,
        };
      }

      const backendConfig = enabledConfigs.find((c) => c.name === session.backend);
      if (!backendConfig) {
        return {
          content: [{ type: 'text' as const, text: `Backend "${session.backend}" is no longer available` }],
          isError: true,
        };
      }

      let effectivePrompt: string;
      try {
        effectivePrompt = sessionManager.buildPrompt(args.sessionId, args.message);
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      const result = await invokeCli(backendConfig, {
        prompt: effectivePrompt,
        model: session.model || undefined,
        workingDir: session.workingDir,
        timeoutMs: args.timeoutMs,
      });

      if (result.success) {
        sessionManager.recordResponse(args.sessionId, result.content);

        const metadata = [
          `Backend: ${result.backend}`,
          `Model: ${result.model}`,
          `Duration: ${result.durationMs}ms`,
          `Session: ${args.sessionId}`,
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

  server.tool(
    'hub-session-stop',
    'End a persistent conversation session and free its resources.',
    {
      sessionId: z.string().describe('Session ID to stop'),
    },
    async (args) => {
      const stopped = sessionManager.stopSession(args.sessionId);
      if (!stopped) {
        return {
          content: [{ type: 'text' as const, text: `Session not found: ${args.sessionId}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Session ${args.sessionId} stopped` }],
      };
    },
  );

  server.tool(
    'hub-session-list',
    'List all active conversation sessions.',
    {},
    async () => {
      const sessions = sessionManager.listSessions();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }],
      };
    },
  );

  return server;
}
