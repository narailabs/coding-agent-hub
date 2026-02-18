/**
 * Coding Agent Hub — Plugin Registry
 *
 * Owns built-in plugin definitions and dynamic plugin module loading.
 */

import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { logger } from '../logger.js';
import { getAdapter } from '../adapters/index.js';
import { LegacyAdapterPlugin } from './legacy-adapter-plugin.js';
import type { AgentPlugin, ContinuityMode } from './types.js';

interface RegistryOptions {
  pluginPaths?: string[];
  strict?: boolean;
}

interface RawPluginModule {
  plugins?: unknown;
  default?: unknown;
  plugin?: unknown;
}

function isAgentPlugin(value: unknown): value is AgentPlugin {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<AgentPlugin>;

  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.displayName === 'string' &&
    candidate.displayName.trim().length > 0 &&
    (candidate.preferredContinuity === 'hub' || candidate.preferredContinuity === 'native') &&
    typeof candidate.matches === 'function' &&
    typeof candidate.detectCapabilities === 'function' &&
    typeof candidate.buildOneShotInvocation === 'function' &&
    typeof candidate.buildNativeStartInvocation === 'function' &&
    typeof candidate.buildNativeContinueInvocation === 'function' &&
    typeof candidate.extractResponse === 'function' &&
    typeof candidate.fallbackCapabilities === 'function'
  );
}

function toPluginArray(moduleValue: unknown): AgentPlugin[] {
  if (!moduleValue) return [];

  const moduleExports = moduleValue as RawPluginModule;
  const candidates: unknown[] = [];

  if (Array.isArray(moduleExports.plugins)) {
    candidates.push(...moduleExports.plugins);
  }

  if (moduleExports.default !== undefined) {
    candidates.push(moduleExports.default);
  }

  if (moduleExports.plugin !== undefined) {
    candidates.push(moduleExports.plugin);
  }

  if (candidates.length === 0) {
    candidates.push(moduleValue);
  }

  const resolved: AgentPlugin[] = [];
  const seen = new Set<unknown>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    if (isAgentPlugin(candidate)) {
      resolved.push(candidate);
      continue;
    }

    if (typeof candidate === 'function') {
      const instance = new (candidate as new () => unknown)();
      if (isAgentPlugin(instance)) {
        resolved.push(instance);
      }
    }
  }

  return resolved;
}

function resolvePluginPath(rawPath: string): string {
  if (rawPath.startsWith('file:')) return rawPath;
  if (rawPath.startsWith('.') || rawPath.startsWith('/')) {
    const absolute = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
    return pathToFileURL(absolute).href;
  }
  return rawPath;
}

const BUILTIN_PLUGIN_DEFINITIONS: Array<{
  id: string;
  displayName: string;
  adapterId: string;
  preferredContinuity: ContinuityMode;
  nativeFlags: string[];
  nativeSessionResumeMode?: 'flag' | 'subcommand';
  subcommand?: string;
  fallbackNative: boolean;
}> = [
  {
    id: 'claude',
    displayName: 'Claude Plugin',
    adapterId: 'claude',
    preferredContinuity: 'native',
    nativeFlags: ['--session-id', '--resume', '--continue'],
    fallbackNative: true,
  },
  {
    id: 'gemini',
    displayName: 'Gemini Plugin',
    adapterId: 'gemini',
    preferredContinuity: 'hub',
    nativeFlags: ['--resume', '--session-id'],
    fallbackNative: true,
  },
  {
    id: 'codex',
    displayName: 'Codex Plugin',
    adapterId: 'codex',
    preferredContinuity: 'native',
    nativeFlags: ['--resume'],
    nativeSessionResumeMode: 'subcommand',
    subcommand: 'resume',
    fallbackNative: true,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode Plugin',
    adapterId: 'opencode',
    preferredContinuity: 'native',
    nativeFlags: ['--continue', '--session'],
    fallbackNative: true,
  },
  {
    id: 'copilot',
    displayName: 'Copilot Plugin',
    adapterId: 'copilot',
    preferredContinuity: 'native',
    nativeFlags: ['--resume', '--continue', '--session-id'],
    fallbackNative: true,
  },
  {
    id: 'cursor',
    displayName: 'Cursor Plugin',
    adapterId: 'cursor',
    preferredContinuity: 'native',
    nativeFlags: ['--resume', '--continue', '--session-id'],
    fallbackNative: true,
  },
  {
    id: 'generic',
    displayName: 'Generic Plugin',
    adapterId: 'generic',
    preferredContinuity: 'hub',
    nativeFlags: ['--session-id'],
    fallbackNative: false,
  },
];

export class PluginRegistry {
  private readonly plugins = new Map<string, AgentPlugin>();
  private readonly strict: boolean;
  private readonly pluginPaths: string[];

  constructor(options: RegistryOptions = {}) {
    this.strict = options.strict ?? false;
    this.pluginPaths = options.pluginPaths ?? [];
    this.registerBuiltinPlugins();
  }

  getPlugin(id: string): AgentPlugin | undefined {
    return this.plugins.get(id);
  }

  getPlugins(): Iterable<AgentPlugin> {
    return this.plugins.values();
  }

  hasPlugin(id: string): boolean {
    return this.plugins.has(id);
  }

  async loadDynamicPlugins(): Promise<void> {
    for (const rawPath of this.pluginPaths) {
      const pluginPath = resolvePluginPath(rawPath);
      try {
        const moduleValue = await import(pluginPath);
        const candidates = toPluginArray(moduleValue);
        if (candidates.length === 0) {
          if (this.strict) {
            throw new Error(`No plugin exports found in ${rawPath}`);
          }
          logger.warn('No plugin exports found; skipping', { path: rawPath });
          continue;
        }

        for (const candidate of candidates) {
          this.register(candidate);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.strict) {
          throw new Error(`Failed to load plugin module ${rawPath}: ${message}`);
        }
        logger.warn('Failed to load plugin module', { path: rawPath, error: message });
      }
    }
  }

  private register(plugin: AgentPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn('Overwriting existing plugin registration', { pluginId: plugin.id });
    }
    this.plugins.set(plugin.id, plugin);
  }

  private registerBuiltinPlugins(): void {
    for (const wrapper of BUILTIN_PLUGIN_DEFINITIONS) {
      const adapter = getAdapter(wrapper.adapterId);
      this.register(
        new LegacyAdapterPlugin({
          id: wrapper.id,
          displayName: wrapper.displayName,
          adapter,
          preferredContinuity: wrapper.preferredContinuity,
          nativeFlags: wrapper.nativeFlags,
          nativeSessionResumeMode: wrapper.nativeSessionResumeMode,
          subcommand: wrapper.subcommand,
          subcommandOnlyForContinue: wrapper.subcommand === 'resume',
          fallbackNative: wrapper.fallbackNative,
        }),
      );
    }
  }
}
