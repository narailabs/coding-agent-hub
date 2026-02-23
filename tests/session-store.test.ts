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

    it('persists plugin and continuity metadata', () => {
      store.save('meta', makeSession('meta', {
        pluginId: 'claude',
        continuityMode: 'native',
        nativeSessionRef: 'native-session-1',
        capabilitySnapshot: {
          pluginId: 'claude',
          detectedAt: 1,
          cached: true,
          supportsNativeSession: true,
          supportsNativeStart: true,
          supportsNativeContinue: true,
        },
      }));

      const loaded = store.load('meta')!;
      expect(loaded.pluginId).toBe('claude');
      expect(loaded.continuityMode).toBe('native');
      expect(loaded.nativeSessionRef).toBe('native-session-1');
      expect(loaded.capabilitySnapshot?.pluginId).toBe('claude');
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

  it('save() logs error when writeFileSync throws', () => {
    // Create a valid store, then make its directory unwritable
    const saveDir = mkdtempSync(join(tmpdir(), 'hub-sessions-save-err-'));
    const saveStore = new FileSessionStore(saveDir);
    // Remove the directory so writes fail
    rmSync(saveDir, { recursive: true, force: true });

    // save should not throw — it catches and logs
    expect(() => saveStore.save('test', makeSession('test'))).not.toThrow();
  });

  it('listIds() returns empty array when readdirSync throws', () => {
    // Create a valid store, then remove the directory so readdir fails
    const listDir = mkdtempSync(join(tmpdir(), 'hub-sessions-list-err-'));
    const listStore = new FileSessionStore(listDir);
    rmSync(listDir, { recursive: true, force: true });

    const ids = listStore.listIds();
    expect(ids).toEqual([]);
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
