import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkBackend, runPreflightChecks } from '../src/preflight.js';
import type { BackendConfig } from '../src/types.js';

function makeConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    name: 'test',
    displayName: 'Test',
    command: 'node', // node should always be available
    enabled: true,
    defaultModel: 'test-1',
    timeoutMs: 30_000,
    argBuilder: 'generic',
    ...overrides,
  };
}

describe('checkBackend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports cliFound=true for a command that exists (node)', () => {
    const result = checkBackend(makeConfig({ command: 'node' }));
    expect(result.cliFound).toBe(true);
    expect(result.warnings).not.toContainEqual(expect.stringContaining('not found'));
  });

  it('reports cliFound=false for a nonexistent command', () => {
    const result = checkBackend(makeConfig({ command: 'totally-nonexistent-binary-xyz' }));
    expect(result.cliFound).toBe(false);
    expect(result.warnings).toContainEqual(expect.stringContaining('not found'));
  });

  it('reports authConfigured=true when env var is set', () => {
    const original = process.env.TEST_AUTH_KEY;
    process.env.TEST_AUTH_KEY = 'secret';

    const result = checkBackend(makeConfig({ authEnvVar: 'TEST_AUTH_KEY' }));
    expect(result.authConfigured).toBe(true);

    if (original !== undefined) {
      process.env.TEST_AUTH_KEY = original;
    } else {
      delete process.env.TEST_AUTH_KEY;
    }
  });

  it('reports authConfigured=false when env var is missing', () => {
    delete process.env.MISSING_AUTH_VAR;

    const result = checkBackend(makeConfig({ authEnvVar: 'MISSING_AUTH_VAR' }));
    expect(result.authConfigured).toBe(false);
    expect(result.warnings).toContainEqual(expect.stringContaining('MISSING_AUTH_VAR'));
  });

  it('reports authConfigured=true when no authEnvVar configured', () => {
    const result = checkBackend(makeConfig({ authEnvVar: undefined }));
    expect(result.authConfigured).toBe(true);
  });
});

describe('runPreflightChecks', () => {
  it('only checks enabled backends', () => {
    const configs = [
      makeConfig({ name: 'enabled', enabled: true, command: 'node' }),
      makeConfig({ name: 'disabled', enabled: false, command: 'totally-nonexistent-binary-xyz' }),
    ];

    const results = runPreflightChecks(configs);
    expect(results).toHaveLength(1);
    expect(results[0].backend).toBe('enabled');
  });

  it('returns results for all enabled backends', () => {
    const configs = [
      makeConfig({ name: 'a', command: 'node' }),
      makeConfig({ name: 'b', command: 'node' }),
    ];

    const results = runPreflightChecks(configs);
    expect(results).toHaveLength(2);
  });
});
