/**
 * Coding Agent Hub — CLI Invoker
 *
 * Invokes coding agent CLIs (Claude, Gemini, Codex) as child processes.
 */

import { spawn } from 'node:child_process';
import { StdoutCollector, extractMessageContent } from './message-extractor.js';
import type { BackendConfig, ToolInput, ToolResult } from './types.js';

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
];

/**
 * Build CLI arguments based on backend type and input.
 */
export function buildArgs(config: BackendConfig, input: ToolInput): string[] {
  const model = input.model || config.defaultModel;

  switch (config.argBuilder) {
    case 'claude':
      return [
        '--print',
        '--model',
        model,
        '--output-format',
        'text',
        input.prompt,
      ];

    case 'gemini':
      return [
        '-p',
        input.prompt,
        '--output-format',
        'json',
        '--yolo',
        '-m',
        model,
        ...(input.workingDir ? ['--include-directories', input.workingDir] : []),
      ];

    case 'codex':
      return [
        'exec',
        input.prompt,
        '--json',
        '--model',
        model,
        '--full-auto',
        ...(input.workingDir ? ['--cd', input.workingDir] : []),
      ];

    case 'generic':
    default:
      return [input.prompt];
  }
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
export async function invokeCli(
  config: BackendConfig,
  input: ToolInput,
): Promise<ToolResult> {
  const startTime = Date.now();
  const model = input.model || config.defaultModel;
  const timeoutMs = input.timeoutMs || config.timeoutMs;
  const args = buildArgs(config, input);
  const env = buildEnv(config);

  return new Promise<ToolResult>((resolve) => {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), timeoutMs);

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
      });
      return;
    }

    const stdoutCollector = new StdoutCollector();
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => stdoutCollector.add(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        content: '',
        success: false,
        exitCode: null,
        durationMs: Date.now() - startTime,
        backend: config.name,
        model,
        error:
          err.name === 'AbortError'
            ? `Timeout after ${timeoutMs}ms`
            : err.message,
      });
    });

    child.on('exit', (exitCode) => {
      clearTimeout(timeout);

      const stdout = stdoutCollector.toString();
      const extracted = extractMessageContent(stdout, exitCode);
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      if (extracted && exitCode === 0) {
        resolve({
          content: extracted.content,
          success: true,
          exitCode,
          durationMs: Date.now() - startTime,
          backend: config.name,
          model,
        });
      } else {
        resolve({
          content: extracted?.content || stdout || stderr,
          success: false,
          exitCode,
          durationMs: Date.now() - startTime,
          backend: config.name,
          model,
          error:
            exitCode !== 0
              ? `Process exited with code ${exitCode}`
              : 'Failed to extract response content',
        });
      }
    });

    // End stdin immediately — the prompt is passed as an arg
    child.stdin?.end();
  });
}
