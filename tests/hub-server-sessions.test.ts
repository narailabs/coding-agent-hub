import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHubServer } from '../src/hub-server.js';
import type { BackendConfig } from '../src/types.js';
import { HubSessionManager } from '../src/session-manager.js';
import { FileSessionStore } from '../src/session-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Integration tests for session tools in the hub server.
 *
 * We mock invokeCli to avoid actual CLI invocations and test the
 * session lifecycle and prompt augmentation logic.
 */

// Mock the CLI invoker
vi.mock('../src/cli-invoker.js', () => ({
  invokeCli: vi.fn(),
}));

import { invokeCli } from '../src/cli-invoker.js';
const mockInvokeCli = vi.mocked(invokeCli);

const TEST_BACKEND: BackendConfig = {
  name: 'test',
  displayName: 'Test Backend',
  command: 'test-cli',
  enabled: true,
  defaultModel: 'test-model-1',
  timeoutMs: 30_000,
  argBuilder: 'generic',
};

/**
 * Helper to call a tool on the MCP server by extracting the handler.
 * Uses the internal _registeredTools object from McpServer.
 */
async function callTool(server: ReturnType<typeof createHubServer>, toolName: string, args: Record<string, unknown>) {
  const registeredTools = (server as any)._registeredTools as Record<string, any>;
  const tool = registeredTools?.[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found. Available: ${Object.keys(registeredTools ?? {}).join(', ')}`);
  }
  const handler = tool.handler;
  if (!handler) {
    throw new Error(`Tool "${toolName}" has no handler`);
  }
  return handler(args);
}

/**
 * Parse session-start response text, which now has an "Agent Started" banner
 * prepended before the JSON payload.
 */
function parseSessionStartJson(text: string): Record<string, unknown> {
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) throw new Error(`No JSON found in response: ${text}`);
  return JSON.parse(text.slice(jsonStart));
}

describe('Hub Server Session Tools', () => {
  let server: ReturnType<typeof createHubServer>;

  beforeEach(() => {
    mockInvokeCli.mockReset();
    server = createHubServer([TEST_BACKEND], { idleTimeoutMs: 60_000 });
  });

  describe('hub-session-start', () => {
    it('creates a session and returns sessionId', async () => {
      const result = await callTool(server, 'hub-session-start', {
        backend: 'test',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Agent Started');
      const data = parseSessionStartJson(result.content[0].text);
      expect(data.sessionId).toBeDefined();
      expect(data.backend).toBe('test');
      expect(data.model).toBe('test-model-1');
    });

    it('rejects unknown backend', async () => {
      const result = await callTool(server, 'hub-session-start', {
        backend: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown or disabled backend');
      expect(result.content[0].text).toContain('test');
    });

    it('accepts model and workingDir options', async () => {
      const result = await callTool(server, 'hub-session-start', {
        backend: 'test',
        model: 'custom-model',
        workingDir: '/custom/dir',
      });

      const data = parseSessionStartJson(result.content[0].text);
      expect(data.sessionId).toBeDefined();
      expect(data.model).toBe('custom-model');
    });

    it('includes plugin continuity metadata', async () => {
      const pluginRuntime = {
        resolveSessionMetadata: vi.fn(async () => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
          continuityMode: 'native',
        })),
        buildInvocation: vi.fn(),
      };

      const nativeServer = createHubServer([TEST_BACKEND], { idleTimeoutMs: 60_000 }, undefined, pluginRuntime as any);
      const result = await callTool(nativeServer, 'hub-session-start', {
        backend: 'test',
      });

      expect(result.isError).toBeUndefined();
      const data = parseSessionStartJson(result.content[0].text);
      expect(data.pluginId).toBe('test-plugin');
      expect(data.continuityMode).toBe('native');
      expect(pluginRuntime.resolveSessionMetadata).toHaveBeenCalled();
    });

    it('persists plugin metadata/capability snapshot and restores it after server restart', async () => {
      const storeDir = mkdtempSync(join(tmpdir(), 'hub-session-store-'));
      const store = new FileSessionStore(storeDir);
      try {
        const pluginRuntime = {
          resolveSessionMetadata: vi.fn(async () => ({
            plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
            capabilities: {
              pluginId: 'test-plugin',
              detectedAt: Date.now(),
              cached: true,
              supportsNativeSession: true,
              supportsNativeStart: true,
              supportsNativeContinue: true,
              nativeSessionResumeMode: 'subcommand',
            },
            continuityMode: 'native',
          })),
          buildInvocation: vi.fn(),
        };

        const persistentServer = createHubServer(
          [TEST_BACKEND],
          { idleTimeoutMs: 60_000 },
          store,
          pluginRuntime as any,
        );
        const startResult = await callTool(persistentServer, 'hub-session-start', {
          backend: 'test',
          sessionId: 'persisted-session',
        });
        const { sessionId, pluginId, continuityMode } = parseSessionStartJson(startResult.content[0].text);
        expect(sessionId).toBe('persisted-session');
        expect(pluginId).toBe('test-plugin');
        expect(continuityMode).toBe('native');

        const saved = store.load(sessionId)!;
        expect(saved.pluginId).toBe('test-plugin');
        expect(saved.continuityMode).toBe('native');
        expect(saved.capabilitySnapshot?.pluginId).toBe('test-plugin');
        expect(saved.capabilitySnapshot?.supportsNativeSession).toBe(true);

        const restartedServer = createHubServer(
          [TEST_BACKEND],
          { idleTimeoutMs: 60_000 },
          store,
          pluginRuntime as any,
        );
        const listResult = await callTool(restartedServer, 'hub-session-list', {});
        const sessions = JSON.parse(listResult.content[0].text);
        const restored = sessions.find((entry: { sessionId: string }) => entry.sessionId === sessionId);
        expect(restored).toBeDefined();
        expect(restored?.pluginId).toBe('test-plugin');
        expect(restored?.continuityMode).toBe('native');
        expect(restored?.capabilitySnapshot?.pluginId).toBe('test-plugin');
      } finally {
        rmSync(storeDir, { recursive: true, force: true });
      }
    });
  });

  describe('hub-session-message', () => {
    it('sends a message in a session with context', async () => {
      // Start session
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      // Mock CLI response for first message
      mockInvokeCli.mockResolvedValueOnce({
        content: 'First response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      // Send first message
      const msg1Result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'Hello',
      });

      expect(msg1Result.isError).toBeUndefined();
      expect(msg1Result.content[0].text).toContain('First response');

      // First message should have been called with raw prompt (no history)
      expect(mockInvokeCli).toHaveBeenCalledTimes(1);
      const firstCallPrompt = mockInvokeCli.mock.calls[0][1].prompt;
      expect(firstCallPrompt).toBe('Hello');

      // Mock CLI response for second message
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Second response',
        success: true,
        exitCode: 0,
        durationMs: 150,
        backend: 'test',
        model: 'test-model-1',
      });

      // Send second message — should include history
      const msg2Result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'Follow up',
      });

      expect(msg2Result.content[0].text).toContain('Second response');

      const secondCallPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(secondCallPrompt).toContain('<conversation_history>');
      expect(secondCallPrompt).toContain('[user]: Hello');
      expect(secondCallPrompt).toContain('[assistant]: First response');
      expect(secondCallPrompt).toContain('Follow up');
    });

    it('rejects unknown session ID', async () => {
      const result = await callTool(server, 'hub-session-message', {
        sessionId: 'nonexistent',
        message: 'hello',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session not found');
    });

    it('handles CLI failure without recording response', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: '',
        success: false,
        exitCode: 1,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
        error: 'CLI crashed',
      });

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('CLI crashed');
    });
  });

  describe('hub-session-stop', () => {
    it('stops an existing session', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      const result = await callTool(server, 'hub-session-stop', { sessionId });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('stopped');

      // Session should no longer exist
      const msgResult = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'should fail',
      });
      expect(msgResult.isError).toBe(true);
    });

    it('rejects unknown session ID', async () => {
      const result = await callTool(server, 'hub-session-stop', {
        sessionId: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session not found');
    });
  });

  describe('hub-session-list', () => {
    it('returns empty list when no sessions', async () => {
      const result = await callTool(server, 'hub-session-list', {});
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toEqual([]);
    });

    it('returns all active sessions', async () => {
      await callTool(server, 'hub-session-start', { backend: 'test' });
      await callTool(server, 'hub-session-start', { backend: 'test', model: 'other-model' });

      const result = await callTool(server, 'hub-session-list', {});
      const sessions = JSON.parse(result.content[0].text);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].backend).toBe('test');
      expect(sessions[1].backend).toBe('test');
    });
  });

  describe('hub-agent error details', () => {
    it('requires backend when sessionId is not provided', async () => {
      const result = await callTool(server, 'hub-agent', {
        prompt: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required argument: backend');
    });

    it('rejects unknown backend', async () => {
      const result = await callTool(server, 'hub-agent', {
        backend: 'unknown',
        prompt: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown or disabled backend');
    });

    it('includes errorType and retryable in error response', async () => {
      mockInvokeCli.mockResolvedValueOnce({
        content: 'stderr output',
        success: false,
        exitCode: 1,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
        error: 'Process exited with code 1',
        errorType: 'exit',
        retryable: true,
      });

      const result = await callTool(server, 'hub-agent', {
        backend: 'test',
        prompt: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error type: exit');
      expect(result.content[0].text).toContain('Retryable: yes');
      expect(result.content[0].text).toContain('Exit code: 1');
    });

    it('includes stderr warnings in success metadata', async () => {
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Response text',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
        stderr: 'some warning output',
      });

      const result = await callTool(server, 'hub-agent', {
        backend: 'test',
        prompt: 'test',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Response text');
      expect(result.content[0].text).toContain('Warnings: some warning output');
    });

    it('omits warnings when stderr is empty', async () => {
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Clean response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
        stderr: '',
      });

      const result = await callTool(server, 'hub-agent', {
        backend: 'test',
        prompt: 'test',
      });

      expect(result.content[0].text).not.toContain('Warnings');
    });

    it('rolls back session turn on CLI failure via hub-agent', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: '',
        success: false,
        exitCode: 1,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
        error: 'CLI failed',
        errorType: 'exit',
        retryable: true,
      });

      const result = await callTool(server, 'hub-agent', {
        prompt: 'will fail',
        sessionId,
      });

      expect(result.isError).toBe(true);

      // Verify the failed turn was rolled back by sending a new message
      // that should NOT contain the failed prompt in history
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Success',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'after failure',
      });

      const callPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(callPrompt).not.toContain('will fail');
      expect(callPrompt).toBe('after failure');
    });
  });

  describe('hub-session-message stageUserTurn exception', () => {
    it('returns session error when stageUserTurn throws in hub-session-message', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      // Spy on stageUserTurn to throw after getSession succeeds (hits line 420)
      const spy = vi.spyOn(HubSessionManager.prototype, 'stageUserTurn')
        .mockImplementationOnce(() => { throw new Error('Simulated stage failure'); });

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session error');
      expect(result.content[0].text).toContain('Simulated stage failure');
      spy.mockRestore();
    });
  });

  describe('hub-agent invokeWithContinuityFallback exception with rollback', () => {
    it('rolls back staged turn and returns error when invocation throws', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      // Make invokeCli reject with an exception (not a failed result, but a thrown error)
      mockInvokeCli.mockRejectedValueOnce(new Error('Unexpected spawn failure'));

      const result = await callTool(server, 'hub-agent', {
        prompt: 'will throw',
        sessionId,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Hub invocation failed');
      expect(result.content[0].text).toContain('Unexpected spawn failure');

      // Verify the failed turn was rolled back — next message should not include it in history
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Recovery response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'after throw',
      });

      const callPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(callPrompt).not.toContain('will throw');
      expect(callPrompt).toBe('after throw');
    });

    it('rolls back staged turn and returns error when hub-session-message invocation throws', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      // Make invokeCli reject with an exception on the session-message path (lines 444-449)
      mockInvokeCli.mockRejectedValueOnce(new Error('Network failure'));

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'will fail with exception',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Hub invocation failed');
      expect(result.content[0].text).toContain('Network failure');

      // Verify the failed turn was rolled back
      mockInvokeCli.mockResolvedValueOnce({
        content: 'After exception',
        success: true,
        exitCode: 0,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
      });

      await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'recovery message',
      });

      const recoveryPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(recoveryPrompt).not.toContain('will fail with exception');
      expect(recoveryPrompt).toBe('recovery message');
    });
  });

  describe('hub-session-message error details', () => {
    it('includes errorType and retryable in session message failure', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: 'error output',
        success: false,
        exitCode: 1,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
        error: 'Auth failed',
        errorType: 'auth',
        retryable: false,
      });

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error type: auth');
      expect(result.content[0].text).not.toContain('Retryable: yes');
    });

    it('includes stderr warnings in session message success metadata', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: 'Good response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
        stderr: 'deprecation warning',
      });

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'test',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Good response');
      expect(result.content[0].text).toContain('Warnings: deprecation warning');
      expect(result.content[0].text).toContain(`Session: ${sessionId}`);
    });

    it('includes retryable flag for exit errors in session message', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: '',
        success: false,
        exitCode: 2,
        durationMs: 50,
        backend: 'test',
        model: 'test-model-1',
        error: 'Process exited with code 2',
        errorType: 'exit',
        retryable: true,
      });

      const result = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Retryable: yes');
      expect(result.content[0].text).toContain('Error type: exit');
    });

    it('omits hub history for native-mode sessions', async () => {
      const pluginRuntime = {
        resolveSessionMetadata: vi.fn(async () => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
          continuityMode: 'native',
        })),
        buildInvocation: vi.fn(async ({ input, mode, isSessionStart }) => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          pluginId: 'test-plugin',
          mode: (mode as 'native' | 'hub') ?? (isSessionStart ? 'native' : 'native'),
          invocation: { args: ['--input', input.prompt] },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
        })),
      };

      const nativeServer = createHubServer([TEST_BACKEND], { idleTimeoutMs: 60_000 }, undefined, pluginRuntime as any);

      const startResult = await callTool(nativeServer, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: 'First response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      await callTool(nativeServer, 'hub-session-message', {
        sessionId,
        message: 'First message',
      });

      mockInvokeCli.mockResolvedValueOnce({
        content: 'Second response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      await callTool(nativeServer, 'hub-session-message', {
        sessionId,
        message: 'Second message',
      });

      const secondPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(secondPrompt).toBe('Second message');
      expect(mockInvokeCli).toHaveBeenCalledTimes(2);
    });

    it('falls back to hub mode on native flag errors and updates continuity metadata', async () => {
      const pluginRuntime = {
        resolveSessionMetadata: vi.fn(async () => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
          continuityMode: 'native',
        })),
        buildInvocation: vi.fn()
          .mockResolvedValueOnce({
            plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
            pluginId: 'test-plugin',
            mode: 'native',
            invocation: { args: ['--session-id', 'first'] },
            capabilities: {
              pluginId: 'test-plugin',
              detectedAt: Date.now(),
              cached: true,
              supportsNativeSession: true,
              supportsNativeStart: true,
              supportsNativeContinue: true,
            },
          })
          .mockResolvedValueOnce({
            plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
            pluginId: 'test-plugin',
            mode: 'hub',
            invocation: { args: ['second'] },
            capabilities: {
              pluginId: 'test-plugin',
              detectedAt: Date.now(),
              cached: true,
              supportsNativeSession: true,
              supportsNativeStart: true,
              supportsNativeContinue: true,
            },
          }),
        isNativeFallbackError: vi.fn(() => true),
      };

      const nativeServer = createHubServer([TEST_BACKEND], { idleTimeoutMs: 60_000 }, undefined, pluginRuntime as any);
      const startResult = await callTool(nativeServer, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: '',
        success: false,
        exitCode: 1,
        durationMs: 110,
        backend: 'test',
        model: 'test-model-1',
        error: 'unknown CLI option',
        stderr: 'unknown option: --session-id',
      });
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Recovered response',
        success: true,
        exitCode: 0,
        durationMs: 80,
        backend: 'test',
        model: 'test-model-1',
      });

      const result = await callTool(nativeServer, 'hub-session-message', {
        sessionId,
        message: 'Hello after fallback',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Recovered response');
      expect(mockInvokeCli).toHaveBeenCalledTimes(2);
      expect(pluginRuntime.buildInvocation).toHaveBeenCalledTimes(2);
      expect(pluginRuntime.buildInvocation.mock.calls[1][0].mode).toBe('hub');

      const listResult = await callTool(nativeServer, 'hub-session-list', {});
      const sessions = JSON.parse(listResult.content[0].text);
      expect(sessions[0].continuityMode).toBe('hub');
      expect(sessions[0].nativeSessionRef).toBeNull();
      expect(sessions[0].sessionId).toBe(sessionId);
    });

    it('stores native session ref when native mode succeeds', async () => {
      const pluginRuntime = {
        resolveSessionMetadata: vi.fn(async () => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
          continuityMode: 'native',
        })),
        buildInvocation: vi.fn(async () => ({
          plugin: { id: 'test-plugin', displayName: 'Test Plugin', preferredContinuity: 'native' },
          pluginId: 'test-plugin',
          mode: 'native',
          invocation: { args: ['--session-id', 'from-cli'] },
          capabilities: {
            pluginId: 'test-plugin',
            detectedAt: Date.now(),
            cached: true,
            supportsNativeSession: true,
            supportsNativeStart: true,
            supportsNativeContinue: true,
          },
        })),
      };

      const nativeServer = createHubServer([TEST_BACKEND], { idleTimeoutMs: 60_000 }, undefined, pluginRuntime as any);
      const startResult = await callTool(nativeServer, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      mockInvokeCli.mockResolvedValueOnce({
        content: 'Session-backed response',
        success: true,
        exitCode: 0,
        durationMs: 60,
        backend: 'test',
        model: 'test-model-1',
      });

      const result = await callTool(nativeServer, 'hub-session-message', {
        sessionId,
        message: 'Native message',
      });

      expect(result.isError).toBeUndefined();

      const listResult = await callTool(nativeServer, 'hub-session-list', {});
      const sessions = JSON.parse(listResult.content[0].text);
      const active = sessions.find((session: { sessionId: string }) => session.sessionId === sessionId);
      expect(active.nativeSessionRef).toBe(sessionId);
      expect(active.continuityMode).toBe('native');
    });
  });

  describe('hub-session-start with custom sessionId', () => {
    it('accepts a custom session ID', async () => {
      const result = await callTool(server, 'hub-session-start', {
        backend: 'test',
        sessionId: 'my-custom-id',
      });

      expect(result.isError).toBeUndefined();
      const data = parseSessionStartJson(result.content[0].text);
      expect(data.sessionId).toBe('my-custom-id');
    });

    it('rejects duplicate custom session ID', async () => {
      await callTool(server, 'hub-session-start', {
        backend: 'test',
        sessionId: 'duplicate-id',
      });

      const result = await callTool(server, 'hub-session-start', {
        backend: 'test',
        sessionId: 'duplicate-id',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('duplicate-id');
    });
  });

  describe('sessionId on hub-agent', () => {
    it('augments prompt when sessionId is provided', async () => {
      // Start a session
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      // First call via hub-session-message to establish history
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Response 1',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });
      await callTool(server, 'hub-session-message', { sessionId, message: 'Question 1' });

      // Now use hub-agent directly with sessionId
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Response 2',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      const result = await callTool(server, 'hub-agent', {
        prompt: 'Question 2',
        sessionId,
      });

      expect(result.isError).toBeUndefined();

      // The prompt should include history
      const callPrompt = mockInvokeCli.mock.calls[1][1].prompt;
      expect(callPrompt).toContain('<conversation_history>');
      expect(callPrompt).toContain('[user]: Question 1');
      expect(callPrompt).toContain('[assistant]: Response 1');
      expect(callPrompt).toContain('Question 2');
    });

    it('works normally without sessionId (stateless)', async () => {
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Stateless response',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      const result = await callTool(server, 'hub-agent', {
        backend: 'test',
        prompt: 'Hello stateless',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Stateless response');

      // Prompt should be passed through unchanged
      expect(mockInvokeCli.mock.calls[0][1].prompt).toBe('Hello stateless');
    });

    it('returns error for invalid sessionId on hub-agent', async () => {
      const result = await callTool(server, 'hub-agent', {
        prompt: 'test',
        sessionId: 'bad-id',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session not found');
    });

    it('returns error for backend mismatch with an existing session', async () => {
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = parseSessionStartJson(startResult.content[0].text);

      const result = await callTool(server, 'hub-agent', {
        backend: 'other',
        prompt: 'test',
        sessionId,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session backend mismatch');
    });
  });
});
