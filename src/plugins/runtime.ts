/**
 * Coding Agent Hub — Plugin Runtime
 *
 * Resolves plugins, caches capability probes, and builds runtime invocations.
 */

import { logger } from '../logger.js';
import { PluginRegistry } from './registry.js';
import type {
  AgentPlugin,
  ContinuityMode,
  PluginCapabilitySnapshot,
  PluginDetectionContext,
  PluginRuntimeOptions,
  RuntimeInvocation,
  RuntimeInvocationContext,
} from './types.js';
import type { BackendConfig, ToolResult } from '../types.js';

const DEFAULT_CAPABILITY_CACHE_TTL_MS = 60_000;
const DEFAULT_DETECTION_TIMEOUT_MS = 5_000;

interface CachedCapability {
  capabilities: PluginCapabilitySnapshot;
  cachedAt: number;
}

export interface PluginSelection {
  plugin: AgentPlugin;
  capabilities: PluginCapabilitySnapshot;
  continuityMode: ContinuityMode;
}

export class PluginRuntime {
  private readonly registry: PluginRegistry;
  private readonly strict: boolean;
  private readonly capabilitiesCache = new Map<string, CachedCapability>();
  private readonly capabilityCacheTtlMs: number;
  private pluginLoadPromise?: Promise<void>;

  constructor(options: PluginRuntimeOptions = {}) {
    this.strict = options.strict ?? false;
    this.capabilityCacheTtlMs = options.capabilityCacheTtlMs ?? DEFAULT_CAPABILITY_CACHE_TTL_MS;
    this.registry = new PluginRegistry({ pluginPaths: options.pluginPaths, strict: this.strict });

    if (options.pluginPaths?.length) {
      this.pluginLoadPromise = this.registry.loadDynamicPlugins();
    }
  }

  async buildInvocation(context: RuntimeInvocationContext): Promise<RuntimeInvocation> {
    const plugin = await this.resolvePlugin(context.config);
    const capabilities = context.capabilities ?? (await this.getCapabilities(context.config, plugin));

    let mode: ContinuityMode = context.mode ?? plugin.preferredContinuity;
    if (mode === 'native' && !capabilities.supportsNativeSession) {
      mode = 'hub';
    }

    let invocation;
    if (mode === 'native') {
      if (!context.sessionRef) {
        throw new Error(`Missing sessionRef for native continuity (plugin: ${plugin.id})`);
      }

      invocation = context.isSessionStart
        ? await plugin.buildNativeStartInvocation(context.config, context.input, context.resolvedModel, context.sessionRef, capabilities)
        : await plugin.buildNativeContinueInvocation(context.config, context.input, context.resolvedModel, context.sessionRef, capabilities);
    } else {
      invocation = await plugin.buildOneShotInvocation(context.config, context.input, context.resolvedModel);
    }

    return {
      plugin,
      pluginId: plugin.id,
      mode,
      invocation,
      capabilities,
    };
  }

  async resolveSessionMetadata(config: BackendConfig): Promise<PluginSelection> {
    const plugin = await this.resolvePlugin(config);
    const capabilities = await this.getCapabilities(config, plugin);
    const continuityMode =
      plugin.preferredContinuity === 'native' && capabilities.supportsNativeSession ? 'native' : 'hub';

    return { plugin, capabilities, continuityMode };
  }

  isNativeFallbackError(result: ToolResult): boolean {
    if (!result.error && !result.stderr) {
      return false;
    }

    const text = `${result.error ?? ''} ${result.stderr ?? ''}`.toLowerCase();
    const hints = [
      'unknown option',
      'unrecognized',
      'invalid option',
      'missing required',
      'not recognized',
      'unknown flag',
      'no such option',
      'unexpected option',
      'invalid argument',
    ];

    return result.exitCode !== 0 && hints.some((hint) => text.includes(hint));
  }

  private async getCapabilities(config: BackendConfig, plugin: AgentPlugin): Promise<PluginCapabilitySnapshot> {
    const cacheKey = `${plugin.id}:${config.command}`;
    const now = Date.now();
    const cached = this.capabilitiesCache.get(cacheKey);
    if (cached && now - cached.cachedAt <= this.capabilityCacheTtlMs) {
      return { ...cached.capabilities, cached: true };
    }

    const detectionContext: PluginDetectionContext = {
      command: config.command,
      timeoutMs: DEFAULT_DETECTION_TIMEOUT_MS,
    };

    try {
      const capabilities = await plugin.detectCapabilities(detectionContext);
      const normalized = { ...capabilities, pluginId: capabilities.pluginId ?? plugin.id, cached: false };
      this.capabilitiesCache.set(cacheKey, { capabilities: normalized, cachedAt: now });
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.strict) {
        throw new Error(`Failed to detect plugin capabilities for ${plugin.id}: ${message}`);
      }

      logger.warn('Plugin capability detection failed; using fallback', {
        plugin: plugin.id,
        command: config.command,
        error: message,
      });

      const fallback = plugin.fallbackCapabilities(config);
      const normalized = { ...fallback, pluginId: fallback.pluginId ?? plugin.id, cached: true };
      this.capabilitiesCache.set(cacheKey, { capabilities: normalized, cachedAt: now });
      return normalized;
    }
  }

  private async resolvePlugin(config: BackendConfig): Promise<AgentPlugin> {
    await this.ensurePluginsLoaded();

    if (config.plugin) {
      const explicit = this.registry.getPlugin(config.plugin);
      if (explicit && explicit.matches(config)) {
        return explicit;
      }
      logger.warn('Configured plugin not found or did not match backend; using fallback', {
        backend: config.name,
        configuredPlugin: config.plugin,
      });
    }

    for (const plugin of this.registry.getPlugins()) {
      if (plugin.id === 'generic') {
        continue;
      }
      if (plugin.matches(config)) {
        return plugin;
      }
    }

    const fallback = this.registry.getPlugin('generic');
    if (!fallback) {
      throw new Error(`No plugin found for backend ${config.name}`);
    }

    if (this.strict) {
      throw new Error(`No plugin could claim backend ${config.name}`);
    }
    return fallback;
  }

  private async ensurePluginsLoaded(): Promise<void> {
    if (!this.pluginLoadPromise) return;
    await this.pluginLoadPromise;
    this.pluginLoadPromise = undefined;
  }
}
