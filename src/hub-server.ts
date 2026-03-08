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
import type { BackendConfig, ToolInput, ToolResult } from './types.js';
import { HubSessionManager, type SessionConfig } from './session-manager.js';
import type { SessionStore } from './session-store.js';
import { PluginRuntime } from './plugins/index.js';
import type { PluginCapabilitySnapshot } from './plugins/types.js';
import { logger } from './logger.js';

/**
 * Derive the model maker (company name) from a model identifier string.
 */
function deriveModelMaker(model: string): string {
  const lower = model.toLowerCase();
  if (lower.startsWith('claude')) return 'Anthropic';
  if (lower.startsWith('gemini')) return 'Google';
  if (lower.startsWith('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'OpenAI';
  if (lower.startsWith('llama')) return 'Meta';
  if (lower.startsWith('mistral') || lower.startsWith('codestral')) return 'Mistral';
  if (lower.startsWith('deepseek')) return 'DeepSeek';
  return 'Unknown';
}

/**
 * Build the "Agent Started" banner from runtime model info.
 */
function buildAgentStartedBanner(runtimeModel: string | undefined, fallbackModel: string): string {
  const model = runtimeModel || fallbackModel;
  const maker = deriveModelMaker(model);
  return `Agent Started\n${maker} - ${model}`;
}

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
  pluginRuntime: PluginRuntime = new PluginRuntime(),
): McpServer {
  const enabledConfigs = configs.filter((c) => c.enabled);

  const server = new McpServer({
    name: 'coding-agent-hub',
    version: '0.1.0',
  });

  const sessionManager = new HubSessionManager(sessionConfig, sessionStore);

  const availableBackends = enabledConfigs.map((c) => c.name).join(', ');

  const safeSessionMetadataUpdate = (
    sessionId: string,
    patch: { pluginId: string; mode: 'hub' | 'native'; capabilities: PluginCapabilitySnapshot },
  ) => {
    try {
      sessionManager.updateSessionMetadata(sessionId, {
        pluginId: patch.pluginId,
        continuityMode: patch.mode,
        nativeSessionRef: patch.mode === 'native' ? sessionId : null,
        capabilitySnapshot: patch.capabilities,
      });
      return true;
    } catch (error) {
      logger.debug('Session metadata update skipped; session no longer available', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const safeTurnCommit = (sessionId: string, turnIndex: number, content: string) => {
    try {
      sessionManager.commitTurn(sessionId, turnIndex, content);
      return true;
    } catch (error) {
      logger.debug('Session turn commit skipped; session no longer available', {
        sessionId,
        turnIndex,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const safeTurnRollback = (sessionId: string, turnIndex: number) => {
    try {
      sessionManager.rollbackTurn(sessionId, turnIndex);
      return true;
    } catch (error) {
      logger.debug('Session turn rollback skipped; session no longer available', {
        sessionId,
        turnIndex,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  async function invokeWithContinuityFallback(params: {
    config: BackendConfig;
    input: ToolInput;
    resolvedModel: string;
    sessionId?: string;
    isSessionStart: boolean;
    mode: 'hub' | 'native';
  }): Promise<{ result: ToolResult; usedMode: 'hub' | 'native' }> {
    const run = async (mode: 'hub' | 'native') => {
      const runtimeInvocation = await pluginRuntime.buildInvocation({
        config: params.config,
        input: params.input,
        resolvedModel: params.resolvedModel,
        isSessionStart: params.isSessionStart,
        sessionRef: params.sessionId,
        mode,
      });

      const result = await invokeCli(params.config, params.input, {
        invocation: runtimeInvocation.invocation,
        plugin: runtimeInvocation.plugin,
      });

      return { result, usedMode: runtimeInvocation.mode, pluginId: runtimeInvocation.plugin.id, capabilities: runtimeInvocation.capabilities };
    };

    const first = await run(params.mode);

    const shouldFallback =
      !!params.sessionId &&
      first.usedMode === 'native' &&
      !first.result.success &&
      pluginRuntime.isNativeFallbackError(first.result);

    if (!shouldFallback || !params.sessionId) {
      if (params.sessionId) {
        safeSessionMetadataUpdate(params.sessionId, {
          pluginId: first.pluginId,
          mode: first.usedMode,
          capabilities: first.capabilities,
        });
      }

      return first;
    }

    safeSessionMetadataUpdate(params.sessionId, {
      pluginId: first.pluginId,
      mode: 'hub',
      capabilities: first.capabilities,
    });

    const second = await run('hub');
    safeSessionMetadataUpdate(params.sessionId, {
      pluginId: second.pluginId,
      mode: second.usedMode,
      capabilities: second.capabilities,
    });

    return second;
  }

  // Register a single one-shot tool for all backends.
  server.tool(
    'hub-agent',
    'Invoke a coding agent backend in one shot. Choose backend via the "backend" parameter.',
    {
      backend: z.string().optional().describe(`Backend to invoke (enabled: ${availableBackends || 'none'}). Required unless sessionId is provided`),
      prompt: z.string().describe('The prompt/question to send to the selected backend'),
      model: z.string().optional().describe('Model override'),
      workingDir: z.string().optional().describe('Working directory for the CLI invocation'),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
      sessionId: z.string().optional().describe('Session ID for multi-turn conversation continuity'),
    },
  async (args) => {
      let config: BackendConfig | undefined;
      let effectivePrompt = args.prompt;
      let effectiveModel = args.model;
      let effectiveWorkingDir = args.workingDir;
      let staged: { turnIndex: number; isSessionStart: boolean } | undefined;
      let continuityMode: 'hub' | 'native' = 'hub';

      if (args.sessionId) {
        const session = sessionManager.getSession(args.sessionId);
        if (!session) {
          return {
            content: [{ type: 'text' as const, text: `Session not found: ${args.sessionId}` }],
            isError: true,
          };
        }

        if (args.backend && args.backend !== session.backend) {
          return {
            content: [{ type: 'text' as const, text: `Session backend mismatch: session "${args.sessionId}" uses "${session.backend}"` }],
            isError: true,
          };
        }

        config = enabledConfigs.find((c) => c.name === session.backend);
        if (!config) {
          return {
            content: [{ type: 'text' as const, text: `Backend "${session.backend}" is no longer available` }],
            isError: true,
          };
        }

        effectiveModel = (args.model ?? session.model) || undefined;
        effectiveWorkingDir = args.workingDir ?? session.workingDir;
        continuityMode = session.continuityMode ?? 'hub';

        try {
          const result = sessionManager.stageUserTurn(args.sessionId, args.prompt, {
            includeHistory: continuityMode !== 'native',
          });
          effectivePrompt = result.prompt;
          staged = {
            turnIndex: result.turnIndex,
            isSessionStart: result.isSessionStart,
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      } else {
        if (!args.backend) {
          return {
            content: [{ type: 'text' as const, text: `Missing required argument: backend. Available: ${availableBackends || '(none enabled)'}` }],
            isError: true,
          };
        }

        config = enabledConfigs.find((c) => c.name === args.backend);
        if (!config) {
          return {
            content: [{ type: 'text' as const, text: `Unknown or disabled backend: "${args.backend}". Available: ${availableBackends}` }],
            isError: true,
          };
        }
      }

      let result;
      let usedMode: 'hub' | 'native' = continuityMode;
      const effectiveInput = {
        prompt: effectivePrompt,
        model: effectiveModel,
        workingDir: effectiveWorkingDir,
        timeoutMs: args.timeoutMs,
      };
      try {
        const resolvedModel = effectiveModel || config.defaultModel;
        const invocationResult = await invokeWithContinuityFallback({
          config,
          input: effectiveInput,
          resolvedModel,
          isSessionStart: args.sessionId ? (staged?.isSessionStart ?? false) : false,
          sessionId: args.sessionId,
          mode: continuityMode,
        });

        usedMode = invocationResult.usedMode;
        result = invocationResult.result;
      } catch (err) {
        if (args.sessionId && staged) {
          safeTurnRollback(args.sessionId, staged.turnIndex);
        }
        return {
          content: [{ type: 'text' as const, text: `Hub invocation failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      if (args.sessionId && staged) {
        if (result.success) {
          safeTurnCommit(args.sessionId, staged.turnIndex, result.content);
        } else {
          safeTurnRollback(args.sessionId, staged.turnIndex);
        }
      }
      if (result.success) {
        const banner = buildAgentStartedBanner(result.runtimeModel, result.model);
        const metadata = [
          `Backend: ${result.backend}`,
          `Model: ${result.runtimeModel || result.model}`,
          `Duration: ${result.durationMs}ms`,
        ];
        if (result.stderr?.trim()) {
          metadata.push(`Warnings: ${result.stderr.trim().slice(0, 200)}`);
        }
        if (args.sessionId) {
          metadata.push(`Session: ${args.sessionId}`);
          metadata.push(`Mode: ${usedMode}`);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `${banner}\n\n${result.content}\n\n---\n_${metadata.join(' | ')}_`,
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
      if (usedMode === 'native') {
        errorParts.push('Continuity mode: native (attempted)');
      }

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
      let continuityMode: 'hub' | 'native' = 'hub';
      let pluginId: string | undefined;
      let capabilitySnapshot: PluginCapabilitySnapshot | undefined;
      try {
        const selection = await pluginRuntime.resolveSessionMetadata(backendConfig);
        continuityMode = selection.continuityMode;
        pluginId = selection.plugin.id;
        capabilitySnapshot = selection.capabilities;
        sessionId = sessionManager.startSession(args.backend, {
          model: args.model,
          workingDir: args.workingDir,
          sessionId: args.sessionId,
          pluginId,
          continuityMode,
          capabilitySnapshot,
        });
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      }

      const sessionModel = args.model || backendConfig.defaultModel;
      const banner = buildAgentStartedBanner(undefined, sessionModel);
      return {
        content: [
          {
            type: 'text' as const,
            text: `${banner}\n\n${JSON.stringify({
              sessionId,
              backend: args.backend,
              model: sessionModel,
              pluginId,
              continuityMode,
            })}`,
          },
        ],
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

      let staged: { prompt: string; turnIndex: number; isSessionStart: boolean };
      try {
        staged = sessionManager.stageUserTurn(args.sessionId, args.message, {
          includeHistory: session.continuityMode !== 'native',
        });
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Session error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      const resolvedModel = session.model || backendConfig.defaultModel;
      let result;
      try {
        const invocationInput = {
          prompt: staged.prompt,
          model: resolvedModel,
          workingDir: session.workingDir,
          timeoutMs: args.timeoutMs,
        };
        const invocationResult = await invokeWithContinuityFallback({
          config: backendConfig,
          input: invocationInput,
          resolvedModel,
          isSessionStart: staged.isSessionStart,
          sessionId: args.sessionId,
          mode: session.continuityMode ?? 'hub',
        });
        result = invocationResult.result;
      } catch (err) {
        safeTurnRollback(args.sessionId, staged.turnIndex);
        return {
          content: [{ type: 'text' as const, text: `Hub invocation failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      if (result.success) {
        safeTurnCommit(args.sessionId, staged.turnIndex, result.content);

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

      safeTurnRollback(args.sessionId, staged.turnIndex);

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
