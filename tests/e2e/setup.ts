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
