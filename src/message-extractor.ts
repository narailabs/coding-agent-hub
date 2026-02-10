/**
 * Coding Agent Hub — Message Extractor
 *
 * Extracts message content from agent CLI stdout.
 * Handles JSON formats (Gemini, Claude) and plain text fallback.
 */

/** Maximum stdout buffer size (5MB) */
const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

/**
 * Extracted message result.
 */
export interface ExtractedMessage {
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Extract message content from stdout.
 *
 * Priority:
 * 1. JSON with "response" field (Gemini format)
 * 2. JSON with "content" field
 * 3. JSON with "result" field (Claude --print --output-format json)
 * 4. Plain text (entire output)
 */
export function extractMessageContent(
  stdout: string,
  exitCode: number | null = null,
): ExtractedMessage | null {
  const trimmed = stdout.trim();

  if (!trimmed || trimmed.length < 10) {
    return null;
  }

  // Try to extract from JSON formats
  try {
    const jsonMatch = trimmed.match(
      /\{[\s\S]*?"(?:response|content|result)"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|$)/,
    );
    if (jsonMatch) {
      const startIdx = trimmed.indexOf('{');
      const endIdx = trimmed.lastIndexOf('}');
      if (startIdx !== -1 && endIdx > startIdx) {
        const jsonStr = trimmed.slice(startIdx, endIdx + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.response || parsed.content || parsed.result;
          if (content && typeof content === 'string' && content.length >= 10) {
            return {
              content,
              metadata: {
                extractedFromStdout: true,
                jsonFormat: parsed.response
                  ? 'gemini'
                  : parsed.result
                    ? 'claude'
                    : 'generic',
                exitCode,
              },
            };
          }
        } catch {
          // JSON parse failed, continue to fallback
        }
      }
    }
  } catch {
    // Regex or parsing failed, fall through to plain text
  }

  // Plain text fallback
  const cleaned = trimmed
    .replace(/^\s*\{[\s\S]*"session_id"[\s\S]*\}\s*$/g, '')
    .trim();

  if (cleaned && cleaned.length >= 10) {
    return {
      content: cleaned,
      metadata: {
        extractedFromStdout: true,
        jsonFormat: 'plaintext',
        exitCode,
      },
    };
  }

  return null;
}

/**
 * Collect stdout chunks with size limit.
 */
export class StdoutCollector {
  private chunks: Buffer[] = [];
  private totalSize = 0;
  private truncated = false;

  add(chunk: Buffer): void {
    if (this.truncated) return;

    if (this.totalSize + chunk.length > MAX_BUFFER_SIZE) {
      const remaining = MAX_BUFFER_SIZE - this.totalSize;
      if (remaining > 0) {
        this.chunks.push(chunk.slice(0, remaining));
        this.totalSize = MAX_BUFFER_SIZE;
      }
      this.truncated = true;
      console.warn('[coding-agent-hub] stdout truncated at 5MB limit');
    } else {
      this.chunks.push(chunk);
      this.totalSize += chunk.length;
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf-8');
  }

  wasTruncated(): boolean {
    return this.truncated;
  }

  size(): number {
    return this.totalSize;
  }
}
