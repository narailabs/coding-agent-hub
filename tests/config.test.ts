import { describe, it, expect, vi } from 'vitest';
import { resolveBackends, parseArgs, getDefaultConfigPath, loadConfigFile } from '../src/config.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HubConfig } from '../src/types.js';

describe('getDefaultConfigPath', () => {
  it('returns a path under home directory', () => {
    const path = getDefaultConfigPath();
    expect(path).toContain('.coding-agent-hub');
    expect(path).toContain('config.json');
  });
});

describe('loadConfigFile', () => {
  let tmpDir: string;

  it('loads valid JSON config file', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'config-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({ defaultTimeoutMs: 60000 }));

    const config = loadConfigFile(configPath);
    expect(config).not.toBeNull();
    expect(config!.defaultTimeoutMs).toBe(60000);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for nonexistent file', () => {
    expect(loadConfigFile('/nonexistent/path/config.json')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'config-test-'));
    const configPath = join(tmpDir, 'config.json');
    writeFileSync(configPath, 'not valid json {{{');

    expect(loadConfigFile(configPath)).toBeNull();

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('resolveBackends', () => {
  it('returns all three defaults when config is null', () => {
    const backends = resolveBackends(null);
    expect(backends).toHaveLength(3);

    const names = backends.map((b) => b.name);
    expect(names).toContain('claude');
    expect(names).toContain('gemini');
    expect(names).toContain('codex');
  });

  it('all defaults are enabled', () => {
    const backends = resolveBackends(null);
    expect(backends.every((b) => b.enabled)).toBe(true);
  });

  it('applies backend overrides from config', () => {
    const config: HubConfig = {
      backends: {
        gemini: { defaultModel: 'gemini-2.0-flash' },
      },
    };

    const backends = resolveBackends(config);
    const gemini = backends.find((b) => b.name === 'gemini');
    expect(gemini?.defaultModel).toBe('gemini-2.0-flash');
  });

  it('filters to only requested backends', () => {
    const backends = resolveBackends(null, ['gemini', 'codex']);

    const gemini = backends.find((b) => b.name === 'gemini');
    const codex = backends.find((b) => b.name === 'codex');
    const claude = backends.find((b) => b.name === 'claude');

    expect(gemini?.enabled).toBe(true);
    expect(codex?.enabled).toBe(true);
    expect(claude?.enabled).toBe(false);
  });

  it('applies global default timeout', () => {
    const config: HubConfig = {
      defaultTimeoutMs: 60_000,
    };

    const backends = resolveBackends(config);
    expect(backends.every((b) => b.timeoutMs === 60_000)).toBe(true);
  });

  it('does not override per-backend timeout with global', () => {
    const config: HubConfig = {
      defaultTimeoutMs: 60_000,
      backends: {
        gemini: { timeoutMs: 300_000 },
      },
    };

    const backends = resolveBackends(config);
    const gemini = backends.find((b) => b.name === 'gemini');
    expect(gemini?.timeoutMs).toBe(300_000);
  });

  it('adds custom backends with all required fields', () => {
    const config: HubConfig = {
      backends: {
        qwen: {
          displayName: 'Qwen CLI',
          command: 'qwen',
          defaultModel: 'qwen-2.5-coder',
        },
      },
    };

    const backends = resolveBackends(config);
    const qwen = backends.find((b) => b.name === 'qwen');
    expect(qwen).toBeDefined();
    expect(qwen?.displayName).toBe('Qwen CLI');
    expect(qwen?.argBuilder).toBe('generic');
  });

  it('ignores custom backends missing required fields and warns', () => {
    const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config: HubConfig = {
      backends: {
        incomplete: {
          displayName: 'Incomplete',
          // missing command and defaultModel
        },
      },
    };

    const backends = resolveBackends(config);
    const incomplete = backends.find((b) => b.name === 'incomplete');
    expect(incomplete).toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('missing required fields'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('command'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('defaultModel'));

    mockWarn.mockRestore();
  });

  it('warns about unknown config keys in custom backends', () => {
    const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config: HubConfig = {
      backends: {
        custom: {
          displayName: 'Custom',
          command: 'custom-cli',
          defaultModel: 'custom-1',
          unknownKey: 'value',
        } as any,
      },
    };

    const backends = resolveBackends(config);
    const custom = backends.find((b) => b.name === 'custom');
    expect(custom).toBeDefined();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('unknown config keys'));
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('unknownKey'));

    mockWarn.mockRestore();
  });

  it('skips null overrides entries', () => {
    const config: HubConfig = {
      backends: {
        claude: null as any,
      },
    };

    const backends = resolveBackends(config);
    const claude = backends.find((b) => b.name === 'claude');
    expect(claude).toBeDefined();
    // Should still have original defaults
    expect(claude?.command).toBe('claude');
  });

  it('custom backend inherits explicit enabled, authEnvVar, and argBuilder', () => {
    const config: HubConfig = {
      backends: {
        mybackend: {
          displayName: 'My Backend',
          command: 'my-cli',
          defaultModel: 'my-model',
          enabled: false,
          authEnvVar: 'MY_API_KEY',
          argBuilder: 'claude',
        },
      },
    };

    const backends = resolveBackends(config);
    const myBackend = backends.find((b) => b.name === 'mybackend');
    expect(myBackend).toBeDefined();
    expect(myBackend!.enabled).toBe(false);
    expect(myBackend!.authEnvVar).toBe('MY_API_KEY');
    expect(myBackend!.argBuilder).toBe('claude');
  });

  it('custom backend uses hubConfig.defaultTimeoutMs when no per-backend timeout', () => {
    const config: HubConfig = {
      defaultTimeoutMs: 45_000,
      backends: {
        newbackend: {
          displayName: 'New',
          command: 'new-cli',
          defaultModel: 'new-1',
        },
      },
    };

    const backends = resolveBackends(config);
    const newBackend = backends.find((b) => b.name === 'newbackend');
    expect(newBackend!.timeoutMs).toBe(45_000);
  });

  it('custom backend uses own timeoutMs over global default', () => {
    const config: HubConfig = {
      defaultTimeoutMs: 45_000,
      backends: {
        newbackend: {
          displayName: 'New',
          command: 'new-cli',
          defaultModel: 'new-1',
          timeoutMs: 99_000,
        },
      },
    };

    const backends = resolveBackends(config);
    const newBackend = backends.find((b) => b.name === 'newbackend');
    expect(newBackend!.timeoutMs).toBe(99_000);
  });
});

describe('parseArgs', () => {
  it('parses --config flag', () => {
    const result = parseArgs(['--config', '/path/to/config.json']);
    expect(result.configPath).toBe('/path/to/config.json');
  });

  it('parses --backends flag', () => {
    const result = parseArgs(['--backends', 'gemini,codex']);
    expect(result.backends).toEqual(['gemini', 'codex']);
  });

  it('parses both flags together', () => {
    const result = parseArgs([
      '--config', '/path/config.json',
      '--backends', 'claude',
    ]);
    expect(result.configPath).toBe('/path/config.json');
    expect(result.backends).toEqual(['claude']);
  });

  it('returns empty object for no args', () => {
    const result = parseArgs([]);
    expect(result.configPath).toBeUndefined();
    expect(result.backends).toBeUndefined();
  });

  it('parses valid --session-timeout', () => {
    const result = parseArgs(['--session-timeout', '60000']);
    expect(result.sessionTimeoutMs).toBe(60000);
  });

  it('rejects NaN --session-timeout', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['--session-timeout', 'abc'])).toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Invalid --session-timeout'));

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('rejects negative --session-timeout', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['--session-timeout', '-1'])).toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Invalid --session-timeout'));

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('rejects zero --session-timeout', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['--session-timeout', '0'])).toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Invalid --session-timeout'));

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('rejects too-large --session-timeout', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs(['--session-timeout', '99999999'])).toThrow('exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Invalid --session-timeout'));

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it('handles --help flag', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => parseArgs(['--help'])).toThrow('exit');
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('coding-agent-hub'));
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('--config'));
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('--backends'));

    mockExit.mockRestore();
    mockLog.mockRestore();
  });

  it('handles -h flag', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(() => parseArgs(['-h'])).toThrow('exit');
    expect(mockLog).toHaveBeenCalled();

    mockExit.mockRestore();
    mockLog.mockRestore();
  });

  it('ignores flags without values', () => {
    const result = parseArgs(['--config']);
    expect(result.configPath).toBeUndefined();
  });
});
