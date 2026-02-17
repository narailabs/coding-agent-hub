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

export function skipUnless(cli: string, envVar: string): string | null {
  const cliOk = checkCliAvailable(cli);
  const envOk = checkEnvVar(envVar);
  if (!cliOk || !envOk) {
    const reasons: string[] = [];
    if (!cliOk) reasons.push(`${cli} CLI not found`);
    if (!envOk) reasons.push(`${envVar} not set`);
    return reasons.join(', ');
  }
  return null;
}
