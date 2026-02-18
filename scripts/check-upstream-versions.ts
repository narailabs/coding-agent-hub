/**
 * Check upstream project versions for supported coding agents.
 *
 * Uses npm registry latest tags and GitHub releases where available.
 */

import { request } from 'node:https';

type SourceKind = 'npm' | 'github';

interface UpstreamArtifact {
  backend: string;
  command: string;
  source: SourceKind;
  packageName?: string;
  githubRepo?: string;
  baseline: string;
  note?: string;
}

const UPSTREAM_SOURCES: UpstreamArtifact[] = [
  {
    backend: 'claude',
    command: 'claude',
    source: 'npm',
    packageName: '@anthropic-ai/claude-code',
    baseline: '2.1.45',
  },
  {
    backend: 'gemini',
    command: 'gemini',
    source: 'github',
    githubRepo: 'google-gemini/gemini-cli',
    baseline: '0.29.0',
  },
  {
    backend: 'codex',
    command: 'codex',
    source: 'npm',
    packageName: '@openai/codex',
    baseline: '0.103.0',
  },
  {
    backend: 'opencode',
    command: 'opencode',
    source: 'github',
    githubRepo: 'sst/opencode',
    baseline: '0.2.0',
  },
  {
    backend: 'copilot',
    command: 'copilot',
    source: 'npm',
    packageName: '@github/copilot',
    baseline: '0.0.411',
  },
  {
    backend: 'cursor',
    command: 'cursor-agent',
    source: 'github',
    githubRepo: 'cursor/cursor',
    baseline: 'n/a',
    note: 'No single canonical release endpoint available; report is best-effort.',
  },
];

interface CheckRow {
  backend: string;
  command: string;
  baseline: string;
  latest: string | null;
  source: string;
  status: 'ok' | 'newer' | 'older' | 'unknown';
  note?: string;
}

function requestJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'User-Agent': 'coding-agent-hub-version-check', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8').trim();
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });
    req.end();
  });
}

async function fetchNpmLatest(pkg: string): Promise<string> {
  const data = (await requestJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`)) as {
    version?: string;
  };
  const version = data.version;
  if (!version) {
    throw new Error(`No version field in npm latest payload for ${pkg}`);
  }
  return version;
}

async function fetchGithubLatest(repo: string): Promise<string> {
  const data = (await requestJson(`https://api.github.com/repos/${repo}/releases/latest`, {
    Accept: 'application/vnd.github+json',
  })) as { tag_name?: string };
  const tag = data.tag_name;
  if (!tag) {
    throw new Error(`No tag_name in GitHub release payload for ${repo}`);
  }
  return tag.replace(/^v/i, '');
}

function normalizeVersion(version: string): string {
  return version.replace(/^\s*[vV]\s*/, '').trim();
}

function compareVersion(a: string, b: string): number {
  const lhs = normalizeVersion(a)
    .split(/[.-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const rhs = normalizeVersion(b)
    .split(/[.-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

  const len = Math.max(lhs.length, rhs.length);
  for (let i = 0; i < len; i += 1) {
    const l = lhs[i] ?? 0;
    const r = rhs[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

async function checkArtifact(artifact: UpstreamArtifact): Promise<CheckRow> {
  try {
    let latest: string | null = null;
    if (artifact.source === 'npm' && artifact.packageName) {
      latest = await fetchNpmLatest(artifact.packageName);
    } else if (artifact.source === 'github' && artifact.githubRepo) {
      latest = await fetchGithubLatest(artifact.githubRepo);
    }

    let status: CheckRow['status'] = 'unknown';
    if (latest && artifact.baseline !== 'n/a') {
      const cmp = compareVersion(latest, artifact.baseline);
      if (cmp === 0) status = 'ok';
      else if (cmp > 0) status = 'newer';
      else status = 'older';
    }

    return {
      backend: artifact.backend,
      command: artifact.command,
      baseline: artifact.baseline,
      latest,
      source: artifact.source,
      status,
      note: artifact.note,
    };
  } catch (error) {
    return {
      backend: artifact.backend,
      command: artifact.command,
      baseline: artifact.baseline,
      latest: null,
      source: artifact.source,
      status: 'unknown',
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const checks = await Promise.all(UPSTREAM_SOURCES.map((artifact) => checkArtifact(artifact)));

  for (const check of checks) {
    const baseline = check.baseline;
    const latest = check.latest ?? 'n/a';
    const sourceLabel = check.source.toUpperCase();
    const statusLabel = {
      ok: 'up-to-date',
      newer: 'newer',
      older: 'older',
      unknown: 'unknown',
    }[check.status];
    const note = check.note ? ` // ${check.note}` : '';
    console.log(`[${sourceLabel}] ${check.backend} (${check.command})`);
    console.log(`  baseline=${baseline}`);
    console.log(`  latest=${latest}`);
    console.log(`  status=${statusLabel}${note}`);
  }

  const staleCount = checks.filter((item) => item.status === 'older').length;
  const unknownCount = checks.filter((item) => item.status === 'unknown').length;
  console.log(`\nSummary: ${checks.length} backends checked, ${staleCount} behind baseline, ${unknownCount} unknown.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
