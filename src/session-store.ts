/**
 * Coding Agent Hub — Session Store
 *
 * Opt-in file-backed persistence for conversation sessions.
 * Sessions are saved as JSON files under a configurable directory.
 */

import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';
import type { SessionTurn } from './session-manager.js';
import type { ContinuityMode } from './plugins/types.js';
import type { PluginCapabilitySnapshot } from './plugins/types.js';

/**
 * Serialized session data for persistence.
 */
export interface SerializedSession {
  id: string;
  backend: string;
  model: string;
  workingDir?: string;
  turns: SessionTurn[];
  createdAt: number;
  lastActiveAt: number;
  pluginId?: string;
  continuityMode?: ContinuityMode;
  nativeSessionRef?: string | null;
  capabilitySnapshot?: PluginCapabilitySnapshot;
}

/**
 * Interface for session storage backends.
 */
export interface SessionStore {
  save(id: string, data: SerializedSession): void;
  load(id: string): SerializedSession | null;
  delete(id: string): void;
  listIds(): string[];
}

/**
 * File-backed session store.
 * Each session is saved as ~/.coding-agent-hub/sessions/<id>.json.
 */
export class FileSessionStore implements SessionStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(id: string, data: SerializedSession): void {
    const path = this.filePath(id);
    try {
      writeFileSync(path, JSON.stringify(data), 'utf-8');
    } catch (err) {
      logger.error('Failed to save session', { sessionId: id, error: String(err) });
    }
  }

  load(id: string): SerializedSession | null {
    const path = this.filePath(id);
    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as SerializedSession;
    } catch {
      return null;
    }
  }

  delete(id: string): void {
    const path = this.filePath(id);
    try {
      unlinkSync(path);
    } catch {
      // File may not exist — that's fine
    }
  }

  listIds(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  private filePath(id: string): string {
    // Sanitize ID to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }
}
