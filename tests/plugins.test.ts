import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRuntime } from '../src/plugins/runtime.js';
import { LegacyAdapterPlugin } from '../src/plugins/legacy-adapter-plugin.js';
import { PluginRegistry } from '../src/plugins/registry.js';
import {
  extractCliFlags,
  chooseFlag,
  detectCliHelpAndVersion,
} from '../src/plugins/cli-probe.js';
import type { BackendConfig, ToolInput, ToolResult } from '../src/types.js';
import type { PluginCapabilitySnapshot } from '../src/plugins/types.js';
import type { BackendAdapter } from '../src/adapters/types.js';

// Mock child_process at module level for ESM compatibility
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

function makeConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    name: 'backend',
    displayName: 'Backend',
    command: 'test-cli',
    enabled: true,
    defaultModel: 'model-1',
    timeoutMs: 30_000,
    argBuilder: 'generic',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolInput> = {}): ToolInput {
  return {
    prompt: 'Hello',
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<BackendAdapter> = {}): BackendAdapter {
  return {
    promptDelivery: 'arg',
    buildArgs: (input, model) => [input.prompt, '--model', model],
    extractResponse: (stdout) => ({ content: stdout, metadata: { extractedFromStdout: true, exitCode: 0 } }),
    buildDescription: () => 'Test backend',
    ...overrides,
  };
}

function makeCapabilities(overrides: Partial<PluginCapabilitySnapshot> = {}): PluginCapabilitySnapshot {
  return {
    pluginId: 'test',
    detectedAt: Date.now(),
    cached: false,
    supportsNativeSession: false,
    supportsNativeStart: false,
    supportsNativeContinue: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// cli-probe.ts
// ---------------------------------------------------------------------------
describe('cli-probe', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  describe('extractCliFlags', () => {
    it('extracts --flag patterns from help text', () => {
      const text = 'Usage: tool --verbose --output-dir DIR --no-color';
      const flags = extractCliFlags(text);
      expect(flags).toEqual(new Set(['--verbose', '--output-dir', '--no-color']));
    });

    it('returns empty set for text with no flags', () => {
      const flags = extractCliFlags('no flags here');
      expect(flags.size).toBe(0);
    });

    it('handles flags with underscores and numbers', () => {
      const flags = extractCliFlags('--flag_1 --flag2_bar --a3b');
      expect(flags.has('--flag_1')).toBe(true);
      expect(flags.has('--flag2_bar')).toBe(true);
      expect(flags.has('--a3b')).toBe(true);
    });

    it('does not match single-dash flags', () => {
      const flags = extractCliFlags('-v -h');
      expect(flags.size).toBe(0);
    });
  });

  describe('chooseFlag', () => {
    it('returns first matching candidate', () => {
      const flags = new Set(['--session-id', '--verbose']);
      expect(chooseFlag(flags, ['--resume', '--session-id'])).toBe('--session-id');
    });

    it('returns undefined when no candidates match', () => {
      const flags = new Set(['--verbose']);
      expect(chooseFlag(flags, ['--resume', '--session-id'])).toBeUndefined();
    });

    it('returns undefined for empty candidates list', () => {
      const flags = new Set(['--verbose']);
      expect(chooseFlag(flags, [])).toBeUndefined();
    });

    it('returns undefined for empty flag set', () => {
      expect(chooseFlag(new Set(), ['--resume'])).toBeUndefined();
    });
  });

  describe('detectCliHelpAndVersion', () => {
    it('returns version and help from successful CLI probe', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(null, '1.2.3\n', '');
        } else if (argList.includes('--help')) {
          callback(null, 'Usage: tool --resume --session-id ID\n', '');
        }
        return {};
      });

      const result = await detectCliHelpAndVersion('test-cli', 1000);
      expect(result.version).toBe('1.2.3');
      expect(result.help).toContain('--resume');
    });

    it('returns output from stderr when command fails (error branch)', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(new Error('exit code 1'), '', 'tool 2.0.0\n');
        } else {
          callback(new Error('exit code 1'), '', 'Usage: tool --help-flag\n');
        }
        return {};
      });

      const result = await detectCliHelpAndVersion('test-cli', 1000);
      // When error occurs, runProbe returns `${stdout}${stderr}`.trim()
      expect(result.version).toBe('tool 2.0.0');
    });

    it('returns undefined version for empty output', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, '', '');
        return {};
      });

      const result = await detectCliHelpAndVersion('test-cli', 1000);
      expect(result.version).toBeUndefined();
      expect(result.help).toBe('');
    });

    it('returns stdout on success (not stderr)', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(null, 'v3.5.1\n', 'some warning');
        } else {
          callback(null, 'Usage: tool [options]\n  --flag1\n  --flag2\n', 'deprecation notice');
        }
        return {};
      });

      const result = await detectCliHelpAndVersion('test-cli', 1000);
      // On success, only stdout is returned (not stderr)
      expect(result.version).toBe('v3.5.1');
      expect(result.help).not.toContain('deprecation notice');
    });

    it('combines stdout and stderr on error', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(new Error('exit'), 'ver-stdout', 'ver-stderr');
        } else {
          callback(new Error('exit'), 'help-stdout', 'help-stderr');
        }
        return {};
      });

      const result = await detectCliHelpAndVersion('test-cli', 1000);
      // On error, runProbe returns `${stdout}${stderr}`.trim()
      expect(result.version).toBe('ver-stdoutver-stderr');
      expect(result.help).toBe('help-stdouthelp-stderr');
    });
  });
});

