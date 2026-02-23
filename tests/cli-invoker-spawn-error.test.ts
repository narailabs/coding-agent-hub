import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BackendConfig, ToolInput } from '../src/types.js';

/**
 * Tests for the synchronous spawn() throw path in cli-invoker (lines 118-131).
 * Uses vi.mock to make child_process.spawn throw synchronously.
 */

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('Simulated synchronous spawn failure');
  }),
}));

import { invokeCli } from '../src/cli-invoker.js';

function makeConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    name: 'test',
    displayName: 'Test',
    command: 'test-cli',
    enabled: true,
    defaultModel: 'test-1',
    timeoutMs: 30_000,
    argBuilder: 'generic',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolInput> = {}): ToolInput {
  return {
    prompt: 'Hello, world',
    ...overrides,
  };
}

describe('invokeCli spawn() synchronous throw', () => {
  it('returns error result with errorType spawn when spawn throws synchronously', async () => {
    const result = await invokeCli(makeConfig(), makeInput());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toContain('Failed to spawn');
    expect(result.error).toContain('Simulated synchronous spawn failure');
    expect(result.errorType).toBe('spawn');
    expect(result.retryable).toBe(false);
    expect(result.backend).toBe('test');
    expect(result.content).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
