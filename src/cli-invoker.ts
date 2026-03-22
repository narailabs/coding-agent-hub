/**
 * Coding Agent Hub — CLI Invoker
 *
 * Invokes coding agent CLIs (Claude, Gemini, Codex) as child processes.
 */

import { spawn } from 'node:child_process';
import { StdoutCollector } from './message-extractor.js';
import { getAdapter } from './adapters/index.js';
import { logger } from './logger.js';
import type { BackendConfig, ErrorType, ToolInput, ToolResult } from './types.js';
import type { AgentPlugin, PluginInvocation } from './plugins/types.js';

/** Minimum timeout in milliseconds. */
const MIN_TIMEOUT_MS = 1_000;

/** Maximum timeout in milliseconds (10 minutes). */
const MAX_TIMEOUT_MS = 600_000;

/** Default timeout in milliseconds (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Patterns in stderr that indicate authentication failures.
 * Use word boundaries to avoid false positives on URLs or unrelated numbers.
 */
const AUTH_ERROR_PATTERNS = [
  /\b401\b.*unauthorized/i,
  /\b403\b.*forbidden/i,
  /\bunauthorized\b/i,
  /\bapi[_\s-]?key\b.*(?:missing|invalid|expired)/i,
  /\bauthentication\s+(?:failed|error|required)\b/i,
];

/**
 * Environment variables safe to pass to CLI processes.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'NODE_ENV',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // API keys for multi-provider backends (e.g. OpenCode)
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'GITHUB_TOKEN',
  'CURSOR_API_KEY',
];

/**
 * Build CLI arguments based on backend type and input.
 * Delegates to the appropriate backend adapter.
 */
export function buildArgs(config: BackendConfig, input: ToolInput): string[] {
  const model = input.model || config.defaultModel;
  const adapter = getAdapter(config.argBuilder);
  return adapter.buildArgs(input, model);
}

/**
 * Build filtered environment for a CLI process.
 */
export function buildEnv(config: BackendConfig): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};

  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }

  // Pass through the auth env var if configured
  if (config.authEnvVar && process.env[config.authEnvVar]) {
    env[config.authEnvVar] = process.env[config.authEnvVar];
  }

  return env;
}

/**
 * Invoke a CLI backend and return the result.
 */
export interface InvokeCliOptions {
  invocation?: PluginInvocation;
  plugin?: AgentPlugin;
}

export async function invokeCli(
  config: BackendConfig,
  input: ToolInput,
  options: InvokeCliOptions = {},
): Promise<ToolResult> {
  const startTime = Date.now();
  const model = input.model || config.defaultModel;
  const rawTimeout = input.timeoutMs || config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, rawTimeout));
  const adapter = getAdapter(config.argBuilder);
  const parserPlugin = options.plugin;
  const parser = parserPlugin
    ? parserPlugin.extractResponse.bind(parserPlugin)
    : adapter.extractResponse.bind(adapter);
  const env = buildEnv(config);

  // Use stdin delivery when adapter supports it to avoid ARG_MAX limits
  let args: string[];
  let stdinData: string | undefined;

  if (options.invocation) {
    args = options.invocation.args;
    stdinData = options.invocation.stdinData;
  } else if (adapter.promptDelivery === 'stdin' && adapter.buildArgsWithoutPrompt) {
    args = adapter.buildArgsWithoutPrompt(input, model);
    stdinData = input.prompt;
  } else {
    args = adapter.buildArgs(input, model);
  }

  const invocation = new Promise<ToolResult>((resolve) => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), timeoutMs);

    logger.debug('Spawning CLI', { backend: config.name, command: config.command, args, cwd: input.workingDir });

    let child;
    try {
      child = spawn(config.command, args, {
        cwd: input.workingDir || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      resolve({
        content: '',
        success: false,
        exitCode: null,
        durationMs: Date.now() - startTime,
        backend: config.name,
        model,
        error: `Failed to spawn ${config.command}: ${err instanceof Error ? err.message : String(err)}`,
        errorType: 'spawn',
        retryable: false,
      });
      return;
    }

    const stdoutCollector = new StdoutCollector();
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutCollector.add(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      clearTimeout(timeout);
      const isTimeout = err.name === 'AbortError';
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      resolve({
        content: '',
        success: false,
        exitCode: null,
        durationMs: Date.now() - startTime,
        backend: config.name,
        model,
        error: isTimeout ? `Timeout after ${timeoutMs}ms` : err.message,
        errorType: isTimeout ? 'timeout' : 'unknown',
        timedOut: isTimeout,
        stderr,
        retryable: isTimeout,
      });
    });

    child.on('exit', (exitCode) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      logger.info('CLI exited', { backend: config.name, exitCode, durationMs });

      const stdout = stdoutCollector.toString();
      const extracted = parser(stdout, exitCode);
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      if (extracted && exitCode === 0) {
        resolve({
          content: extracted.content,
          success: true,
          exitCode,
          durationMs,
          backend: config.name,
          model,
          runtimeModel: extracted.runtimeModel,
          stderr,
        });
      } else {
        let errorType: ErrorType;
        if (exitCode !== 0 && AUTH_ERROR_PATTERNS.some((p) => p.test(stderr))) {
          errorType = 'auth';
        } else if (exitCode !== 0) {
          errorType = 'exit';
        } else {
          errorType = 'parse';
        }

        resolve({
          content: extracted?.content || stdout || stderr,
          success: false,
          exitCode,
          durationMs,
          backend: config.name,
          model,
          error:
            exitCode !== 0
              ? `Process exited with code ${exitCode}`
              : 'Failed to extract response content',
          errorType,
          stderr,
          retryable: errorType === 'exit',
        });
      }
    });

    // Write prompt to stdin if using stdin delivery, then close.
    // Guard against errors if the child exits before stdin is consumed.
    try {
      if (stdinData) {
        child.stdin?.write(stdinData);
      }
      child.stdin?.end();
    } catch {
      // Child may have already exited; the 'exit' or 'error' handler will resolve.
    }
  });

  return invocation.then((result) => (parserPlugin?.classifyError ? parserPlugin.classifyError(result) : result));
}
