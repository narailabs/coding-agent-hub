/**
 * Coding Agent Hub — Preflight Checks
 *
 * Validates CLI availability and auth configuration at startup.
 * Logs results but does not disable backends (they fail with clear errors).
 */

import { execSync } from 'node:child_process';
import { logger } from './logger.js';
import type { BackendConfig } from './types.js';

export interface PreflightResult {
  backend: string;
  cliFound: boolean;
  authConfigured: boolean;
  warnings: string[];
}

/**
 * Check a single backend's CLI and auth configuration.
 */
export function checkBackend(config: BackendConfig): PreflightResult {
  const warnings: string[] = [];

  // Check if CLI command exists
  let cliFound = false;
  try {
    execSync(`which ${config.command}`, { stdio: 'pipe' });
    cliFound = true;
  } catch {
    warnings.push(`CLI "${config.command}" not found in PATH`);
  }

  // Check auth env var
  let authConfigured = true;
  if (config.authEnvVar) {
    const value = process.env[config.authEnvVar];
    if (!value || value.trim() === '') {
      authConfigured = false;
      warnings.push(`Auth env var ${config.authEnvVar} is not set`);
    }
  }

  return { backend: config.name, cliFound, authConfigured, warnings };
}

/**
 * Run preflight checks on all enabled backends and log results.
 */
export function runPreflightChecks(configs: BackendConfig[]): PreflightResult[] {
  const enabled = configs.filter((c) => c.enabled);
  const results: PreflightResult[] = [];

  for (const config of enabled) {
    const result = checkBackend(config);
    results.push(result);

    logger.info('Preflight check', {
      backend: result.backend,
      cliFound: result.cliFound,
      authConfigured: result.authConfigured,
    });

    for (const warning of result.warnings) {
      logger.warn(`Preflight: ${warning}`, { backend: result.backend });
    }
  }

  return results;
}
