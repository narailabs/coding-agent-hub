import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginRuntime } from '../src/plugins/runtime.js';
import { LegacyAdapterPlugin } from '../src/plugins/legacy-adapter-plugin.js';
import type { BackendConfig, ToolInput } from '../src/types.js';
import type { PluginCapabilitySnapshot } from '../src/plugins/types.js';

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
      capabilities: {
        pluginId: 'claude',
        detectedAt: Date.now(),
        cached: false,
        supportsNativeSession: false,
        supportsNativeStart: false,
        supportsNativeContinue: false,
      },
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
      capabilities: {
        pluginId: 'codex',
        detectedAt: Date.now(),
        cached: false,
        supportsNativeSession: false,
        supportsNativeStart: false,
        supportsNativeContinue: false,
      },
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
      capabilities: {
        pluginId: 'generic',
        detectedAt: Date.now(),
        cached: false,
        supportsNativeSession: false,
        supportsNativeStart: false,
        supportsNativeContinue: false,
      },
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

  it('uses subcommand only for continue when subcommand-only mode is enabled', async () => {
    const plugin = new LegacyAdapterPlugin({
      id: 'codex',
      displayName: 'Codex Plugin',
      adapter: {
        promptDelivery: 'stdin',
        buildArgs: (input, model) => ['exec', input.prompt, '--json', '--model', model],
        buildArgsWithoutPrompt: (_input, model) => ['exec', '--json', '--model', model],
        extractResponse: () => ({ content: 'ok', metadata: { extractedFromStdout: true, exitCode: 0 } }),
        buildDescription: () => 'Codex',
      },
      preferredContinuity: 'native',
      nativeSessionResumeMode: 'subcommand',
      subcommand: 'resume',
      subcommandOnlyForContinue: true,
      nativeFlags: ['--resume'],
      fallbackNative: true,
    });

    const capabilities: PluginCapabilitySnapshot = {
      pluginId: 'codex',
      detectedAt: Date.now(),
      cached: true,
      supportsNativeSession: true,
      supportsNativeStart: true,
      supportsNativeContinue: true,
      nativeSessionSubcommand: 'resume',
      nativeSessionResumeMode: 'subcommand',
    };

    const start = await plugin.buildNativeStartInvocation(
      makeConfig({ argBuilder: 'codex' }),
      makeInput({ prompt: 'first-turn message' }),
      'codex-1',
      'session-123',
      capabilities,
    );

    expect(start.args).toEqual(['exec', '--json', '--model', 'codex-1']);

    const continueInvocation = await plugin.buildNativeContinueInvocation(
      makeConfig({ argBuilder: 'codex' }),
      makeInput({ prompt: 'continue message' }),
      'codex-1',
      'session-123',
      capabilities,
    );

    expect(continueInvocation.args).toEqual(['exec', 'resume', 'session-123', '--json', '--model', 'codex-1']);
  });
});
