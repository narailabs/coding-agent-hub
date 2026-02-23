import { describe, it, expect } from 'vitest';
import { skipUnless, assertMathResponse, assertContentQuality } from './setup.js';
import { invokeCli } from '../../src/cli-invoker.js';
import { getDefaultBackend } from '../../src/backends.js';
import type { BackendConfig } from '../../src/types.js';

const skipReason = skipUnless('claude', 'ANTHROPIC_API_KEY');
const config = getDefaultBackend('claude') as BackendConfig;

const run = skipReason ? describe.skip : describe;

run('Claude CLI E2E', () => {
  it('returns a correct response for a math prompt', async () => {
    const result = await invokeCli(config, {
      prompt: 'What is 2+2? Reply with just the number.',
      timeoutMs: 120_000,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.backend).toBe('claude');
    expect(result.durationMs).toBeGreaterThan(0);
    assertContentQuality(result.content);
    assertMathResponse(result.content);
  }, 120_000);
});
