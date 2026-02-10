/**
 * Coding Agent Hub — Configuration
 *
 * Loads hub configuration from file (~/.coding-agent-hub/config.json) or env vars.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_BACKENDS } from './backends.js';
import type { BackendConfig, HubConfig } from './types.js';

/**
 * Default config file location.
 */
export function getDefaultConfigPath(): string {
  return join(homedir(), '.coding-agent-hub', 'config.json');
}

/**
 * Load config from a JSON file. Returns null if file doesn't exist.
 */
export function loadConfigFile(path: string): HubConfig | null {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as HubConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve the final list of backend configs by merging defaults with overrides.
 */
export function resolveBackends(
  hubConfig: HubConfig | null,
  enabledFilter?: string[],
): BackendConfig[] {
  const configs = new Map<string, BackendConfig>();

  // Start with defaults
  for (const backend of DEFAULT_BACKENDS) {
    configs.set(backend.name, { ...backend });
  }

  // Apply overrides from config file
  if (hubConfig?.backends) {
    for (const [name, overrides] of Object.entries(hubConfig.backends)) {
      if (!overrides) continue;
      const existing = configs.get(name);
      if (existing) {
        configs.set(name, { ...existing, ...overrides, name });
      } else {
        // Custom backend — needs all required fields
        if (overrides.command && overrides.displayName && overrides.defaultModel) {
          configs.set(name, {
            name,
            displayName: overrides.displayName,
            command: overrides.command,
            enabled: overrides.enabled ?? true,
            defaultModel: overrides.defaultModel,
            authEnvVar: overrides.authEnvVar,
            timeoutMs: overrides.timeoutMs ?? hubConfig.defaultTimeoutMs ?? 120_000,
            argBuilder: overrides.argBuilder ?? 'generic',
          });
        }
      }
    }
  }

  // Apply global timeout default
  if (hubConfig?.defaultTimeoutMs) {
    for (const [name, config] of configs) {
      // Only apply if the backend is using the original default
      const defaultBackend = DEFAULT_BACKENDS.find((b) => b.name === name);
      if (defaultBackend && config.timeoutMs === defaultBackend.timeoutMs) {
        config.timeoutMs = hubConfig.defaultTimeoutMs;
      }
    }
  }

  let result = Array.from(configs.values());

  // Filter to only requested backends if specified
  if (enabledFilter) {
    result = result.map((b) => ({
      ...b,
      enabled: enabledFilter.includes(b.name),
    }));
  }

  return result;
}

/**
 * Parse CLI args for the hub entry point.
 */
export function parseArgs(argv: string[]): {
  configPath?: string;
  backends?: string[];
} {
  const result: { configPath?: string; backends?: string[] } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config' && argv[i + 1]) {
      result.configPath = argv[++i];
    } else if (arg === '--backends' && argv[i + 1]) {
      result.backends = argv[++i].split(',').map((s) => s.trim());
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return result;
}

function printUsage(): void {
  console.log(`coding-agent-hub — MCP server for coding agent CLIs

Usage:
  coding-agent-hub [options]

Options:
  --config <path>       Path to config file (default: ~/.coding-agent-hub/config.json)
  --backends <list>     Comma-separated list of backends to enable (e.g., gemini,codex)
  --help, -h            Show this help message

Examples:
  # Start with all defaults
  coding-agent-hub

  # Only enable Gemini and Codex
  coding-agent-hub --backends gemini,codex

  # Use custom config
  coding-agent-hub --config ./my-config.json

Claude Code integration:
  Add to .claude/settings.json:
  {
    "mcpServers": {
      "coding-agent-hub": {
        "command": "npx",
        "args": ["coding-agent-hub"]
      }
    }
  }
`);
}
