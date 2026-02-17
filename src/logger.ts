/**
 * Coding Agent Hub — Structured Logger
 *
 * Lightweight structured logger that emits JSON lines to stderr.
 * MCP uses stdout for protocol messages, so all logging goes to stderr.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private levelNum: number;

  constructor(private level: LogLevel = 'info') {
    this.levelNum = LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log('debug', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log('info', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log('warn', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log('error', msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.levelNum) return;

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg,
    };
    if (data) {
      Object.assign(entry, data);
    }
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
}

function resolveLogLevel(): LogLevel {
  const env = process.env.HUB_LOG_LEVEL;
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  return 'info';
}

export const logger = new Logger(resolveLogLevel());
