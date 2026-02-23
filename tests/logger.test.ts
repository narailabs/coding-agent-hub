import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../src/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe('constructor with invalid level', () => {
    it('falls back to info level for an invalid log level', () => {
      const logger = new Logger('bogus' as any);

      // debug should be suppressed at info level
      logger.debug('should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();

      // info should be emitted
      logger.info('should appear');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('level filtering', () => {
    it('suppresses debug messages at info level', () => {
      const logger = new Logger('info');
      logger.debug('hidden');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('emits info messages at info level', () => {
      const logger = new Logger('info');
      logger.info('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('emits warn messages at info level', () => {
      const logger = new Logger('info');
      logger.warn('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('emits error messages at info level', () => {
      const logger = new Logger('info');
      logger.error('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('emits debug messages at debug level', () => {
      const logger = new Logger('debug');
      logger.debug('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses info and debug at warn level', () => {
      const logger = new Logger('warn');
      logger.debug('hidden');
      logger.info('hidden');
      expect(stderrSpy).not.toHaveBeenCalled();

      logger.warn('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('only emits error at error level', () => {
      const logger = new Logger('error');
      logger.debug('hidden');
      logger.info('hidden');
      logger.warn('hidden');
      expect(stderrSpy).not.toHaveBeenCalled();

      logger.error('visible');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('log output format', () => {
    it('outputs valid JSON with ts, level, and msg fields', () => {
      const logger = new Logger('info');
      logger.info('test message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output.endsWith('\n')).toBe(true);

      const parsed = JSON.parse(output.trim());
      expect(parsed.ts).toBeDefined();
      expect(parsed.level).toBe('info');
      expect(parsed.msg).toBe('test message');
    });

    it('includes ISO 8601 timestamp', () => {
      const logger = new Logger('info');
      logger.info('ts check');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      // ISO 8601 format check
      expect(() => new Date(parsed.ts)).not.toThrow();
      expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
    });
  });

  describe('data merging', () => {
    it('merges additional data fields into log entry', () => {
      const logger = new Logger('info');
      logger.info('with data', { sessionId: 'abc', count: 42 });

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.msg).toBe('with data');
      expect(parsed.sessionId).toBe('abc');
      expect(parsed.count).toBe(42);
    });

    it('does not include data fields when data is undefined', () => {
      const logger = new Logger('info');
      logger.info('no data');

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(Object.keys(parsed)).toEqual(['ts', 'level', 'msg']);
    });

    it('handles empty data object', () => {
      const logger = new Logger('info');
      logger.info('empty data', {});

      const output = stderrSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output.trim());
      expect(parsed.msg).toBe('empty data');
      // Should still parse fine; no extra keys added
      expect(Object.keys(parsed)).toEqual(['ts', 'level', 'msg']);
    });
  });
});
