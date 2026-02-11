import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHubServer } from '../src/hub-server.js';
import type { BackendConfig } from '../src/types.js';

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
      const data = JSON.parse(result.content[0].text);
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

      const data = JSON.parse(result.content[0].text);
      expect(data.sessionId).toBeDefined();
      expect(data.model).toBe('custom-model');
    });
  });

  describe('hub-session-message', () => {
    it('sends a message in a session with context', async () => {
      // Start session
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = JSON.parse(startResult.content[0].text);

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
      const { sessionId } = JSON.parse(startResult.content[0].text);

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
      const { sessionId } = JSON.parse(startResult.content[0].text);

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

  describe('sessionId on existing backend tools', () => {
    it('augments prompt when sessionId is provided', async () => {
      // Start a session
      const startResult = await callTool(server, 'hub-session-start', { backend: 'test' });
      const { sessionId } = JSON.parse(startResult.content[0].text);

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

      // Now use the backend tool directly with sessionId
      mockInvokeCli.mockResolvedValueOnce({
        content: 'Response 2',
        success: true,
        exitCode: 0,
        durationMs: 100,
        backend: 'test',
        model: 'test-model-1',
      });

      const result = await callTool(server, 'test-agent', {
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

      const result = await callTool(server, 'test-agent', {
        prompt: 'Hello stateless',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Stateless response');

      // Prompt should be passed through unchanged
      expect(mockInvokeCli.mock.calls[0][1].prompt).toBe('Hello stateless');
    });

    it('returns error for invalid sessionId on backend tool', async () => {
      const result = await callTool(server, 'test-agent', {
        prompt: 'test',
        sessionId: 'bad-id',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Session error');
    });
  });
});
