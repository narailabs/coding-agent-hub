import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSessionStore, type SerializedSession } from '../src/session-store.js';

function makeSession(id: string, overrides: Partial<SerializedSession> = {}): SerializedSession {
  return {
    id,
    backend: 'test',
    model: 'test-1',
    turns: [],
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    ...overrides,
  };
}

describe('FileSessionStore', () => {
  let dir: string;
  let store: FileSessionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hub-sessions-'));
    store = new FileSessionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves and loads a session', () => {
    const session = makeSession('abc-123');
    store.save('abc-123', session);

    const loaded = store.load('abc-123');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('abc-123');
    expect(loaded!.backend).toBe('test');
  });

  it('returns null for nonexistent session', () => {
    expect(store.load('nonexistent')).toBeNull();
  });

  it('deletes a session', () => {
    store.save('to-delete', makeSession('to-delete'));
    expect(store.load('to-delete')).not.toBeNull();

    store.delete('to-delete');
    expect(store.load('to-delete')).toBeNull();
  });

  it('delete is idempotent for nonexistent sessions', () => {
    // Should not throw
    store.delete('nonexistent');
  });

  it('lists all saved session IDs', () => {
    store.save('s1', makeSession('s1'));
    store.save('s2', makeSession('s2'));
    store.save('s3', makeSession('s3'));

    const ids = store.listIds().sort();
    expect(ids).toEqual(['s1', 's2', 's3']);
  });

  it('returns empty list when no sessions', () => {
    expect(store.listIds()).toEqual([]);
  });

  it('preserves turns in serialization', () => {
    const session = makeSession('with-turns', {
      turns: [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        { role: 'assistant', content: 'Hi', timestamp: 2000 },
      ],
    });
    store.save('with-turns', session);

    const loaded = store.load('with-turns')!;
    expect(loaded.turns).toHaveLength(2);
    expect(loaded.turns[0].role).toBe('user');
    expect(loaded.turns[1].content).toBe('Hi');
  });

  it('sanitizes IDs to prevent path traversal', () => {
    const session = makeSession('../../../etc/passwd');
    store.save('../../../etc/passwd', session);

    // Should be saved under a safe filename, not escape the directory
    const ids = store.listIds();
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toContain('/');
  });
});
