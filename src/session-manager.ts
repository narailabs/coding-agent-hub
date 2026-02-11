/**
 * Coding Agent Hub — Session Manager
 *
 * Provides persistent multi-turn conversation sessions via context accumulation.
 * Each session tracks conversation history and prepends it to CLI invocations.
 */

import { randomUUID } from 'node:crypto';

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
  startSession(backend: string, opts?: { model?: string; workingDir?: string }): string {
    const id = randomUUID();
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
   * Record the assistant's response after CLI invocation.
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
      turnCount: session.turns.length,
    };
  }

  private resetIdleTimer(session: Session): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      this.sessions.delete(session.id);
    }, this.config.idleTimeoutMs);
  }

  private trimHistory(session: Session): void {
    // Trim by turn count
    while (session.turns.length > this.config.maxContextTurns) {
      session.turns.shift();
    }

    // Trim by total character count
    let totalChars = session.turns.reduce((sum, t) => sum + t.content.length, 0);
    while (totalChars > this.config.maxContextChars && session.turns.length > 1) {
      const removed = session.turns.shift();
      if (removed) {
        totalChars -= removed.content.length;
      }
    }
  }

  private buildContextBlock(turns: SessionTurn[]): string {
    const lines = turns.map((t) => `[${t.role}]: ${t.content}`);
    return `<conversation_history>\n${lines.join('\n')}\n</conversation_history>`;
  }
}
