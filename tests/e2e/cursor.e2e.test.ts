import { describe, it, expect } from 'vitest';
import { skipUnless } from './setup.js';
import { invokeCli } from '../../src/cli-invoker.js';
import { getDefaultBackend } from '../../src/backends.js';
import type { BackendConfig } from '../../src/types.js';

const skipReason = skipUnless('cursor-agent', 'CURSOR_API_KEY');
const config = getDefaultBackend('cursor') as BackendConfig;

const run = skipReason ? describe.skip : describe;

run('Cursor CLI E2E', () => {
  it('returns a response for a simple prompt', async () => {
    const result = await invokeCli(config, {
      prompt: 'What is 2+2? Reply with just the number.',
      model: 'gemini-2.5-flash',
      timeoutMs: 60_000,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
  }, 60_000);
});
