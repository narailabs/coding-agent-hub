/**
 * Coding Agent Hub — MCP Server
 *
 * Creates an MCP server that exposes coding agent CLIs as tools.
 * Uses @modelcontextprotocol/sdk directly (no Claude Agent SDK dependency).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invokeCli } from './cli-invoker.js';
import { getAdapter } from './adapters/index.js';
import type { BackendConfig } from './types.js';
import { HubSessionManager, type SessionConfig } from './session-manager.js';
import type { SessionStore } from './session-store.js';

/**
 * Build a tool description for a backend.
 * Delegates to the backend's adapter for backend-specific descriptions.
 */
export function buildToolDescription(config: BackendConfig): string {
  const adapter = getAdapter(config.argBuilder);
  return adapter.buildDescription(config);
}

/**
 * Create an MCP server exposing backends as tools.
 * Optionally supports persistent sessions for multi-turn conversations.
 */
export function createHubServer(
  configs: BackendConfig[],
  sessionConfig?: SessionConfig,
  sessionStore?: SessionStore,
): McpServer {
  const enabledConfigs = configs.filter((c) => c.enabled);

  const server = new McpServer({
    name: 'coding-agent-hub',
    version: '0.1.0',
  });

  const sessionManager = new HubSessionManager(sessionConfig, sessionStore);

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
        let staged: { turnIndex: number } | undefined;

        if (args.sessionId) {
          try {
            const result = sessionManager.stageUserTurn(args.sessionId, args.prompt);
            effectivePrompt = result.prompt;
            staged = { turnIndex: result.turnIndex };
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

        if (args.sessionId && staged) {
          if (result.success) {
            sessionManager.commitTurn(args.sessionId, staged.turnIndex, result.content);
          } else {
            sessionManager.rollbackTurn(args.sessionId, staged.turnIndex);
          }
        }

        if (result.success) {
          const metadata = [
            `Backend: ${result.backend}`,
            `Model: ${result.model}`,
            `Duration: ${result.durationMs}ms`,
          ];
          if (result.stderr?.trim()) {
            metadata.push(`Warnings: ${result.stderr.trim().slice(0, 200)}`);
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `${result.content}\n\n---\n_${metadata.join(' | ')}_`,
              },
            ],
          };
        }

        const errorParts = [
          `Hub invocation failed: ${result.error || 'Unknown error'}`,
          '',
          `Backend: ${result.backend}`,
          `Exit code: ${result.exitCode}`,
        ];
        if (result.errorType) errorParts.push(`Error type: ${result.errorType}`);
        if (result.retryable) errorParts.push('Retryable: yes');

        return {
          content: [
            {
              type: 'text' as const,
              text: errorParts.join('\n'),
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
      sessionId: z.string().optional().describe('Optional custom session ID. If not provided, a UUID is generated automatically'),
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

      let sessionId: string;
      try {
        sessionId = sessionManager.startSession(args.backend, {
          model: args.model,
          workingDir: args.workingDir,
          sessionId: args.sessionId,
        });
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }

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

      let staged: { prompt: string; turnIndex: number };
      try {
        staged = sessionManager.stageUserTurn(args.sessionId, args.message);
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      const result = await invokeCli(backendConfig, {
        prompt: staged.prompt,
        model: session.model || undefined,
        workingDir: session.workingDir,
        timeoutMs: args.timeoutMs,
      });

      if (result.success) {
        sessionManager.commitTurn(args.sessionId, staged.turnIndex, result.content);

        const metadata = [
          `Backend: ${result.backend}`,
          `Model: ${result.model}`,
          `Duration: ${result.durationMs}ms`,
          `Session: ${args.sessionId}`,
        ];
        if (result.stderr?.trim()) {
          metadata.push(`Warnings: ${result.stderr.trim().slice(0, 200)}`);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `${result.content}\n\n---\n_${metadata.join(' | ')}_`,
            },
          ],
        };
      }

      sessionManager.rollbackTurn(args.sessionId, staged.turnIndex);

      const errorParts = [
        `Hub invocation failed: ${result.error || 'Unknown error'}`,
        '',
        `Backend: ${result.backend}`,
        `Exit code: ${result.exitCode}`,
      ];
      if (result.errorType) errorParts.push(`Error type: ${result.errorType}`);
      if (result.retryable) errorParts.push('Retryable: yes');

      return {
        content: [
          {
            type: 'text' as const,
            text: errorParts.join('\n'),
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
