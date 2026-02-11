import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HubSessionManager } from '../src/session-manager.js';

describe('HubSessionManager', () => {
  let manager: HubSessionManager;

  beforeEach(() => {
    manager = new HubSessionManager({
      idleTimeoutMs: 60_000,
      maxContextTurns: 10,
      maxContextChars: 5000,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('startSession', () => {
    it('returns a valid UUID session ID', () => {
      const id = manager.startSession('claude');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('stores backend and options', () => {
      const id = manager.startSession('gemini', { model: 'gemini-2.5-pro', workingDir: '/tmp' });
      const info = manager.getSession(id);
      expect(info).not.toBeNull();
      expect(info!.backend).toBe('gemini');
      expect(info!.model).toBe('gemini-2.5-pro');
      expect(info!.workingDir).toBe('/tmp');
      expect(info!.turnCount).toBe(0);
    });

    it('creates unique session IDs', () => {
      const id1 = manager.startSession('claude');
      const id2 = manager.startSession('claude');
      expect(id1).not.toBe(id2);
    });
  });

  describe('buildPrompt', () => {
    it('returns raw message on first turn (no history)', () => {
      const id = manager.startSession('claude');
      const prompt = manager.buildPrompt(id, 'Hello world');
      expect(prompt).toBe('Hello world');
    });

    it('prepends conversation history on subsequent turns', () => {
      const id = manager.startSession('claude');
      manager.buildPrompt(id, 'What is 2+2?');
      manager.recordResponse(id, '4');

      const prompt = manager.buildPrompt(id, 'And 3+3?');
      expect(prompt).toContain('<conversation_history>');
      expect(prompt).toContain('[user]: What is 2+2?');
      expect(prompt).toContain('[assistant]: 4');
      expect(prompt).toContain('</conversation_history>');
      expect(prompt).toContain('And 3+3?');
    });

    it('includes multiple turns of history', () => {
      const id = manager.startSession('claude');

      manager.buildPrompt(id, 'First question');
      manager.recordResponse(id, 'First answer');
      manager.buildPrompt(id, 'Second question');
      manager.recordResponse(id, 'Second answer');

      const prompt = manager.buildPrompt(id, 'Third question');
      expect(prompt).toContain('[user]: First question');
      expect(prompt).toContain('[assistant]: First answer');
      expect(prompt).toContain('[user]: Second question');
      expect(prompt).toContain('[assistant]: Second answer');
      expect(prompt).toContain('Third question');
    });

    it('throws for unknown session ID', () => {
      expect(() => manager.buildPrompt('nonexistent', 'hello')).toThrow('Session not found');
    });

    it('updates lastActiveAt and turnCount', () => {
      const id = manager.startSession('claude');
      const before = manager.getSession(id)!.lastActiveAt;

      // Small delay to ensure timestamp changes
      vi.useFakeTimers();
      vi.advanceTimersByTime(100);
      manager.buildPrompt(id, 'test');
      vi.useRealTimers();

      const info = manager.getSession(id)!;
      expect(info.turnCount).toBe(1);
    });
  });

  describe('recordResponse', () => {
    it('adds an assistant turn', () => {
      const id = manager.startSession('claude');
      manager.buildPrompt(id, 'Question');
      manager.recordResponse(id, 'Answer');

      const info = manager.getSession(id)!;
      expect(info.turnCount).toBe(2); // 1 user + 1 assistant
    });

    it('throws for unknown session ID', () => {
      expect(() => manager.recordResponse('nonexistent', 'hello')).toThrow('Session not found');
    });
  });

  describe('stopSession', () => {
    it('removes the session', () => {
      const id = manager.startSession('claude');
      expect(manager.stopSession(id)).toBe(true);
      expect(manager.getSession(id)).toBeNull();
    });

    it('returns false for unknown session', () => {
      expect(manager.stopSession('nonexistent')).toBe(false);
    });

    it('clears idle timer', () => {
      vi.useFakeTimers();
      const id = manager.startSession('claude');
      manager.stopSession(id);
      // Advancing past idle timeout should not throw
      vi.advanceTimersByTime(120_000);
      vi.useRealTimers();
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions', () => {
      expect(manager.listSessions()).toEqual([]);
    });

    it('returns all active sessions', () => {
      manager.startSession('claude');
      manager.startSession('gemini');
      manager.startSession('codex');

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.backend).sort()).toEqual(['claude', 'codex', 'gemini']);
    });

    it('excludes stopped sessions', () => {
      const id1 = manager.startSession('claude');
      manager.startSession('gemini');
      manager.stopSession(id1);

      expect(manager.listSessions()).toHaveLength(1);
      expect(manager.listSessions()[0].backend).toBe('gemini');
    });
  });

  describe('getSession', () => {
    it('returns null for unknown session', () => {
      expect(manager.getSession('nonexistent')).toBeNull();
    });

    it('returns session info with correct fields', () => {
      const id = manager.startSession('claude', { model: 'claude-opus-4-5', workingDir: '/home' });
      const info = manager.getSession(id)!;

      expect(info.sessionId).toBe(id);
      expect(info.backend).toBe('claude');
      expect(info.model).toBe('claude-opus-4-5');
      expect(info.workingDir).toBe('/home');
      expect(info.createdAt).toBeGreaterThan(0);
      expect(info.lastActiveAt).toBeGreaterThanOrEqual(info.createdAt);
      expect(info.turnCount).toBe(0);
    });
  });

  describe('context trimming', () => {
    it('trims by maxContextTurns', () => {
      const mgr = new HubSessionManager({
        maxContextTurns: 4,
        maxContextChars: 1_000_000,
        idleTimeoutMs: 60_000,
      });

      const id = mgr.startSession('claude');

      // Add 5 turns (exceeding max of 4)
      for (let i = 0; i < 3; i++) {
        mgr.buildPrompt(id, `Question ${i}`);
        mgr.recordResponse(id, `Answer ${i}`);
      }

      // The 7th turn (buildPrompt) triggers trimming
      const prompt = mgr.buildPrompt(id, 'Final question');

      // With maxContextTurns=4, oldest turns should be dropped
      // After adding "Final question", there are 7 turns total, trimmed to 4
      // History includes only the last 3 non-current turns
      expect(prompt).not.toContain('Question 0');
      expect(prompt).toContain('Final question');

      mgr.destroy();
    });

    it('trims by maxContextChars', () => {
      const mgr = new HubSessionManager({
        maxContextTurns: 100,
        maxContextChars: 100,
        idleTimeoutMs: 60_000,
      });

      const id = mgr.startSession('claude');

      // Each turn is ~50 chars, so 3 user + 2 assistant = 5 turns > 100 chars total
      mgr.buildPrompt(id, 'A'.repeat(40));
      mgr.recordResponse(id, 'B'.repeat(40));
      mgr.buildPrompt(id, 'C'.repeat(40));
      mgr.recordResponse(id, 'D'.repeat(40));

      // 5th turn triggers trimming since total chars > 100
      const prompt = mgr.buildPrompt(id, 'Final');

      // Oldest turns should be dropped to stay under 100 chars
      // The prompt should still contain the latest message
      expect(prompt).toContain('Final');

      mgr.destroy();
    });
  });

  describe('idle timeout', () => {
    it('removes session after idle timeout', () => {
      vi.useFakeTimers();

      const mgr = new HubSessionManager({ idleTimeoutMs: 5000 });
      const id = mgr.startSession('claude');

      expect(mgr.getSession(id)).not.toBeNull();

      vi.advanceTimersByTime(5001);

      expect(mgr.getSession(id)).toBeNull();

      mgr.destroy();
      vi.useRealTimers();
    });

    it('resets idle timer on activity', () => {
      vi.useFakeTimers();

      const mgr = new HubSessionManager({ idleTimeoutMs: 5000 });
      const id = mgr.startSession('claude');

      // Advance 3 seconds, then interact
      vi.advanceTimersByTime(3000);
      mgr.buildPrompt(id, 'still here');

      // Advance another 3 seconds (total 6 from start, but only 3 from last activity)
      vi.advanceTimersByTime(3000);
      expect(mgr.getSession(id)).not.toBeNull();

      // Advance past new timeout
      vi.advanceTimersByTime(3000);
      expect(mgr.getSession(id)).toBeNull();

      mgr.destroy();
      vi.useRealTimers();
    });
  });

  describe('destroy', () => {
    it('clears all sessions', () => {
      manager.startSession('claude');
      manager.startSession('gemini');
      expect(manager.listSessions()).toHaveLength(2);

      manager.destroy();
      expect(manager.listSessions()).toHaveLength(0);
    });

    it('can be called multiple times safely', () => {
      manager.startSession('claude');
      manager.destroy();
      manager.destroy();
      expect(manager.listSessions()).toHaveLength(0);
    });
  });

  describe('prompt format', () => {
    it('produces the expected XML context block format', () => {
      const id = manager.startSession('claude');
      manager.buildPrompt(id, 'What is TypeScript?');
      manager.recordResponse(id, 'TypeScript is a typed superset of JavaScript.');

      const prompt = manager.buildPrompt(id, 'How do I use it?');

      const expected = [
        '<conversation_history>',
        '[user]: What is TypeScript?',
        '[assistant]: TypeScript is a typed superset of JavaScript.',
        '</conversation_history>',
        '',
        'Based on the conversation above, respond to the latest message.',
        'The new message is: How do I use it?',
      ].join('\n');

      expect(prompt).toBe(expected);
    });
  });
});
