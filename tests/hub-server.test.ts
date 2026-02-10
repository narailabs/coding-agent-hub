import { describe, it, expect } from 'vitest';
import { createHubServer, buildToolDescription } from '../src/hub-server.js';
import { DEFAULT_BACKENDS } from '../src/backends.js';
import type { BackendConfig } from '../src/types.js';

describe('buildToolDescription', () => {
  it('includes display name and default model', () => {
    const config: BackendConfig = {
      name: 'gemini',
      displayName: 'Gemini CLI',
      command: 'gemini',
      enabled: true,
      defaultModel: 'gemini-2.5-pro',
      timeoutMs: 120_000,
      argBuilder: 'gemini',
    };

    const desc = buildToolDescription(config);
    expect(desc).toContain('Gemini CLI');
    expect(desc).toContain('gemini-2.5-pro');
    expect(desc).toContain('web search');
  });

  it('includes Claude-specific description', () => {
    const config: BackendConfig = {
      name: 'claude',
      displayName: 'Claude Code',
      command: 'claude',
      enabled: true,
      defaultModel: 'claude-sonnet-4-5',
      timeoutMs: 120_000,
      argBuilder: 'claude',
    };

    const desc = buildToolDescription(config);
    expect(desc).toContain('Claude Code');
    expect(desc).toContain('reasoning');
  });

  it('includes Codex-specific description', () => {
    const config: BackendConfig = {
      name: 'codex',
      displayName: 'Codex CLI',
      command: 'codex',
      enabled: true,
      defaultModel: 'codex-1',
      timeoutMs: 120_000,
      argBuilder: 'codex',
    };

    const desc = buildToolDescription(config);
    expect(desc).toContain('Codex');
    expect(desc).toContain('code implementation');
  });

  it('handles generic backend without crashing', () => {
    const config: BackendConfig = {
      name: 'custom',
      displayName: 'Custom Agent',
      command: 'custom-cli',
      enabled: true,
      defaultModel: 'custom-1',
      timeoutMs: 60_000,
      argBuilder: 'generic',
    };

    const desc = buildToolDescription(config);
    expect(desc).toContain('Custom Agent');
    expect(desc).toContain('custom-1');
  });
});

describe('createHubServer', () => {
  it('creates a server from default backends', () => {
    const server = createHubServer(DEFAULT_BACKENDS);
    expect(server).toBeDefined();
  });

  it('filters out disabled backends', () => {
    const configs = DEFAULT_BACKENDS.map((b) => ({
      ...b,
      enabled: b.name === 'gemini',
    }));

    const server = createHubServer(configs);
    expect(server).toBeDefined();
  });

  it('creates server with no enabled backends (empty tools)', () => {
    const configs = DEFAULT_BACKENDS.map((b) => ({ ...b, enabled: false }));
    const server = createHubServer(configs);
    expect(server).toBeDefined();
  });
});
