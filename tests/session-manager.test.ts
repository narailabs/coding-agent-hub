import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HubSessionManager } from '../src/session-manager.js';
import { FileSessionStore } from '../src/session-store.js';

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
    it('trims by maxContextTurns preserving first turn', () => {
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

      // Semantic trimming keeps first turn + last N
      expect(prompt).toContain('Question 0'); // first turn preserved
      expect(prompt).toContain('earlier turns omitted'); // marker present
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

    it('inserts omission marker when middle turns are removed', () => {
      const mgr = new HubSessionManager({
        maxContextTurns: 4,
        maxContextChars: 1_000_000,
        idleTimeoutMs: 60_000,
      });

      const id = mgr.startSession('claude');

      for (let i = 0; i < 5; i++) {
        mgr.buildPrompt(id, `Q${i}`);
        mgr.recordResponse(id, `A${i}`);
      }

      const prompt = mgr.buildPrompt(id, 'Latest');
      expect(prompt).toContain('earlier turns omitted');
      expect(prompt).toContain('Q0'); // first turn preserved
      expect(prompt).toContain('Latest');

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

  describe('transactional turns', () => {
    it('stageUserTurn returns prompt and turnIndex', () => {
      const id = manager.startSession('claude');
      const staged = manager.stageUserTurn(id, 'Hello');

      expect(staged.prompt).toBe('Hello');
      expect(staged.turnIndex).toBe(0);
    });

    it('staged turn is not counted in turnCount', () => {
      const id = manager.startSession('claude');
      manager.stageUserTurn(id, 'Hello');

      const info = manager.getSession(id)!;
      expect(info.turnCount).toBe(0); // pending turns excluded
    });

    it('commitTurn adds both user and assistant turns', () => {
      const id = manager.startSession('claude');
      const staged = manager.stageUserTurn(id, 'Hello');
      manager.commitTurn(id, staged.turnIndex, 'Hi there');

      const info = manager.getSession(id)!;
      expect(info.turnCount).toBe(2); // user + assistant
    });

    it('rollbackTurn removes the staged turn', () => {
      const id = manager.startSession('claude');
      const staged = manager.stageUserTurn(id, 'Hello');
      manager.rollbackTurn(id, staged.turnIndex);

      const info = manager.getSession(id)!;
      expect(info.turnCount).toBe(0);
    });

    it('rolled back turn does not appear in subsequent prompts', () => {
      const id = manager.startSession('claude');

      // First successful round
      const staged1 = manager.stageUserTurn(id, 'Q1');
      manager.commitTurn(id, staged1.turnIndex, 'A1');

      // Failed round — should be rolled back
      const staged2 = manager.stageUserTurn(id, 'Q2-failed');
      manager.rollbackTurn(id, staged2.turnIndex);

      // Next round — history should not include Q2-failed
      const staged3 = manager.stageUserTurn(id, 'Q3');
      expect(staged3.prompt).toContain('[user]: Q1');
      expect(staged3.prompt).toContain('[assistant]: A1');
      expect(staged3.prompt).not.toContain('Q2-failed');
      expect(staged3.prompt).toContain('Q3');
    });

    it('commitTurn throws for non-pending turn', () => {
      const id = manager.startSession('claude');
      const staged = manager.stageUserTurn(id, 'Hello');
      manager.commitTurn(id, staged.turnIndex, 'Response');

      expect(() => manager.commitTurn(id, staged.turnIndex, 'Again')).toThrow('No pending turn');
    });

    it('rollbackTurn throws for non-pending turn', () => {
      const id = manager.startSession('claude');
      const staged = manager.stageUserTurn(id, 'Hello');
      manager.commitTurn(id, staged.turnIndex, 'Response');

      expect(() => manager.rollbackTurn(id, staged.turnIndex)).toThrow('No pending turn');
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

  describe('with session store', () => {
    let storeDir: string;
    let store: FileSessionStore;

    beforeEach(() => {
      storeDir = mkdtempSync(join(tmpdir(), 'hub-session-mgr-'));
      store = new FileSessionStore(storeDir);
    });

    afterEach(() => {
      rmSync(storeDir, { recursive: true, force: true });
    });

    it('persists sessions to store on create and commit', () => {
      const mgr = new HubSessionManager({ idleTimeoutMs: 60_000 }, store);
      const id = mgr.startSession('claude');

      // Session should be saved
      expect(store.load(id)).not.toBeNull();

      const staged = mgr.stageUserTurn(id, 'Hello');
      mgr.commitTurn(id, staged.turnIndex, 'Hi');

      // Updated session should be saved
      const loaded = store.load(id)!;
      expect(loaded.turns).toHaveLength(2);

      mgr.destroy();
    });

    it('deletes session from store on stop', () => {
      const mgr = new HubSessionManager({ idleTimeoutMs: 60_000 }, store);
      const id = mgr.startSession('claude');
      expect(store.load(id)).not.toBeNull();

      mgr.stopSession(id);
      expect(store.load(id)).toBeNull();

      mgr.destroy();
    });

    it('loads persisted sessions on construction', () => {
      // Create and populate a session with the first manager
      const mgr1 = new HubSessionManager({ idleTimeoutMs: 60_000 }, store);
      const id = mgr1.startSession('claude', { model: 'claude-opus-4-5' });
      const staged = mgr1.stageUserTurn(id, 'Hello');
      mgr1.commitTurn(id, staged.turnIndex, 'Hi');
      mgr1.destroy();

      // Create a new manager with the same store — should load the session
      const mgr2 = new HubSessionManager({ idleTimeoutMs: 60_000 }, store);
      const info = mgr2.getSession(id);
      expect(info).not.toBeNull();
      expect(info!.backend).toBe('claude');
      expect(info!.model).toBe('claude-opus-4-5');
      expect(info!.turnCount).toBe(2);

      mgr2.destroy();
    });

    it('does not load expired sessions', () => {
      // Create a session with the first manager
      const mgr1 = new HubSessionManager({ idleTimeoutMs: 1000 }, store);
      const id = mgr1.startSession('claude');
      mgr1.destroy();

      // Manually set lastActiveAt to the past
      const data = store.load(id)!;
      data.lastActiveAt = Date.now() - 5000; // 5 seconds ago, timeout is 1s
      store.save(id, data);

      // New manager should not load the expired session
      const mgr2 = new HubSessionManager({ idleTimeoutMs: 1000 }, store);
      expect(mgr2.getSession(id)).toBeNull();
      // And the expired session file should be cleaned up
      expect(store.load(id)).toBeNull();

      mgr2.destroy();
    });
  });
});
