/**
 * Coding Agent Hub — Session Manager
 *
 * Provides persistent multi-turn conversation sessions via context accumulation.
 * Each session tracks conversation history and prepends it to CLI invocations.
 */

import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/**
 * Configuration for the session manager.
 */
export interface SessionConfig {
  /** Idle timeout before auto-cleanup (ms). Default: 30 min */
  idleTimeoutMs?: number;
  /** Max conversation turns to keep. Default: 50 */
  maxContextTurns?: number;
  /** Max total chars in history. Default: 100,000 */
  maxContextChars?: number;
}

/**
 * A single turn in a conversation.
 */
export interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Whether this turn is staged (pending CLI response). */
  pending?: boolean;
}

/**
 * Result from staging a user turn for transactional commit/rollback.
 */
export interface StagedTurn {
  prompt: string;
  turnIndex: number;
}

/**
 * Public session metadata (no internal state exposed).
 */
export interface SessionInfo {
  sessionId: string;
  backend: string;
  model: string;
  workingDir?: string;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
}

interface Session {
  id: string;
  backend: string;
  model: string;
  workingDir?: string;
  turns: SessionTurn[];
  createdAt: number;
  lastActiveAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_CONTEXT_TURNS = 50;
const DEFAULT_MAX_CONTEXT_CHARS = 100_000;

/**
 * Manages persistent conversation sessions for the hub.
 *
 * Sessions accumulate conversation history and prepend it to each
 * new CLI invocation as a context block in the prompt.
 */
export class HubSessionManager {
  private sessions = new Map<string, Session>();
  private config: Required<SessionConfig>;

  constructor(config?: SessionConfig) {
    this.config = {
      idleTimeoutMs: config?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      maxContextTurns: config?.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS,
      maxContextChars: config?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
    };
  }

  /**
   * Create a new session and return its ID.
   */
  startSession(backend: string, opts?: { model?: string; workingDir?: string; sessionId?: string }): string {
    const id = opts?.sessionId ?? randomUUID();

    if (this.sessions.has(id)) {
      throw new Error(`Session ID already exists: ${id}`);
    }
    const now = Date.now();

    const session: Session = {
      id,
      backend,
      model: opts?.model ?? '',
      workingDir: opts?.workingDir,
      turns: [],
      createdAt: now,
      lastActiveAt: now,
      idleTimer: null,
    };

    this.sessions.set(id, session);
    this.resetIdleTimer(session);

    logger.info('Session created', { sessionId: id, backend });

    return id;
  }

  /**
   * Add a user turn and build an augmented prompt with conversation history.
   * Returns the prompt to pass to the CLI.
   */
  buildPrompt(sessionId: string, userMessage: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Record the user turn
    session.turns.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    session.lastActiveAt = Date.now();
    this.resetIdleTimer(session);
    this.trimHistory(session);

    // If this is the first turn, no history to prepend
    if (session.turns.length <= 1) {
      return userMessage;
    }

    // Build context from all turns except the last user message
    const historyTurns = session.turns.slice(0, -1);
    const contextBlock = this.buildContextBlock(historyTurns);

    return `${contextBlock}\n\nBased on the conversation above, respond to the latest message.\nThe new message is: ${userMessage}`;
  }

  /**
   * Stage a user turn and build an augmented prompt. The turn is marked
   * pending and will only be committed on success (commitTurn) or
   * rolled back on failure (rollbackTurn).
   */
  stageUserTurn(sessionId: string, userMessage: string): StagedTurn {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const turn: SessionTurn = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      pending: true,
    };
    session.turns.push(turn);
    const turnIndex = session.turns.length - 1;

    session.lastActiveAt = Date.now();
    this.resetIdleTimer(session);
    this.trimHistory(session);

    // Build prompt
    let prompt: string;
    const committedTurns = session.turns.filter((t) => !t.pending);
    if (committedTurns.length === 0) {
      prompt = userMessage;
    } else {
      const contextBlock = this.buildContextBlock(committedTurns);
      prompt = `${contextBlock}\n\nBased on the conversation above, respond to the latest message.\nThe new message is: ${userMessage}`;
    }

    logger.debug('User turn staged', { sessionId, turnIndex });
    return { prompt, turnIndex };
  }

  /**
   * Commit a staged turn and record the assistant response.
   */
  commitTurn(sessionId: string, turnIndex: number, assistantContent: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const turn = session.turns[turnIndex];
    if (!turn || !turn.pending) {
      throw new Error(`No pending turn at index ${turnIndex}`);
    }

    // Commit the user turn
    turn.pending = false;

    // Add assistant turn
    session.turns.push({
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
    });

    session.lastActiveAt = Date.now();
    this.resetIdleTimer(session);

    logger.debug('Turn committed', { sessionId, turnIndex, turnCount: session.turns.length });
  }