// ---------------------------------------------------------------------------
// legacy-adapter-plugin.ts (private helpers + class)
// ---------------------------------------------------------------------------
describe('LegacyAdapterPlugin', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  function makePlugin(overrides: Partial<ConstructorParameters<typeof LegacyAdapterPlugin>[0]> = {}): LegacyAdapterPlugin {
    return new LegacyAdapterPlugin({
      id: 'test-plugin',
      displayName: 'Test Plugin',
      adapter: makeAdapter(),
      preferredContinuity: 'native',
      nativeFlags: ['--session-id', '--continue', '--resume'],
      fallbackNative: true,
      ...overrides,
    });
  }

  describe('matches', () => {
    it('matches by plugin field', () => {
      const plugin = makePlugin({ id: 'my-plugin' });
      expect(plugin.matches(makeConfig({ plugin: 'my-plugin' }))).toBe(true);
    });

    it('matches by argBuilder field', () => {
      const plugin = makePlugin({ id: 'claude' });
      expect(plugin.matches(makeConfig({ argBuilder: 'claude' }))).toBe(true);
    });

    it('does not match unrelated config', () => {
      const plugin = makePlugin({ id: 'my-plugin' });
      expect(plugin.matches(makeConfig({ plugin: 'other', argBuilder: 'generic' }))).toBe(false);
    });
  });

  describe('extractResponse delegation', () => {
    it('delegates to adapter.extractResponse', () => {
      const extractFn = vi.fn().mockReturnValue({ content: 'parsed', metadata: {} });
      const plugin = makePlugin({ adapter: makeAdapter({ extractResponse: extractFn }) });

      const result = plugin.extractResponse('raw stdout', 0);
      expect(extractFn).toHaveBeenCalledWith('raw stdout', 0);
      expect(result).toEqual({ content: 'parsed', metadata: {} });
    });
  });

  describe('detectCapabilities', () => {
    it('detects capabilities with probed flags', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(null, 'test-cli 1.0.0\n', '');
        } else {
          callback(null, 'Usage: test-cli --session-id ID --resume\n', '');
        }
        return {};
      });

      const plugin = makePlugin({ nativeFlags: ['--session-id', '--resume'] });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });

      expect(caps.pluginId).toBe('test-plugin');
      expect(caps.version).toBe('test-cli 1.0.0');
      expect(caps.supportsNativeSession).toBe(true);
      expect(caps.nativeSessionFlag).toBe('--session-id');
      expect(caps.cached).toBe(false);
      expect(caps.note).toBe('detected:--session-id');
    });

    it('detects capabilities with subcommand', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(null, '2.0.0\n', '');
        } else {
          callback(null, 'Commands:\n  exec     Execute\n  resume   Resume session\n', '');
        }
        return {};
      });

      const plugin = makePlugin({
        nativeFlags: [],
        subcommand: 'resume',
        nativeSessionResumeMode: 'subcommand',
      });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });

      expect(caps.supportsNativeSession).toBe(true);
      expect(caps.nativeSessionSubcommand).toBe('resume');
      expect(caps.nativeSessionResumeMode).toBe('subcommand');
      expect(caps.note).toBe('detected:resume');
    });

    it('sets not-detected note when no flags or subcommands found', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'minimal help\n', '');
        return {};
      });

      const plugin = makePlugin({
        nativeFlags: ['--session-id'],
        fallbackNative: true,
        preferredContinuity: 'native',
      });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });

      // fallbackNative still makes supportsNativeSession true
      expect(caps.supportsNativeSession).toBe(true);
      expect(caps.note).toBe('not-detected');
    });

    it('returns supportsNativeSession false when preferredContinuity is hub', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, 'help text --session-id\n', '');
        return {};
      });

      const plugin = makePlugin({
        preferredContinuity: 'hub',
        nativeFlags: ['--session-id'],
      });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });

      expect(caps.supportsNativeSession).toBe(false);
    });

    it('uses default timeout when not provided', async () => {
      mockExecFile.mockImplementation((_cmd: any, _args: any, opts: any, callback: any) => {
        // Verify the timeout option is passed through
        callback(null, 'help\n', '');
        return {};
      });

      const plugin = makePlugin();
      const caps = await plugin.detectCapabilities({ command: 'test-cli' });

      expect(caps.pluginId).toBe('test-plugin');
    });
  });

  describe('hasSubcommand (via detectCapabilities)', () => {
    it('detects subcommand token in help text', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--help')) {
          callback(null, 'Available subcommands:\n  resume  Resume a session\n  exec    Execute\n', '');
        } else {
          callback(null, '1.0.0\n', '');
        }
        return {};
      });

      const plugin = makePlugin({ subcommand: 'resume', nativeFlags: [] });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });
      expect(caps.note).toBe('detected:resume');
    });

    it('returns false for missing subcommand', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--help')) {
          callback(null, 'Available commands:\n  exec    Execute\n  chat    Chat mode\n', '');
        } else {
          callback(null, '1.0.0\n', '');
        }
        return {};
      });

      const plugin = makePlugin({
        subcommand: 'resume',
        nativeFlags: [],
        fallbackNative: false,
        preferredContinuity: 'native',
      });
      const caps = await plugin.detectCapabilities({ command: 'test-cli', timeoutMs: 1000 });
      // No flag, no subcommand found, no fallback => not supported
      expect(caps.supportsNativeSession).toBe(false);
      expect(caps.note).toBe('not-detected');
    });
  });

  describe('insertFlagPromptMode (via buildNativeContinueInvocation)', () => {
    it('inserts --continue flag before prompt when prompt is found', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['--model', model, input.prompt],
        }),
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionFlag: '--continue',
        nativeSessionResumeMode: 'flag',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'my-prompt' }),
        'model-1',
        'session-123',
        caps,
      );

      // --continue is inserted before the prompt
      expect(result.args).toEqual(['--model', 'model-1', '--continue', 'my-prompt']);
    });

    it('inserts --session-id flag with sessionRef before prompt', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['--model', model, input.prompt],
        }),
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionFlag: '--session-id',
        nativeSessionResumeMode: 'flag',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'my-prompt' }),
        'model-1',
        'sess-abc',
        caps,
      );

      expect(result.args).toEqual(['--model', 'model-1', '--session-id', 'sess-abc', 'my-prompt']);
    });

    it('appends --continue at end when prompt not found in args', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgsWithoutPrompt: (_input, model) => ['--model', model],
        }),
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionFlag: '--continue',
        nativeSessionResumeMode: 'flag',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'my-prompt' }),
        'model-1',
        'sess-abc',
        caps,
      );

      // prompt not in args (stdin delivery), so --continue is appended
      expect(result.args).toEqual(['--model', 'model-1', '--continue']);
      expect(result.stdinData).toBe('my-prompt');
    });

    it('appends flag with sessionRef when prompt not found (non --continue flag)', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgsWithoutPrompt: (_input, model) => ['--model', model],
        }),
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionFlag: '--resume',
        nativeSessionResumeMode: 'flag',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'test' }),
        'model-1',
        'sess-xyz',
        caps,
      );

      // prompt not in args, non-continue flag => [...args, flag, sessionRef]
      expect(result.args).toEqual(['--model', 'model-1', '--resume', 'sess-xyz']);
    });
  });

  describe('insertSubcommand (via buildNativeContinueInvocation)', () => {
    it('inserts subcommand after exec prefix with sessionRef', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgsWithoutPrompt: (_input, model) => ['exec', '--json', '--model', model],
        }),
        subcommand: 'resume',
        nativeSessionResumeMode: 'subcommand',
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionResumeMode: 'subcommand',
        nativeSessionSubcommand: 'resume',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput(),
        'codex-1',
        'session-123',
        caps,
      );

      expect(result.args).toEqual(['exec', 'resume', 'session-123', '--json', '--model', 'codex-1']);
    });

    it('inserts subcommand without exec prefix', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['--model', model, input.prompt],
        }),
        subcommand: 'resume',
        nativeSessionResumeMode: 'subcommand',
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionResumeMode: 'subcommand',
        nativeSessionSubcommand: 'resume',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'hello' }),
        'model-1',
        'sess-1',
        caps,
      );

      // Without exec prefix: [first_arg, subcommand, sessionRef, ...rest]
      expect(result.args[0]).toBe('--model');
      expect(result.args[1]).toBe('resume');
      expect(result.args[2]).toBe('sess-1');
    });

    it('does not duplicate subcommand if already present', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (_input, model) => ['resume', '--model', model],
        }),
        subcommand: 'resume',
        nativeSessionResumeMode: 'subcommand',
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionResumeMode: 'subcommand',
        nativeSessionSubcommand: 'resume',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput(),
        'model-1',
        'sess-1',
        caps,
      );

      // 'resume' only appears once
      const resumeCount = result.args.filter((a) => a === 'resume').length;
      expect(resumeCount).toBe(1);
    });

    it('inserts subcommand without sessionRef for start invocation', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['run', '--model', model, input.prompt],
        }),
        subcommand: 'chat',
        nativeSessionResumeMode: 'subcommand',
        subcommandOnlyForContinue: false,
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionResumeMode: 'subcommand',
        nativeSessionSubcommand: 'chat',
      });

      const result = await plugin.buildNativeStartInvocation(
        makeConfig(),
        makeInput({ prompt: 'hello' }),
        'model-1',
        'sess-1',
        caps,
      );

      expect(result.args).toContain('chat');
    });
  });

  describe('subcommandOnlyForContinue', () => {
    it('uses subcommand only for continue when subcommandOnlyForContinue is enabled', async () => {
      const plugin = new LegacyAdapterPlugin({
        id: 'codex',
        displayName: 'Codex Plugin',
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgs: (input, model) => ['exec', input.prompt, '--json', '--model', model],
          buildArgsWithoutPrompt: (_input, model) => ['exec', '--json', '--model', model],
        }),
        preferredContinuity: 'native',
        nativeSessionResumeMode: 'subcommand',
        subcommand: 'resume',
        subcommandOnlyForContinue: true,
        nativeFlags: ['--resume'],
        fallbackNative: true,
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        supportsNativeStart: true,
        supportsNativeContinue: true,
        nativeSessionSubcommand: 'resume',
        nativeSessionResumeMode: 'subcommand',
      });

      const start = await plugin.buildNativeStartInvocation(
        makeConfig({ argBuilder: 'codex' }),
        makeInput({ prompt: 'first-turn message' }),
        'codex-1',
        'session-123',
        caps,
      );

      // Start should NOT include subcommand
      expect(start.args).toEqual(['exec', '--json', '--model', 'codex-1']);

      const cont = await plugin.buildNativeContinueInvocation(
        makeConfig({ argBuilder: 'codex' }),
        makeInput({ prompt: 'continue message' }),
        'codex-1',
        'session-123',
        caps,
      );

      // Continue SHOULD include subcommand
      expect(cont.args).toEqual(['exec', 'resume', 'session-123', '--json', '--model', 'codex-1']);
    });
  });

  describe('buildNativeStartInvocation / buildNativeContinueInvocation errors', () => {
    it('throws when native session is not supported', async () => {
      const plugin = makePlugin({ fallbackNative: false, preferredContinuity: 'hub' });
      const caps = makeCapabilities({ supportsNativeSession: false });

      await expect(
        plugin.buildNativeStartInvocation(makeConfig(), makeInput(), 'model-1', 'sess-1', caps),
      ).rejects.toThrow('Native session not supported');

      await expect(
        plugin.buildNativeContinueInvocation(makeConfig(), makeInput(), 'model-1', 'sess-1', caps),
      ).rejects.toThrow('Native session not supported');
    });
  });

  describe('buildOneShotInvocation', () => {
    it('builds one-shot invocation with arg delivery', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['--model', model, input.prompt],
        }),
      });

      const result = await plugin.buildOneShotInvocation(makeConfig(), makeInput({ prompt: 'test' }), 'model-1');
      expect(result.args).toEqual(['--model', 'model-1', 'test']);
      expect(result.stdinData).toBeUndefined();
    });

    it('builds one-shot invocation with stdin delivery', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgsWithoutPrompt: (_input, model) => ['--model', model],
        }),
      });

      const result = await plugin.buildOneShotInvocation(makeConfig(), makeInput({ prompt: 'stdin-prompt' }), 'model-1');
      expect(result.args).toEqual(['--model', 'model-1']);
      expect(result.stdinData).toBe('stdin-prompt');
    });

    it('falls back to buildArgs when stdin delivery but no buildArgsWithoutPrompt', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'stdin',
          buildArgs: (input, model) => [input.prompt, '--model', model],
          buildArgsWithoutPrompt: undefined,
        }),
      });

      const result = await plugin.buildOneShotInvocation(makeConfig(), makeInput({ prompt: 'my-prompt' }), 'model-1');
      expect(result.args).toEqual(['my-prompt', '--model', 'model-1']);
      expect(result.stdinData).toBe('my-prompt');
    });
  });

  describe('fallbackCapabilities', () => {
    it('returns native capabilities when fallbackNative is true and preferredContinuity is native', () => {
      const plugin = makePlugin({ fallbackNative: true, preferredContinuity: 'native' });
      const caps = plugin.fallbackCapabilities(makeConfig());

      expect(caps.supportsNativeSession).toBe(true);
      expect(caps.supportsNativeStart).toBe(true);
      expect(caps.supportsNativeContinue).toBe(true);
      expect(caps.note).toBe('fallback-capabilities');
    });

    it('returns non-native capabilities when fallbackNative is false', () => {
      const plugin = makePlugin({ fallbackNative: false, preferredContinuity: 'native' });
      const caps = plugin.fallbackCapabilities(makeConfig());

      expect(caps.supportsNativeSession).toBe(false);
      expect(caps.supportsNativeStart).toBe(false);
      expect(caps.supportsNativeContinue).toBe(false);
    });

    it('returns non-native capabilities when preferredContinuity is hub', () => {
      const plugin = makePlugin({ fallbackNative: true, preferredContinuity: 'hub' });
      const caps = plugin.fallbackCapabilities(makeConfig());

      expect(caps.supportsNativeSession).toBe(false);
    });

    it('sets nativeSessionFlag from nativeFlags[0]', () => {
      const plugin = makePlugin({
        nativeFlags: ['--session-id', '--continue'],
        fallbackNative: true,
        preferredContinuity: 'native',
      });
      const caps = plugin.fallbackCapabilities(makeConfig());

      expect(caps.nativeSessionFlag).toBe('--session-id');
    });

    it('sets nativeSessionResumeMode to subcommand when subcommand is set', () => {
      const plugin = makePlugin({
        subcommand: 'resume',
        fallbackNative: true,
        preferredContinuity: 'native',
      });
      const caps = plugin.fallbackCapabilities(makeConfig());

      expect(caps.nativeSessionResumeMode).toBe('subcommand');
      expect(caps.nativeSessionSubcommand).toBe('resume');
    });
  });

  describe('withSession flag fallback', () => {
    it('uses nativeFlags[0] when nativeSessionFlag is missing in capabilities', async () => {
      const plugin = makePlugin({
        adapter: makeAdapter({
          promptDelivery: 'arg',
          buildArgs: (input, model) => ['--model', model, input.prompt],
        }),
        nativeFlags: ['--session-id', '--continue'],
      });

      const caps = makeCapabilities({
        supportsNativeSession: true,
        nativeSessionFlag: undefined,  // No flag detected
        nativeSessionResumeMode: 'flag',
      });

      const result = await plugin.buildNativeContinueInvocation(
        makeConfig(),
        makeInput({ prompt: 'test' }),
        'model-1',
        'sess-1',
        caps,
      );

      // Falls back to nativeFlags[0] which is --session-id
      expect(result.args).toContain('--session-id');
    });
  });
});

