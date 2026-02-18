/**
 * Coding Agent Hub — Adapter-Backed Plugin
 *
 * Wraps an existing adapter so migration to the plugin layer can stay
 * compatibility-first while giving each backend plugin-owned session strategy.
 */

import { detectCliHelpAndVersion, chooseFlag, extractCliFlags } from './cli-probe.js';
import type { AgentPlugin, ContinuityMode, PluginCapabilitySnapshot, PluginInvocation, PluginDetectionContext } from './types.js';
import type { BackendConfig, ToolInput } from '../types.js';
import type { BackendAdapter } from '../adapters/types.js';

const DEFAULT_TIMEOUT_MS = 5000;

interface LegacyAdapterPluginOptions {
  preferredContinuity: ContinuityMode;
  nativeFlags?: string[];
  nativeSessionResumeMode?: 'flag' | 'subcommand';
  subcommand?: string;
  fallbackNative?: boolean;
  /** Some backends only support subcommand-based continuation, not creation. */
  subcommandOnlyForContinue?: boolean;
}

function hasSubcommand(helpText: string, subcommand: string): boolean {
  const token = subcommand.trim();
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(helpText);
}

function cloneArgs(args: string[]): string[] {
  return args.slice();
}

function insertFlagPromptMode(args: string[], prompt: string, sessionRef: string, flag: string): string[] {
  const promptIndex = prompt ? args.lastIndexOf(prompt) : -1;
  if (promptIndex < 0) {
    if (flag === '--continue') {
      return [...args, flag];
    }
    return [...args, flag, sessionRef];
  }

  const beforePrompt = args.slice(0, promptIndex);
  const afterPrompt = args.slice(promptIndex);
  if (flag === '--continue') {
    return [...beforePrompt, flag, ...afterPrompt];
  }

  return [...beforePrompt, flag, sessionRef, ...afterPrompt];
}

function insertSubcommand(args: string[], subcommand: string, sessionRef?: string): string[] {
  if (!subcommand) return args;
  if (args.includes(subcommand)) return args;

  const out = cloneArgs(args);
  if (out.length > 0 && out[0] === 'exec') {
    out.splice(1, 0, subcommand);
    if (sessionRef !== undefined) {
      out.splice(2, 0, sessionRef);
    }
    return out;
  }

  if (sessionRef !== undefined) {
    return [out[0], subcommand, sessionRef, ...out.slice(1)];
  }

  return [subcommand, ...out];
}

export class LegacyAdapterPlugin implements AgentPlugin {
  public readonly id: string;
  public readonly displayName: string;
  public readonly preferredContinuity: ContinuityMode;
  private readonly adapter: BackendAdapter;
  private readonly nativeFlags: string[];
  private readonly nativeSessionResumeMode: 'flag' | 'subcommand';
  private readonly subcommand?: string;
  private readonly fallbackNative: boolean;
  private readonly subcommandOnlyForContinue: boolean;

