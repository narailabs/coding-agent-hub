#!/usr/bin/env node

/**
 * Coding Agent Hub — CLI Entry Point
 *
 * Starts a stdio MCP server exposing coding agent CLIs as tools.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHubServer } from './hub-server.js';
import { loadConfigFile, getDefaultConfigPath, resolveBackends, parseArgs } from './config.js';
import type { SessionConfig } from './session-manager.js';

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

  const server = createHubServer(backends, sessionConfig);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
