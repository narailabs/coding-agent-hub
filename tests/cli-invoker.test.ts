import { describe, it, expect } from 'vitest';
import { buildArgs, buildEnv } from '../src/cli-invoker.js';
import type { BackendConfig, ToolInput } from '../src/types.js';

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

describe('buildArgs', () => {
  it('builds claude args with --print and --model', () => {
    const config = makeConfig({ argBuilder: 'claude', defaultModel: 'claude-sonnet-4-5' });
    const args = buildArgs(config, makeInput());

    expect(args).toContain('--print');
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-5');
    expect(args).toContain('Hello, world');
  });

  it('uses model override for claude', () => {
    const config = makeConfig({ argBuilder: 'claude', defaultModel: 'claude-sonnet-4-5' });
    const args = buildArgs(config, makeInput({ model: 'claude-opus-4-5' }));

    expect(args).toContain('claude-opus-4-5');
    expect(args).not.toContain('claude-sonnet-4-5');
  });

  it('builds gemini args with -p and --yolo', () => {
    const config = makeConfig({ argBuilder: 'gemini', defaultModel: 'gemini-2.5-pro' });
    const args = buildArgs(config, makeInput());

    expect(args).toContain('-p');
    expect(args).toContain('--yolo');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('-m');
    expect(args).toContain('gemini-2.5-pro');
  });

  it('includes --include-directories for gemini with workingDir', () => {
    const config = makeConfig({ argBuilder: 'gemini' });
    const args = buildArgs(config, makeInput({ workingDir: '/tmp/project' }));

    expect(args).toContain('--include-directories');
    expect(args).toContain('/tmp/project');
  });

  it('builds codex args with exec and --full-auto', () => {
    const config = makeConfig({ argBuilder: 'codex', defaultModel: 'codex-1' });
    const args = buildArgs(config, makeInput());

    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--full-auto');
    expect(args).toContain('--model');
    expect(args).toContain('codex-1');
  });

  it('includes --cd for codex with workingDir', () => {
    const config = makeConfig({ argBuilder: 'codex' });
    const args = buildArgs(config, makeInput({ workingDir: '/tmp/project' }));

    expect(args).toContain('--cd');
    expect(args).toContain('/tmp/project');
  });

  it('builds generic args as just the prompt', () => {
    const config = makeConfig({ argBuilder: 'generic' });
    const args = buildArgs(config, makeInput());

    expect(args).toEqual(['Hello, world']);
  });
});

describe('buildEnv', () => {
  it('includes PATH and HOME from process.env', () => {
    const config = makeConfig();
    const env = buildEnv(config);

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });

  it('includes auth env var when configured and present', () => {
    const original = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';

    const config = makeConfig({ authEnvVar: 'GEMINI_API_KEY' });
    const env = buildEnv(config);

    expect(env.GEMINI_API_KEY).toBe('test-key');

    if (original !== undefined) {
      process.env.GEMINI_API_KEY = original;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('does not include CLAUDE_* vars', () => {
    const original = process.env.CLAUDE_SESSION_KEY;
    process.env.CLAUDE_SESSION_KEY = 'secret';

    const config = makeConfig();
    const env = buildEnv(config);

    expect(env.CLAUDE_SESSION_KEY).toBeUndefined();

    if (original !== undefined) {
      process.env.CLAUDE_SESSION_KEY = original;
    } else {
      delete process.env.CLAUDE_SESSION_KEY;
    }
  });

  it('does not include auth env var when not in process.env', () => {
    delete process.env.MISSING_KEY;

    const config = makeConfig({ authEnvVar: 'MISSING_KEY' });
    const env = buildEnv(config);

    expect(env.MISSING_KEY).toBeUndefined();
  });
});
