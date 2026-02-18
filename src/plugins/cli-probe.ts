/**
 * Coding Agent Hub — CLI Probe Utilities
 *
 * Runtime capability probing uses `--version` and `--help` to keep compatibility
 * with evolving CLI versions without hard-coding every flag.
 */

import { execFile } from 'node:child_process';

const MAX_PROBE_BYTES = 128 * 1024;

export interface ProbeResult {
  version?: string;
  help?: string;
}

function runProbe(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_PROBE_BYTES }, (error, stdout, stderr) => {
      if (error) {
        const output = `${stdout ?? ''}${stderr ?? ''}`.trim();
        resolve(output);
        return;
      }
      resolve(`${stdout}`.trim());
    });
  });
}

export async function detectCliHelpAndVersion(
  command: string,
  timeoutMs = 5000,
): Promise<ProbeResult> {
  const [versionRaw, helpRaw] = await Promise.all([
    runProbe(command, ['--version'], timeoutMs),
    runProbe(command, ['--help'], timeoutMs),
  ]);

  const version = versionRaw
    ? versionRaw.split('\n')[0]?.trim() || undefined
    : undefined;
  const help = [helpRaw].filter(Boolean).join('\n').trim();
  return { version, help };
}

export function extractCliFlags(text: string): Set<string> {
  const flagSet = new Set<string>();
  const flagRegex = /--[A-Za-z0-9][A-Za-z0-9-_]*/g;
  let match: RegExpExecArray | null;
  while ((match = flagRegex.exec(text)) !== null) {
    flagSet.add(match[0]);
  }
  return flagSet;
}

export function chooseFlag(flags: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((candidate) => flags.has(candidate));
}