  constructor(options: {
    id: string;
    displayName: string;
    adapter: BackendAdapter;
    preferredContinuity: ContinuityMode;
    nativeFlags?: string[];
    nativeSessionResumeMode?: 'flag' | 'subcommand';
    subcommand?: string;
    fallbackNative?: boolean;
    subcommandOnlyForContinue?: boolean;
  }) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.adapter = options.adapter;
    this.preferredContinuity = options.preferredContinuity;
    this.nativeFlags = options.nativeFlags ?? ['--session-id', '--continue', '--resume'];
    this.nativeSessionResumeMode = options.nativeSessionResumeMode ?? 'flag';
    this.subcommand = options.subcommand;
    this.fallbackNative = options.fallbackNative ?? true;
    this.subcommandOnlyForContinue = options.subcommandOnlyForContinue ?? false;
  }

  matches(config: BackendConfig): boolean {
    return config.plugin === this.id || config.argBuilder === this.id;
  }

  async detectCapabilities(context: PluginDetectionContext): Promise<PluginCapabilitySnapshot> {
    const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const probe = await detectCliHelpAndVersion(context.command, timeoutMs);
    const flags = extractCliFlags(probe.help ?? '');
    const nativeFlag = chooseFlag(flags, this.nativeFlags);
    const subcommandPresent = this.subcommand ? hasSubcommand(probe.help ?? '', this.subcommand) : false;

    const supportsNative =
      this.preferredContinuity === 'native' &&
      (nativeFlag !== undefined || subcommandPresent || this.fallbackNative);

    return {
      pluginId: this.id,
      version: probe.version,
      helpText: probe.help,
      detectedAt: Date.now(),
      cached: false,
      supportsNativeSession: supportsNative,
      nativeSessionFlag: nativeFlag,
      nativeSessionSubcommand: this.subcommand || undefined,
      nativeSessionResumeMode: this.subcommand ? 'subcommand' : this.nativeSessionResumeMode,
      supportsNativeStart: supportsNative,
      supportsNativeContinue: supportsNative,
      note: nativeFlag || subcommandPresent ? `detected:${nativeFlag ?? this.subcommand}` : 'not-detected',
    };
  }

  async buildOneShotInvocation(config: BackendConfig, input: ToolInput, resolvedModel: string): Promise<PluginInvocation> {
    return this.withPromptDelivery(config, input, resolvedModel);
  }

  async buildNativeStartInvocation(
    config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
    sessionRef: string,
    capabilities: PluginCapabilitySnapshot,
  ): Promise<PluginInvocation> {
    if (!capabilities.supportsNativeSession || !this.canUseNative(capabilities)) {
      throw new Error(`Native session not supported by plugin ${this.id}`);
    }

    return this.withSession(config, input, resolvedModel, 'start', sessionRef, capabilities);
  }

  async buildNativeContinueInvocation(
    config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
    sessionRef: string,
    capabilities: PluginCapabilitySnapshot,
  ): Promise<PluginInvocation> {
    if (!capabilities.supportsNativeSession || !this.canUseNative(capabilities)) {
      throw new Error(`Native session not supported by plugin ${this.id}`);
    }

    return this.withSession(config, input, resolvedModel, 'continue', sessionRef, capabilities);
  }

  extractResponse(stdout: string, exitCode: number | null) {
    return this.adapter.extractResponse(stdout, exitCode);
  }

  fallbackCapabilities(config: BackendConfig): PluginCapabilitySnapshot {
    return {
      pluginId: this.id,
      detectedAt: Date.now(),
      cached: false,
      supportsNativeSession: this.fallbackNative && this.preferredContinuity === 'native',
      nativeSessionFlag: this.nativeFlags[0],
      nativeSessionSubcommand: this.subcommand,
      nativeSessionResumeMode: this.subcommand ? 'subcommand' : this.nativeSessionResumeMode,
      supportsNativeStart: this.fallbackNative && this.preferredContinuity === 'native',
      supportsNativeContinue: this.fallbackNative && this.preferredContinuity === 'native',
      note: 'fallback-capabilities',
      ...(config.command ? {} : {}),
    };
  }

  private canUseNative(capabilities: PluginCapabilitySnapshot): boolean {
    return capabilities.supportsNativeSession || (this.fallbackNative && this.preferredContinuity === 'native');
  }

  private async withPromptDelivery(
    _config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
  ): Promise<PluginInvocation> {
    const useStdin = this.adapter.promptDelivery === 'stdin';
    const args = useStdin && this.adapter.buildArgsWithoutPrompt
      ? this.adapter.buildArgsWithoutPrompt(input, resolvedModel)
      : this.adapter.buildArgs(input, resolvedModel);

    return { args, ...(useStdin ? { stdinData: input.prompt } : {}) };
  }

  private async withSession(
    _config: BackendConfig,
    input: ToolInput,
    resolvedModel: string,
    _mode: 'start' | 'continue',
    sessionRef: string,
    capabilities: PluginCapabilitySnapshot,
  ): Promise<PluginInvocation> {
    const useStdin = this.adapter.promptDelivery === 'stdin';
    let args = useStdin && this.adapter.buildArgsWithoutPrompt
      ? this.adapter.buildArgsWithoutPrompt(input, resolvedModel)
      : this.adapter.buildArgs(input, resolvedModel);

    if (capabilities.nativeSessionResumeMode === 'subcommand' && this.subcommand) {
      const shouldUseSubcommandForStart = !this.subcommandOnlyForContinue;
      if (_mode === 'continue' || shouldUseSubcommandForStart) {
        args = insertSubcommand(args, this.subcommand, sessionRef);
      }
    } else {
      const flag = capabilities.nativeSessionFlag ?? this.nativeFlags[0];
      if (flag) {
        args = insertFlagPromptMode(args, input.prompt, sessionRef, flag);
      }
    }

    return { args, ...(useStdin ? { stdinData: input.prompt } : {}) };
  }
}