  /**
   * Roll back a staged turn (remove it from history).
   */
  rollbackTurn(sessionId: string, turnIndex: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const turn = session.turns[turnIndex];
    if (!turn || !turn.pending) {
      throw new Error(`No pending turn at index ${turnIndex}`);
    }

    session.turns.splice(turnIndex, 1);
    logger.debug('Turn rolled back', { sessionId, turnIndex });
  }

  /**
   * Record the assistant's response after CLI invocation.
   * @deprecated Use stageUserTurn/commitTurn/rollbackTurn instead.
   */
  recordResponse(sessionId: string, assistantContent: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.turns.push({
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
    });

    session.lastActiveAt = Date.now();
    this.resetIdleTimer(session);

    logger.debug('Response recorded', { sessionId, turnCount: session.turns.length });
  }

  /**
   * End a session and clean up its idle timer.
   */
  stopSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    this.sessions.delete(sessionId);

    logger.info('Session stopped', { sessionId });
    return true;
  }

  /**
   * List all active sessions (public metadata only).
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => this.toSessionInfo(s));
  }

  /**
   * Get session details by ID.
   */
  getSession(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    return session ? this.toSessionInfo(session) : null;
  }

  /**
   * Shut down — clear all sessions and timers.
   */
  destroy(): void {
    for (const session of this.sessions.values()) {
      if (session.idleTimer) {
        clearTimeout(session.idleTimer);
      }
    }
    this.sessions.clear();
  }

  private toSessionInfo(session: Session): SessionInfo {
    return {
      sessionId: session.id,
      backend: session.backend,
      model: session.model,
      workingDir: session.workingDir,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      turnCount: session.turns.filter((t) => !t.pending).length,
    };
  }

  private resetIdleTimer(session: Session): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      logger.info('Session expired (idle)', { sessionId: session.id });
      this.sessions.delete(session.id);
    }, this.config.idleTimeoutMs);
  }

  private trimHistory(session: Session): void {
    const beforeCount = session.turns.length;
    const committed = session.turns.filter((t) => !t.pending);
    const maxTurns = this.config.maxContextTurns;

    if (committed.length <= maxTurns) {
      // Still might need to trim by chars
      this.trimByChars(session);
      return;
    }

    // Semantic trimming: keep first turn + last N turns, remove from middle
    const keepTail = Math.min(10, maxTurns - 1); // reserve 1 slot for first turn
    const firstCommittedIdx = session.turns.findIndex((t) => !t.pending);

    if (firstCommittedIdx === -1) return;

    // Find the boundary: we keep the first committed turn and the last keepTail committed turns
    const committedIndices = session.turns
      .map((t, i) => (!t.pending ? i : -1))
      .filter((i) => i !== -1);

    if (committedIndices.length <= keepTail + 1) {
      this.trimByChars(session);
      return;
    }

    // Remove from middle: indices between first committed and the last keepTail committed
    const removeEnd = committedIndices.length - keepTail;
    const toRemove = committedIndices.slice(1, removeEnd);

    // Remove in reverse order to preserve indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      session.turns.splice(toRemove[i], 1);
    }

    // Insert a marker turn after the first committed turn
    if (toRemove.length > 0) {
      const markerIdx = session.turns.findIndex((t) => !t.pending) + 1;
      session.turns.splice(markerIdx, 0, {
        role: 'assistant',
        content: `[... ${toRemove.length} earlier turns omitted ...]`,
        timestamp: Date.now(),
      });
    }

    this.trimByChars(session);

    const trimmed = beforeCount - session.turns.length;
    if (trimmed > 0) {
      logger.debug('Session history trimmed', { sessionId: session.id, trimmed, remaining: session.turns.length });
    }
  }

  private trimByChars(session: Session): void {
    let totalChars = session.turns.reduce((sum, t) => sum + t.content.length, 0);
    const committedCount = () => session.turns.filter((t) => !t.pending).length;

    // Keep at least the first and last committed turns
    while (totalChars > this.config.maxContextChars && committedCount() > 2) {
      // Find the second committed turn (skip the first one to preserve initial context)
      const committedIndices = session.turns
        .map((t, i) => (!t.pending ? i : -1))
        .filter((i) => i !== -1);

      if (committedIndices.length <= 2) break;

      // Remove the second committed turn (preserve first)
      const removeIdx = committedIndices[1];
      totalChars -= session.turns[removeIdx].content.length;
      session.turns.splice(removeIdx, 1);
    }
  }

  private buildContextBlock(turns: SessionTurn[]): string {
    const lines = turns.map((t) => `[${t.role}]: ${t.content}`);
    return `<conversation_history>\n${lines.join('\n')}\n</conversation_history>`;
  }
}
