import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildArgs, buildEnv, invokeCli } from '../src/cli-invoker.js';
import type { BackendConfig, ToolInput } from '../src/types.js';
import type { AgentPlugin } from '../src/plugins/types.js';

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
    const config = makeConfig({ argBuilder: 'codex', defaultModel: 'gpt-5.3-codex-spark' });
    const args = buildArgs(config, makeInput());

    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--full-auto');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.3-codex-spark');
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

// ─── invokeCli ───────────────────────────────────────────────────
// Uses a real executable test helper script for realistic coverage.
// The generic adapter passes `[prompt]` as a single arg, so we use
// the prompt as a command/action that the helper script dispatches.

describe('invokeCli', () => {
  let helperScript: string;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cli-invoker-test-'));
    helperScript = join(tmpDir, 'test-cli.mjs');
    writeFileSync(
      helperScript,
      [
        '#!/usr/bin/env node',
        'const action = process.argv[2];',
        'switch (action) {',
        '  case "echo":',
        '    process.stdout.write("Hello from the CLI test output that is long enough");',
        '    break;',
        '  case "exit42":',
        '    process.exit(42);',
        '  case "auth-401":',
        '    process.stderr.write("Error 401 Unauthorized");',
        '    process.exit(1);',
        '  case "auth-apikey":',
        '    process.stderr.write("Invalid API key provided");',
        '    process.exit(1);',
        '  case "stderr-and-stdout":',
        '    process.stderr.write("debug info");',
        '    process.stdout.write("Response content is long enough.");',
        '    break;',
        '  case "short-output":',
        '    process.stdout.write("hi");',
        '    break;',
        '  case "sleep":',
        '    setTimeout(() => {}, 60000);',
        '    break;',
        '  case "empty":',
        '    break;',
        '  default:',
        '    // For stdin delivery: read stdin and echo it',
        '    let data = "";',
        '    process.stdin.setEncoding("utf-8");',
        '    process.stdin.on("data", (c) => { data += c; });',
        '    process.stdin.on("end", () => {',
        '      if (data) process.stdout.write("stdin:" + data);',
        '      else process.stdout.write("no-action-no-stdin");',
        '    });',
        '    break;',
        '}',
      ].join('\n'),
      { mode: 0o755 },
    );
    chmodSync(helperScript, 0o755);
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function cliConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
    return makeConfig({ command: helperScript, argBuilder: 'generic', ...overrides });
  }

  it('returns success with content on exit 0', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'echo' }));

    expect(result.success).toBe(true);
    expect(result.content).toBe('Hello from the CLI test output that is long enough');
    expect(result.exitCode).toBe(0);
    expect(result.backend).toBe('test');
    expect(result.model).toBe('test-1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles non-zero exit code as exit error', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'exit42' }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
    expect(result.errorType).toBe('exit');
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('42');
  });

  it('detects auth error from 401 stderr pattern', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'auth-401' }));

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('auth');
    expect(result.exitCode).toBe(1);
  });

  it('detects auth error from API key stderr pattern', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'auth-apikey' }));

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('auth');
  });

  it('captures stderr on success', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'stderr-and-stdout' }));

    expect(result.success).toBe(true);
    expect(result.stderr).toBe('debug info');
    expect(result.content).toContain('Response content');
  });

  it('reports parse error when exit 0 but output too short for extractor', async () => {
    // Generic extractor has 10-char minimum
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'short-output' }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.errorType).toBe('parse');
    expect(result.error).toContain('extract');
  });

  it('handles timeout with abort', async () => {
    const result = await invokeCli(
      cliConfig({ timeoutMs: 100 }),
      makeInput({ prompt: 'sleep' }),
    );

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('timeout');
    expect(result.timedOut).toBe(true);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('Timeout');
    expect(result.exitCode).toBeNull();
  });

  it('handles spawn failure for nonexistent command', async () => {
    const config = makeConfig({
      command: 'totally-nonexistent-command-xyz',
      argBuilder: 'generic',
    });
    const result = await invokeCli(config, makeInput());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
  });

  it('uses timeout override from input', async () => {
    const result = await invokeCli(
      cliConfig({ timeoutMs: 60_000 }),
      makeInput({ prompt: 'sleep', timeoutMs: 100 }),
    );

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('uses model override from input', async () => {
    const result = await invokeCli(
      cliConfig({ defaultModel: 'default-model' }),
      makeInput({ prompt: 'echo', model: 'override-model' }),
    );

    expect(result.model).toBe('override-model');
  });

  it('delivers prompt via stdin when adapter supports it', async () => {
    // Claude adapter has promptDelivery: 'stdin', so invokeCli writes prompt to stdin
    // Our helper script's default case reads stdin and echoes it prefixed with "stdin:"
    const result = await invokeCli(
      cliConfig({ argBuilder: 'claude' }),
      makeInput({ prompt: 'hello from stdin test' }),
    );

    // The script's default case reads stdin and outputs "stdin:<prompt>"
    // Claude adapter extracts plain text (no 10-char min)
    expect(result.success).toBe(true);
    expect(result.content).toBe('stdin:hello from stdin test');
  });

  it('reports parse error when exit 0 but empty output', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'empty' }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.errorType).toBe('parse');
  });

  it('populates stderr field on errors', async () => {
    const result = await invokeCli(cliConfig(), makeInput({ prompt: 'auth-401' }));

    expect(result.stderr).toContain('401');
  });

  it('uses plugin parser for response extraction', async () => {
    let parsed = '';
    const plugin = {
      id: 'test-plugin',
      displayName: 'Test',
      preferredContinuity: 'hub',
      matches: () => true,
      detectCapabilities: async () => ({
        pluginId: 'test-plugin',
        detectedAt: Date.now(),
        cached: true,
        supportsNativeSession: false,
      }),
      buildOneShotInvocation: async () => ({ args: ['echo'] }),
      buildNativeStartInvocation: async () => ({ args: ['echo'] }),
      buildNativeContinueInvocation: async () => ({ args: ['echo'] }),
      extractResponse: (stdout: string) => {
        parsed = stdout.toUpperCase();
        return { content: parsed };
      },
      fallbackCapabilities: () => ({
        pluginId: 'test-plugin',
        detectedAt: Date.now(),
        cached: true,
        supportsNativeSession: false,
      }),
    } as unknown as AgentPlugin;

    const result = await invokeCli(cliConfig({ argBuilder: 'generic' }), makeInput({ prompt: 'ignored' }), {
      invocation: { args: ['echo'] },
      plugin,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe(parsed);
    expect(parsed).toBe('HELLO FROM THE CLI TEST OUTPUT THAT IS LONG ENOUGH');
  });

  it('passes result through plugin error classifier', async () => {
    let classified = false;
    const plugin = {
      id: 'test-plugin',
      displayName: 'Test',
      preferredContinuity: 'hub',
      matches: () => true,
      detectCapabilities: async () => ({
        pluginId: 'test-plugin',
        detectedAt: Date.now(),
        cached: true,
        supportsNativeSession: false,
      }),
      buildOneShotInvocation: async () => ({ args: ['exit42'] }),
      buildNativeStartInvocation: async () => ({ args: ['exit42'] }),
      buildNativeContinueInvocation: async () => ({ args: ['exit42'] }),
      extractResponse: () => undefined,
      classifyError: (result) => {
        classified = true;
        return { ...result, retryable: false };
      },
      fallbackCapabilities: () => ({
        pluginId: 'test-plugin',
        detectedAt: Date.now(),
        cached: true,
        supportsNativeSession: false,
      }),
    } as unknown as AgentPlugin;

    const result = await invokeCli(cliConfig({ argBuilder: 'generic' }), makeInput({ prompt: 'ignored' }), {
      invocation: { args: ['exit42'] },
      plugin,
    });

    expect(classified).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.exitCode).toBe(42);
  });
});