// ---------------------------------------------------------------------------
// registry.ts
// ---------------------------------------------------------------------------
describe('PluginRegistry', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'plugin-registry-'));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  describe('isAgentPlugin validation (via toPluginArray/loadDynamicPlugins)', () => {
    it('rejects non-objects', async () => {
      const pluginPath = join(pluginDir, 'non-object.mjs');
      writeFileSync(pluginPath, 'export default "not-a-plugin";', 'utf-8');

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('not-a-plugin')).toBe(false);
    });

    it('rejects objects missing required methods', async () => {
      const pluginPath = join(pluginDir, 'incomplete.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "incomplete",',
          '  displayName: "Incomplete",',
          '  preferredContinuity: "hub",',
          '  matches: () => true,',
          '  // missing other methods',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('incomplete')).toBe(false);
    });

    it('rejects objects with empty id', async () => {
      const pluginPath = join(pluginDir, 'empty-id.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "   ",',
          '  displayName: "Empty ID",',
          '  preferredContinuity: "hub",',
          '  matches: () => true,',
          '  detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null,',
          '  fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('   ')).toBe(false);
    });

    it('rejects null values', async () => {
      const pluginPath = join(pluginDir, 'null-export.mjs');
      writeFileSync(pluginPath, 'export default null;', 'utf-8');

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      // Should not throw, null is handled
    });

    it('rejects objects with invalid preferredContinuity', async () => {
      const pluginPath = join(pluginDir, 'bad-continuity.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "bad-cont",',
          '  displayName: "Bad Continuity",',
          '  preferredContinuity: "invalid",',
          '  matches: () => true,',
          '  detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null,',
          '  fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('bad-cont')).toBe(false);
    });
  });

  describe('toPluginArray — export shapes', () => {
    it('handles plugins array export', async () => {
      const pluginPath = join(pluginDir, 'array-export.mjs');
      writeFileSync(
        pluginPath,
        [
          'const p1 = {',
          '  id: "arr1", displayName: "Arr1", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
          'export const plugins = [p1];',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('arr1')).toBe(true);
    });

    it('handles plugin named export', async () => {
      const pluginPath = join(pluginDir, 'named-export.mjs');
      writeFileSync(
        pluginPath,
        [
          'export const plugin = {',
          '  id: "named1", displayName: "Named1", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('named1')).toBe(true);
    });

    it('handles default export', async () => {
      const pluginPath = join(pluginDir, 'default-export.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "def1", displayName: "Def1", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('def1')).toBe(true);
    });

    it('handles constructor function export', async () => {
      const pluginPath = join(pluginDir, 'constructor-export.mjs');
      writeFileSync(
        pluginPath,
        [
          'function MyPlugin() {',
          '  this.id = "ctor1";',
          '  this.displayName = "Ctor1";',
          '  this.preferredContinuity = "hub";',
          '  this.matches = () => true;',
          '  this.detectCapabilities = async () => ({});',
          '  this.buildOneShotInvocation = async () => ({ args: [] });',
          '  this.buildNativeStartInvocation = async () => ({ args: [] });',
          '  this.buildNativeContinueInvocation = async () => ({ args: [] });',
          '  this.extractResponse = () => null;',
          '  this.fallbackCapabilities = () => ({});',
          '}',
          'export default MyPlugin;',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('ctor1')).toBe(true);
    });

    it('handles empty modules gracefully', async () => {
      const pluginPath = join(pluginDir, 'empty-module.mjs');
      writeFileSync(pluginPath, '// empty module\nexport const nothing = null;', 'utf-8');

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('nothing')).toBe(false);
    });
  });

  describe('resolvePluginPath (via loadDynamicPlugins)', () => {
    it('resolves file: prefix paths', async () => {
      const pluginPath = join(pluginDir, 'file-prefix.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "file-prefix", displayName: "FP", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const fileUrl = `file://${pluginPath}`;
      const registry = new PluginRegistry({ pluginPaths: [fileUrl], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('file-prefix')).toBe(true);
    });

    it('resolves absolute paths', async () => {
      const pluginPath = join(pluginDir, 'absolute.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "absolute", displayName: "Abs", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      expect(registry.hasPlugin('absolute')).toBe(true);
    });
  });

  describe('loadDynamicPlugins — error handling', () => {
    it('logs warning and skips invalid module in non-strict mode', async () => {
      const pluginPath = join(pluginDir, 'invalid.mjs');
      writeFileSync(pluginPath, 'export default 42;', 'utf-8');

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();
    });

    it('throws for invalid module in strict mode', async () => {
      const pluginPath = join(pluginDir, 'invalid-strict.mjs');
      writeFileSync(pluginPath, 'export default 42;', 'utf-8');

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: true });
      await expect(registry.loadDynamicPlugins()).rejects.toThrow('No plugin exports found');
    });

    it('throws for import failure in strict mode', async () => {
      const registry = new PluginRegistry({
        pluginPaths: [join(pluginDir, 'nonexistent.mjs')],
        strict: true,
      });
      await expect(registry.loadDynamicPlugins()).rejects.toThrow('Failed to load plugin module');
    });

    it('logs warning for import failure in non-strict mode', async () => {
      const registry = new PluginRegistry({
        pluginPaths: [join(pluginDir, 'nonexistent.mjs')],
        strict: false,
      });
      await registry.loadDynamicPlugins();
    });
  });

  describe('hasPlugin', () => {
    it('returns true for builtin plugins', () => {
      const registry = new PluginRegistry();
      expect(registry.hasPlugin('claude')).toBe(true);
      expect(registry.hasPlugin('gemini')).toBe(true);
      expect(registry.hasPlugin('codex')).toBe(true);
      expect(registry.hasPlugin('generic')).toBe(true);
      expect(registry.hasPlugin('opencode')).toBe(true);
      expect(registry.hasPlugin('copilot')).toBe(true);
      expect(registry.hasPlugin('cursor')).toBe(true);
    });

    it('returns false for non-existent plugins', () => {
      const registry = new PluginRegistry();
      expect(registry.hasPlugin('nonexistent')).toBe(false);
    });
  });

  describe('getPlugin', () => {
    it('returns plugin for known id', () => {
      const registry = new PluginRegistry();
      const plugin = registry.getPlugin('claude');
      expect(plugin).toBeDefined();
      expect(plugin!.id).toBe('claude');
    });

    it('returns undefined for unknown id', () => {
      const registry = new PluginRegistry();
      expect(registry.getPlugin('unknown')).toBeUndefined();
    });
  });

  describe('getPlugins', () => {
    it('returns iterable of all registered plugins', () => {
      const registry = new PluginRegistry();
      const plugins = [...registry.getPlugins()];
      expect(plugins.length).toBeGreaterThan(0);
      const ids = plugins.map((p) => p.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('generic');
    });
  });

  describe('plugin overwrite', () => {
    it('overwrites existing plugin when registering with same id', async () => {
      const pluginPath = join(pluginDir, 'overwrite-claude.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "claude", displayName: "Custom Claude", preferredContinuity: "hub",',
          '  matches: () => true, detectCapabilities: async () => ({}),',
          '  buildOneShotInvocation: async () => ({ args: ["custom"] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: () => null, fallbackCapabilities: () => ({}),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const registry = new PluginRegistry({ pluginPaths: [pluginPath], strict: false });
      await registry.loadDynamicPlugins();

      const plugin = registry.getPlugin('claude');
      expect(plugin!.displayName).toBe('Custom Claude');
    });
  });
});

// ---------------------------------------------------------------------------
// runtime.ts
// ---------------------------------------------------------------------------
describe('PluginRuntime', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'plugin-runtime-'));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  it('resolves builtin plugin by argBuilder', async () => {
    const runtime = new PluginRuntime({ strict: false });

    const invocation = await runtime.buildInvocation({
      config: makeConfig({ argBuilder: 'claude', command: 'nonexistent-command' }),
      input: makeInput(),
      resolvedModel: 'claude-sonnet-4-5',
      capabilities: makeCapabilities({ pluginId: 'claude' }),
      mode: 'native',
    });

    expect(invocation.plugin.id).toBe('claude');
    expect(invocation.mode).toBe('hub');
  });

  it('respects plugin override', async () => {
    const runtime = new PluginRuntime({ strict: false });

    const invocation = await runtime.buildInvocation({
      config: makeConfig({ plugin: 'codex', argBuilder: 'generic', command: 'nonexistent-command' }),
      input: makeInput(),
      resolvedModel: 'model-1',
      capabilities: makeCapabilities({ pluginId: 'codex' }),
      mode: 'native',
    });

    expect(invocation.plugin.id).toBe('codex');
    expect(invocation.mode).toBe('hub');
  });

  it('falls back to generic when configured plugin is unknown', async () => {
    const runtime = new PluginRuntime({ strict: false });

    const invocation = await runtime.buildInvocation({
      config: makeConfig({ plugin: 'missing-plugin', argBuilder: 'generic' }),
      input: makeInput(),
      resolvedModel: 'model-1',
      capabilities: makeCapabilities({ pluginId: 'generic' }),
      mode: 'native',
    });

    expect(invocation.plugin.id).toBe('generic');
    expect(invocation.mode).toBe('hub');
  });

  it('loads custom plugin modules', async () => {
    const pluginPath = join(pluginDir, 'custom-plugin.mjs');
    writeFileSync(
      pluginPath,
      [
        'export default {',
        '  id: "custom",',
        '  displayName: "Custom Plugin",',
        '  preferredContinuity: "hub",',
        '  matches: (config) => config.name === "custom",',
        '  detectCapabilities: async () => ({',
        '    pluginId: "custom",',
        '    detectedAt: Date.now(),',
        '    cached: false,',
        '    supportsNativeSession: false,',
        '    supportsNativeStart: false,',
        '    supportsNativeContinue: false,',
        '  }),',
        '  buildOneShotInvocation: async (_, input, model) => ({ args: ["--model", model, input.prompt] }),',
        '  buildNativeStartInvocation: async () => ({ args: [] }),',
        '  buildNativeContinueInvocation: async () => ({ args: [] }),',
        '  extractResponse: (stdout) => ({ content: stdout }),',
        '  fallbackCapabilities: (config) => ({',
        '    pluginId: "custom",',
        '    detectedAt: Date.now(),',
        '    cached: true,',
        '    supportsNativeSession: false,',
        '    supportsNativeStart: false,',
        '    supportsNativeContinue: false,',
        '    version: config.defaultModel',
        '  }),',
        '};',
      ].join('\n'),
      'utf-8',
    );

    const runtime = new PluginRuntime({ strict: false, pluginPaths: [pluginPath] });
    const invocation = await runtime.buildInvocation({
      config: makeConfig({ name: 'custom', argBuilder: 'generic', displayName: 'Custom' }),
      input: makeInput(),
      resolvedModel: 'custom-model',
      mode: 'hub',
    });

    expect(invocation.plugin.id).toBe('custom');
    expect(invocation.invocation.args).toEqual(['--model', 'custom-model', 'Hello']);
  });

  it('uses fallback capabilities when detect fails in non-strict mode', async () => {
    const pluginPath = join(pluginDir, 'flaky-plugin.mjs');
    writeFileSync(
      pluginPath,
      [
        'export default {',
        '  id: "flaky",',
        '  displayName: "Flaky Plugin",',
        '  preferredContinuity: "hub",',
        '  matches: () => true,',
        '  detectCapabilities: async () => { throw new Error("probe unavailable"); },',
        '  buildOneShotInvocation: async (_, input) => ({ args: [input.prompt] }),',
        '  buildNativeStartInvocation: async () => ({ args: [] }),',
        '  buildNativeContinueInvocation: async () => ({ args: [] }),',
        '  extractResponse: (stdout) => ({ content: stdout }),',
        '  fallbackCapabilities: () => ({',
        '    pluginId: "flaky",',
        '    detectedAt: Date.now(),',
        '    cached: true,',
        '    supportsNativeSession: false,',
        '    supportsNativeStart: false,',
        '    supportsNativeContinue: false,',
        '  }),',
        '};',
      ].join('\n'),
      'utf-8',
    );

    const runtime = new PluginRuntime({ strict: false, pluginPaths: [pluginPath] });
    const invocation = await runtime.buildInvocation({
      config: makeConfig({ plugin: 'flaky', argBuilder: 'generic', command: 'missing-cmd', name: 'flaky' }),
      input: makeInput(),
      resolvedModel: 'model-1',
    });

    expect(invocation.plugin.id).toBe('flaky');
    expect(invocation.mode).toBe('hub');
  });

  it('throws in strict mode when plugin module is invalid', async () => {
    const runtime = new PluginRuntime({
      strict: true,
      pluginPaths: [join(pluginDir, 'missing-plugin.mjs')],
    });

    await expect(
      runtime.resolveSessionMetadata(
        makeConfig({ argBuilder: 'generic', command: 'missing-cmd', name: 'generic-only' }),
      ),
    ).rejects.toThrow();
  });

  describe('buildInvocation with native continuity mode', () => {
    it('builds native start invocation', async () => {
      const pluginPath = join(pluginDir, 'native-start-plugin.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "native-start",',
          '  displayName: "NativeStart",',
          '  preferredContinuity: "native",',
          '  matches: (config) => config.name === "native-start",',
          '  detectCapabilities: async () => ({',
          '    pluginId: "native-start", detectedAt: Date.now(), cached: false,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '  buildOneShotInvocation: async (_, input, model) => ({ args: ["oneshot", input.prompt] }),',
          '  buildNativeStartInvocation: async (_, input, model, sessionRef, caps) => ({ args: ["start", sessionRef, input.prompt] }),',
          '  buildNativeContinueInvocation: async (_, input, model, sessionRef, caps) => ({ args: ["continue", sessionRef, input.prompt] }),',
          '  extractResponse: (stdout) => ({ content: stdout }),',
          '  fallbackCapabilities: () => ({',
          '    pluginId: "native-start", detectedAt: Date.now(), cached: true,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const runtime = new PluginRuntime({ strict: false, pluginPaths: [pluginPath] });
      const invocation = await runtime.buildInvocation({
        config: makeConfig({ name: 'native-start', argBuilder: 'generic' }),
        input: makeInput({ prompt: 'first' }),
        resolvedModel: 'model-1',
        mode: 'native',
        sessionRef: 'sess-001',
        isSessionStart: true,
      });

      expect(invocation.mode).toBe('native');
      expect(invocation.invocation.args).toEqual(['start', 'sess-001', 'first']);
    });

    it('builds native continue invocation', async () => {
      const pluginPath = join(pluginDir, 'native-continue-plugin.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "native-cont",',
          '  displayName: "NativeCont",',
          '  preferredContinuity: "native",',
          '  matches: (config) => config.name === "native-cont",',
          '  detectCapabilities: async () => ({',
          '    pluginId: "native-cont", detectedAt: Date.now(), cached: false,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '  buildOneShotInvocation: async (_, input) => ({ args: ["oneshot", input.prompt] }),',
          '  buildNativeStartInvocation: async (_, input, model, ref) => ({ args: ["start", ref] }),',
          '  buildNativeContinueInvocation: async (_, input, model, ref) => ({ args: ["continue", ref, input.prompt] }),',
          '  extractResponse: (stdout) => ({ content: stdout }),',
          '  fallbackCapabilities: () => ({',
          '    pluginId: "native-cont", detectedAt: Date.now(), cached: true,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const runtime = new PluginRuntime({ strict: false, pluginPaths: [pluginPath] });
      const invocation = await runtime.buildInvocation({
        config: makeConfig({ name: 'native-cont', argBuilder: 'generic' }),
        input: makeInput({ prompt: 'next' }),
        resolvedModel: 'model-1',
        mode: 'native',
        sessionRef: 'sess-002',
        isSessionStart: false,
      });

      expect(invocation.mode).toBe('native');
      expect(invocation.invocation.args).toEqual(['continue', 'sess-002', 'next']);
    });

    it('throws when native mode requested but sessionRef is missing', async () => {
      const pluginPath = join(pluginDir, 'native-no-ref.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "native-no-ref",',
          '  displayName: "NoRef",',
          '  preferredContinuity: "native",',
          '  matches: (config) => config.name === "native-no-ref",',
          '  detectCapabilities: async () => ({',
          '    pluginId: "native-no-ref", detectedAt: Date.now(), cached: false,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '  buildOneShotInvocation: async () => ({ args: [] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: (stdout) => ({ content: stdout }),',
          '  fallbackCapabilities: () => ({',
          '    pluginId: "native-no-ref", detectedAt: Date.now(), cached: true,',
          '    supportsNativeSession: true, supportsNativeStart: true, supportsNativeContinue: true,',
          '  }),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const runtime = new PluginRuntime({ strict: false, pluginPaths: [pluginPath] });
      await expect(
        runtime.buildInvocation({
          config: makeConfig({ name: 'native-no-ref', argBuilder: 'generic' }),
          input: makeInput(),
          resolvedModel: 'model-1',
          mode: 'native',
          // sessionRef intentionally omitted
        }),
      ).rejects.toThrow('Missing sessionRef');
    });

    it('falls back to hub mode when native not supported', async () => {
      const runtime = new PluginRuntime({ strict: false });

      const invocation = await runtime.buildInvocation({
        config: makeConfig({ argBuilder: 'claude', command: 'nonexistent' }),
        input: makeInput(),
        resolvedModel: 'model-1',
        capabilities: makeCapabilities({
          pluginId: 'claude',
          supportsNativeSession: false,
        }),
        mode: 'native',
      });

      expect(invocation.mode).toBe('hub');
    });
  });

  describe('isNativeFallbackError', () => {
    const runtime = new PluginRuntime({ strict: false });

    const baseResult: ToolResult = {
      content: '',
      success: false,
      exitCode: 1,
      durationMs: 100,
      backend: 'test',
      model: 'test',
    };

    it('returns true for "unknown option" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'unknown option --resume' })).toBe(true);
    });

    it('returns true for "unrecognized" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, stderr: 'unrecognized argument' })).toBe(true);
    });

    it('returns true for "invalid option" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'invalid option: --session-id' })).toBe(true);
    });

    it('returns true for "missing required" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'missing required argument' })).toBe(true);
    });

    it('returns true for "not recognized" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, stderr: 'flag not recognized' })).toBe(true);
    });

    it('returns true for "unknown flag" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'unknown flag --foo' })).toBe(true);
    });

    it('returns true for "no such option" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'no such option --bar' })).toBe(true);
    });

    it('returns true for "unexpected option" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'unexpected option --baz' })).toBe(true);
    });

    it('returns true for "invalid argument" error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'invalid argument provided' })).toBe(true);
    });

    it('returns false for non-matching error', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, error: 'connection refused' })).toBe(false);
    });

    it('returns false when no error or stderr', () => {
      expect(runtime.isNativeFallbackError({ ...baseResult, exitCode: 1 })).toBe(false);
    });

    it('returns false when exit code is 0', () => {
      expect(
        runtime.isNativeFallbackError({ ...baseResult, exitCode: 0, error: 'unknown option' }),
      ).toBe(false);
    });

    it('returns false for successful result with no error', () => {
      expect(
        runtime.isNativeFallbackError({
          ...baseResult,
          success: true,
          exitCode: 0,
          error: undefined,
          stderr: undefined,
        }),
      ).toBe(false);
    });

    it('detects hint in stderr when error is empty', () => {
      expect(
        runtime.isNativeFallbackError({ ...baseResult, error: '', stderr: 'error: unknown flag --x' }),
      ).toBe(true);
    });
  });

  describe('resolvePlugin in strict mode', () => {
    it('throws in strict mode when no plugin can claim backend', async () => {
      const runtime = new PluginRuntime({ strict: true });

      await expect(
        runtime.buildInvocation({
          config: makeConfig({ name: 'totally-unknown', argBuilder: 'generic', plugin: undefined }),
          input: makeInput(),
          resolvedModel: 'model-1',
          capabilities: makeCapabilities(),
          mode: 'hub',
        }),
      ).rejects.toThrow('No plugin could claim backend');
    });
  });

  describe('getCapabilities — strict mode failure', () => {
    it('throws in strict mode when detection fails', async () => {
      const pluginPath = join(pluginDir, 'strict-fail.mjs');
      writeFileSync(
        pluginPath,
        [
          'export default {',
          '  id: "strict-fail",',
          '  displayName: "StrictFail",',
          '  preferredContinuity: "hub",',
          '  matches: (config) => config.name === "strict-fail",',
          '  detectCapabilities: async () => { throw new Error("probe broke"); },',
          '  buildOneShotInvocation: async (_, input) => ({ args: [input.prompt] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: (stdout) => ({ content: stdout }),',
          '  fallbackCapabilities: () => ({',
          '    pluginId: "strict-fail", detectedAt: Date.now(), cached: true,',
          '    supportsNativeSession: false, supportsNativeStart: false, supportsNativeContinue: false,',
          '  }),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const runtime = new PluginRuntime({ strict: true, pluginPaths: [pluginPath] });

      await expect(
        runtime.buildInvocation({
          config: makeConfig({ name: 'strict-fail', argBuilder: 'generic' }),
          input: makeInput(),
          resolvedModel: 'model-1',
          mode: 'hub',
        }),
      ).rejects.toThrow('Failed to detect plugin capabilities');
    });
  });

  describe('resolveSessionMetadata', () => {
    it('returns plugin, capabilities, and continuity mode', async () => {
      mockExecFile.mockImplementation((_cmd: any, args: any, _opts: any, callback: any) => {
        const argList = args as string[];
        if (argList.includes('--version')) {
          callback(null, 'claude 1.0.0\n', '');
        } else {
          callback(null, 'Usage: claude --session-id ID --resume\n', '');
        }
        return {};
      });

      const runtime = new PluginRuntime({ strict: false });

      const result = await runtime.resolveSessionMetadata(
        makeConfig({ argBuilder: 'claude', command: 'claude' }),
      );

      expect(result.plugin.id).toBe('claude');
      expect(result.capabilities).toBeDefined();
      expect(result.capabilities.pluginId).toBe('claude');
      expect(['hub', 'native']).toContain(result.continuityMode);
    });
  });

  describe('capability caching', () => {
    it('uses cached capabilities within TTL', async () => {
      const pluginPath = join(pluginDir, 'cacheable-plugin.mjs');
      writeFileSync(
        pluginPath,
        [
          'let callCount = 0;',
          'export default {',
          '  id: "cacheable",',
          '  displayName: "Cacheable",',
          '  preferredContinuity: "hub",',
          '  matches: (config) => config.name === "cacheable",',
          '  detectCapabilities: async () => {',
          '    callCount++;',
          '    return {',
          '      pluginId: "cacheable", detectedAt: Date.now(), cached: false,',
          '      supportsNativeSession: false, supportsNativeStart: false, supportsNativeContinue: false,',
          '      note: "call-" + callCount,',
          '    };',
          '  },',
          '  buildOneShotInvocation: async (_, input) => ({ args: [input.prompt] }),',
          '  buildNativeStartInvocation: async () => ({ args: [] }),',
          '  buildNativeContinueInvocation: async () => ({ args: [] }),',
          '  extractResponse: (stdout) => ({ content: stdout }),',
          '  fallbackCapabilities: () => ({',
          '    pluginId: "cacheable", detectedAt: Date.now(), cached: true,',
          '    supportsNativeSession: false, supportsNativeStart: false, supportsNativeContinue: false,',
          '  }),',
          '};',
        ].join('\n'),
        'utf-8',
      );

      const runtime = new PluginRuntime({
        strict: false,
        pluginPaths: [pluginPath],
        capabilityCacheTtlMs: 60_000,
      });

      const inv1 = await runtime.buildInvocation({
        config: makeConfig({ name: 'cacheable', argBuilder: 'generic' }),
        input: makeInput(),
        resolvedModel: 'model-1',
        mode: 'hub',
      });

      const inv2 = await runtime.buildInvocation({
        config: makeConfig({ name: 'cacheable', argBuilder: 'generic' }),
        input: makeInput(),
        resolvedModel: 'model-1',
        mode: 'hub',
      });

      // Second call should use cached capabilities
      expect(inv2.capabilities.cached).toBe(true);
      expect(inv1.plugin.id).toBe('cacheable');
      expect(inv2.plugin.id).toBe('cacheable');
    });
  });

  describe('mode defaults to plugin preferredContinuity', () => {
    it('defaults to hub when no mode specified and plugin prefers hub', async () => {
      const runtime = new PluginRuntime({ strict: false });

      const invocation = await runtime.buildInvocation({
        config: makeConfig({ argBuilder: 'gemini', command: 'nonexistent' }),
        input: makeInput(),
        resolvedModel: 'model-1',
        capabilities: makeCapabilities({ pluginId: 'gemini', supportsNativeSession: false }),
        // mode intentionally omitted
      });

      // gemini plugin preferredContinuity is 'hub'
      expect(invocation.mode).toBe('hub');
    });
  });
});
