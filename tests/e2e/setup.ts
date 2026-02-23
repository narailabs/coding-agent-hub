import { execSync } from 'node:child_process';

export function checkCliAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function checkEnvVar(name: string): boolean {
  return !!process.env[name];
}

export function skipUnless(cli: string, envVar: string | string[]): string | null {
  const cliOk = checkCliAvailable(cli);
  const envVars = Array.isArray(envVar) ? envVar : [envVar];
  const envOk = envVars.some(checkEnvVar);
  if (!cliOk || !envOk) {
    const reasons: string[] = [];
    if (!cliOk) reasons.push(`${cli} CLI not found`);
    if (!envOk) reasons.push(`none of ${envVars.join(', ')} set`);
    return reasons.join(', ');
  }
  return null;
}

/**
 * Asserts the response to "What is 2+2?" actually contains "4".
 */
export function assertMathResponse(content: string): void {
  const normalized = content.toLowerCase();
  if (!normalized.includes('4')) {
    throw new Error(`Expected math response to contain "4", got: ${content.slice(0, 200)}`);
  }
}

/**
 * Asserts content is non-empty, not an error message, and reasonable length.
 */
export function assertContentQuality(content: string): void {
  if (!content || content.trim().length === 0) {
    throw new Error('Content is empty');
  }
  const lower = content.toLowerCase();
  const errorPatterns = ['error:', 'exception:', 'traceback', 'fatal:'];
  for (const pattern of errorPatterns) {
    if (lower.startsWith(pattern)) {
      throw new Error(`Content appears to be an error message: ${content.slice(0, 200)}`);
    }
  }
}
