/**
 * Verify installed agent CLI argument compatibility against hub plugin expectations.
 */

import { DEFAULT_BACKENDS } from '../src/backends.js';
import { PluginRuntime } from '../src/plugins/index.js';
import type { BackendConfig } from '../src/types.js';
import type { PluginCapabilitySnapshot } from '../src/plugins/types.js';

interface FlagRequirement {
  backend: string;
  command: string;
  expectsNative: boolean;
  requiredFlags?: string[];
  requiredSubcommand?: string;
  notes?: string;
}

const REQUIREMENTS: FlagRequirement[] = [
  {
    backend: 'claude',
    command: 'claude',
    expectsNative: true,
    requiredFlags: ['--session-id', '--resume', '--continue'],
    notes: 'Claude supports native continuation when session flags are available.',
  },
  {
    backend: 'gemini',
    command: 'gemini',
    expectsNative: false,
    notes: 'Gemini is currently treated as hub continuity by default.',
  },
  {
    backend: 'codex',
    command: 'codex',
    expectsNative: true,
    requiredSubcommand: 'resume',
    notes: 'Codex uses `exec resume` style native continuation.',
  },
  {
    backend: 'opencode',
    command: 'opencode',
    expectsNative: true,
    requiredFlags: ['--continue', '--session'],
    notes: 'OpenCode requires native resume when supported.',
  },
  {
    backend: 'copilot',
    command: 'copilot',
    expectsNative: true,
    requiredFlags: ['--resume', '--continue', '--session-id'],
    notes: 'Copilot should support native session continuation for long-running usage.',
  },
  {
    backend: 'cursor',
    command: 'cursor-agent',
    expectsNative: true,
    requiredFlags: ['--resume', '--continue', '--session-id'],
    notes: 'Cursor is expected to support native session continuation.',
  },
];

interface CheckResult {
  backend: string;
  command: string;
  version: string | null;
  expectation: string;
  issues: string[];
  supportsNative: boolean;
  snapshot: PluginCapabilitySnapshot | null;
}

function findBackendConfig(name: string): BackendConfig | undefined {
  return DEFAULT_BACKENDS.find((b) => b.name === name);
}

function formatPass(status: string): string {
  return `✅ ${status}`;
}

function formatWarn(status: string): string {
  return `⚠️ ${status}`;
}

async function main(): Promise<void> {
  const runtime = new PluginRuntime();
  const issues: CheckResult[] = [];

  for (const requirement of REQUIREMENTS) {
    const config = findBackendConfig(requirement.backend);
    if (!config) {
      issues.push({
        backend: requirement.backend,
        command: requirement.command,
        version: null,
        expectation: `Missing config for ${requirement.backend}`,
        issues: [`No backend config found for ${requirement.backend}`],
        supportsNative: false,
        snapshot: null,
      });
      continue;
    }

    let supportsNative = false;
    let snapshot: PluginCapabilitySnapshot | null = null;
    let version = null;
    const details: string[] = [];

      try {
        const metadata = await runtime.resolveSessionMetadata(config);
        snapshot = metadata.capabilities;
        version = metadata.capabilities.version ?? null;
        supportsNative = metadata.capabilities.supportsNativeSession;

      if (requirement.expectsNative && !supportsNative) {
        details.push('Expected native session capability, but capabilities report native unsupported');
      }

      if (!requirement.expectsNative && supportsNative) {
        details.push('Expected hub-only behavior, but native session capability was detected');
      }

      if (requirement.requiredSubcommand) {
        const subcommand = metadata.capabilities.nativeSessionSubcommand;
        if (subcommand !== requirement.requiredSubcommand) {
          details.push(
            `Expected subcommand "${requirement.requiredSubcommand}" but got "${subcommand ?? 'none'}"`,
          );
        }
      }

      if (requirement.requiredFlags && requirement.requiredFlags.length > 0) {
        const hasRequiredFlag = requirement.requiredFlags.some(
          (f) => metadata.capabilities.nativeSessionFlag === f || metadata.capabilities.nativeSessionFlag?.endsWith(f),
        );
        if (!hasRequiredFlag) {
          const resolved = metadata.capabilities.nativeSessionFlag ?? 'none';
          details.push(`No expected native flag among ${requirement.requiredFlags.join(', ')} (resolved: ${resolved})`);
        }
      }

      issues.push({
        backend: requirement.backend,
        command: requirement.command,
        version,
        expectation: requirement.expectsNative ? 'native' : 'hub',
        supportsNative,
        issues: details,
        snapshot: metadata.capabilities,
      });
    } catch (error) {
      issues.push({
        backend: requirement.backend,
        command: requirement.command,
        version,
        expectation: requirement.expectsNative ? 'native' : 'hub',
        supportsNative: false,
        snapshot: null,
        issues: [
          error instanceof Error ? error.message : String(error),
          'Could not resolve runtime capabilities; command may be missing or not executable',
        ],
      });
    }
  }

  let failed = 0;
  for (const item of issues) {
    const statusParts = [`${item.backend} (${item.command})`, `version=${item.version ?? 'n/a'}`, `expect=${item.expectation}`];
    const hasIssue = item.issues.length > 0;
    console.log(`${hasIssue ? formatWarn(statusParts.join(', ')) : formatPass(statusParts.join(', '))}`);

    if (hasIssue) {
      failed += 1;
      for (const issue of item.issues) {
        console.log(`  - ${issue}`);
      }
    }
    if (!hasIssue && item.snapshot) {
      const resumeMode = item.snapshot.nativeSessionResumeMode ?? 'flag';
      const nativeFlag = item.snapshot.nativeSessionFlag ?? 'unknown';
      console.log(`  - mode=${item.snapshot.supportsNativeSession ? 'native' : 'hub'}`);
      console.log(`  - native resume mode=${resumeMode}`);
      if (nativeFlag) {
        console.log(`  - native flag=${nativeFlag}`);
      }
      if (item.snapshot.nativeSessionSubcommand) {
        console.log(`  - native subcommand=${item.snapshot.nativeSessionSubcommand}`);
      }
      if (item.snapshot.version) {
        console.log(`  - detected version=${item.snapshot.version}`);
      }
      if (item.snapshot.supportsNativeStart === false || item.snapshot.supportsNativeContinue === false) {
        console.log(`  - continue/start supported start=${item.snapshot.supportsNativeStart} continue=${item.snapshot.supportsNativeContinue}`);
      }
    }
  }

  if (failed > 0) {
    console.log(`\nSummary: ${failed} backend(s) with potential compatibility gaps.`);
    return;
  }

  console.log('\nSummary: all agent CLIs matched expected runtime behavior.');
}

main().catch((error) => {
  console.error('Verification script failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
