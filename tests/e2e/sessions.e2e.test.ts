import { describe, it, expect } from 'vitest';
import { skipUnless } from './setup.js';
import { createHubServer } from '../../src/hub-server.js';
import { DEFAULT_BACKENDS } from '../../src/backends.js';

/**
 * Helper to call a tool on the MCP server by extracting the handler.
 */
async function callTool(server: ReturnType<typeof createHubServer>, toolName: string, args: Record<string, unknown>) {
  const registeredTools = (server as any)._registeredTools as Record<string, any>;
  const tool = registeredTools?.[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found. Available: ${Object.keys(registeredTools ?? {}).join(', ')}`);
  }
  return tool.handler(args);
}

/*
 * Multi-turn session E2E tests.
 *
 * These test real backend CLIs through the hub's session tools,
 * verifying that conversation context is preserved across turns.
 */

// --- Hub-managed sessions (Gemini — prefers hub continuity) ---

const geminiSkip = skipUnless('gemini', 'GEMINI_API_KEY');
const runGemini = geminiSkip ? describe.skip : describe;

runGemini('Hub-managed session (Gemini)', () => {
  it('retains context across turns via hub history', async () => {
    const server = createHubServer(DEFAULT_BACKENDS, { idleTimeoutMs: 300_000 });

    // Start session
    const startResult = await callTool(server, 'hub-session-start', { backend: 'gemini' });
    expect(startResult.isError).toBeUndefined();
    const { sessionId } = JSON.parse(startResult.content[0].text);
    expect(sessionId).toBeDefined();

    try {
      // Turn 1: Tell it a name to remember
      const turn1 = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'My name is Alice. Remember it. Reply with just "OK".',
      });
      expect(turn1.isError).toBeUndefined();
      expect(turn1.content[0].text.length).toBeGreaterThan(0);

      // Turn 2: Ask it to recall the name — proves hub correctly prepends conversation history
      const turn2 = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'What is my name? Reply with just the name.',
      });
      expect(turn2.isError).toBeUndefined();
      expect(turn2.content[0].text.toLowerCase()).toContain('alice');
    } finally {
      // Cleanup
      await callTool(server, 'hub-session-stop', { sessionId });
    }
  }, 300_000);
});

// --- Native continuity sessions (Claude — prefers native, has --continue) ---

const claudeSkip = skipUnless('claude', 'ANTHROPIC_API_KEY');
const runClaude = claudeSkip ? describe.skip : describe;

runClaude('Native continuity session (Claude)', () => {
  it('retains context across turns via native session', async () => {
    const server = createHubServer(DEFAULT_BACKENDS, { idleTimeoutMs: 300_000 });

    const startResult = await callTool(server, 'hub-session-start', { backend: 'claude' });
    expect(startResult.isError).toBeUndefined();
    const { sessionId } = JSON.parse(startResult.content[0].text);
    expect(sessionId).toBeDefined();

    try {
      // Turn 1: Tell it a name to remember
      const turn1 = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'My name is Bob. Remember it. Reply with just "OK".',
      });
      expect(turn1.isError).toBeUndefined();
      expect(turn1.content[0].text.length).toBeGreaterThan(0);

      // Turn 2: Ask it to recall — proves native session continuity works
      const turn2 = await callTool(server, 'hub-session-message', {
        sessionId,
        message: 'What is my name? Reply with just the name.',
      });
      expect(turn2.isError).toBeUndefined();
      expect(turn2.content[0].text.toLowerCase()).toContain('bob');
    } finally {
      await callTool(server, 'hub-session-stop', { sessionId });
    }
  }, 300_000);
});

// --- Session lifecycle (uses whichever backend is available) ---

// Try Claude first, then Gemini, then Codex
const lifecycleBackend = !skipUnless('claude', 'ANTHROPIC_API_KEY') ? 'claude'
  : !skipUnless('gemini', 'GEMINI_API_KEY') ? 'gemini'
  : !skipUnless('codex', 'OPENAI_API_KEY') ? 'codex'
  : null;

const lifecycleSkip = lifecycleBackend === null;
const runLifecycle = lifecycleSkip ? describe.skip : describe;

runLifecycle(`Session lifecycle (${lifecycleBackend})`, () => {
  it('start → message → stop → message-after-stop fails', async () => {
    const server = createHubServer(DEFAULT_BACKENDS, { idleTimeoutMs: 300_000 });

    // Start
    const startResult = await callTool(server, 'hub-session-start', { backend: lifecycleBackend! });
    const { sessionId } = JSON.parse(startResult.content[0].text);
    expect(sessionId).toBeDefined();

    // Send a message
    const msgResult = await callTool(server, 'hub-session-message', {
      sessionId,
      message: 'What is 2+2? Reply with just the number.',
    });
    expect(msgResult.isError).toBeUndefined();
    expect(msgResult.content[0].text).toContain('4');

    // Stop the session
    const stopResult = await callTool(server, 'hub-session-stop', { sessionId });
    expect(stopResult.isError).toBeUndefined();

    // Message after stop should fail
    const afterStop = await callTool(server, 'hub-session-message', {
      sessionId,
      message: 'This should fail.',
    });
    expect(afterStop.isError).toBe(true);
    expect(afterStop.content[0].text).toContain('Session not found');
  }, 300_000);
});
