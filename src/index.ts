#!/usr/bin/env node

/**
 * Coding Agent Hub — CLI Entry Point
 *
 * Starts a stdio MCP server exposing coding agent CLIs as tools.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHubServer } from './hub-server.js';
import { loadConfigFile, getDefaultConfigPath, resolveBackends, parseArgs } from './config.js';
import { logger } from './logger.js';
import { runPreflightChecks } from './preflight.js';
import { FileSessionStore } from './session-store.js';
import { PluginRuntime } from './plugins/index.js';
import type { SessionConfig } from './session-manager.js';
import type { SessionStore } from './session-store.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const configPath = args.configPath || getDefaultConfigPath();
  const hubConfig = loadConfigFile(configPath);

  const backends = resolveBackends(hubConfig, args.backends);
  const enabledCount = backends.filter((b) => b.enabled).length;

  if (enabledCount === 0) {
    console.error('No backends enabled. Use --backends to specify which backends to enable.');
    process.exit(1);
  }

  const sessionConfig: SessionConfig = {
    ...hubConfig?.session,
    ...(args.sessionTimeoutMs ? { idleTimeoutMs: args.sessionTimeoutMs } : {}),
  };

  // Set up optional session persistence
  let sessionStore: SessionStore | undefined;
  if (hubConfig?.sessionPersistence) {
    const sessionsDir = join(homedir(), '.coding-agent-hub', 'sessions');
    sessionStore = new FileSessionStore(sessionsDir);
    logger.info('Session persistence enabled', { dir: sessionsDir });
  }

  logger.info('Starting coding-agent-hub', {
    enabledBackends: backends.filter((b) => b.enabled).map((b) => b.name),
    enabledCount,
  });

  runPreflightChecks(backends);

  const pluginRuntime = new PluginRuntime(hubConfig?.plugins);
  const server = createHubServer(backends, sessionConfig, sessionStore, pluginRuntime);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
