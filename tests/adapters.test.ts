import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../src/adapters/claude-adapter.js';
import { GeminiAdapter } from '../src/adapters/gemini-adapter.js';
import { CodexAdapter } from '../src/adapters/codex-adapter.js';
import { OpenCodeAdapter } from '../src/adapters/opencode-adapter.js';
import { CopilotAdapter } from '../src/adapters/copilot-adapter.js';
import { CursorAdapter } from '../src/adapters/cursor-adapter.js';
import { GenericAdapter } from '../src/adapters/generic-adapter.js';
import { getAdapter } from '../src/adapters/index.js';
import type { BackendConfig, ToolInput } from '../src/types.js';

function makeConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  return {
    name: 'test',
    displayName: 'Test Backend',
    command: 'test-cli',
    enabled: true,
    defaultModel: 'test-model-1',
    timeoutMs: 30_000,
    argBuilder: 'generic',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolInput> = {}): ToolInput {
  return {
    prompt: 'Hello, world',
    ...overrides,
  };
}

// ─── Claude Adapter ──────────────────────────────────────────────

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  describe('extractResponse', () => {
    it('extracts plain text response', () => {
      const result = adapter.extractResponse('Hello from Claude', 0);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello from Claude');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('trims whitespace from response', () => {
      const result = adapter.extractResponse('  Hello  \n', 0);
      expect(result!.content).toBe('Hello');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   \n  ', 0)).toBeNull();
    });

    it('handles multiline text', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const result = adapter.extractResponse(text, 0);
      expect(result!.content).toBe(text);
    });

    it('works regardless of exit code', () => {
      const result = adapter.extractResponse('Some output', 1);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Some output');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('replaces prompt with stdin marker "-"', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'claude-sonnet-4-5');
      expect(args).toContain('-');
      expect(args).toContain('--print');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-5');
      expect(args).toContain('--output-format');
      expect(args).toContain('text');
      expect(args).not.toContain('Hello, world');
    });

    it('uses provided model', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'claude-opus-4-5');
      expect(args).toContain('claude-opus-4-5');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'Claude', command: 'claude' }));
      expect(desc).toContain('Claude');
      expect(desc).toContain('claude');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'claude-sonnet-4-5' }));
      expect(desc).toContain('claude-sonnet-4-5');
    });

    it('mentions Anthropic', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('Anthropic');
    });
  });

  it('has stdin prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('stdin');
  });
});

// ─── Gemini Adapter ──────────────────────────────────────────────

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  describe('extractResponse', () => {
    it('extracts JSON response field', () => {
      const json = JSON.stringify({ response: 'Hello from Gemini' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Hello from Gemini');
      expect(result!.metadata?.jsonFormat).toBe('gemini');
    });

    it('extracts JSON content field', () => {
      const json = JSON.stringify({ content: 'Content field' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Content field');
      expect(result!.metadata?.jsonFormat).toBe('gemini');
    });

    it('falls back to plain text for non-JSON', () => {
      const result = adapter.extractResponse('Plain text output', 0);
      expect(result!.content).toBe('Plain text output');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('falls back to plain text when JSON has no response/content field', () => {
      const json = JSON.stringify({ other: 'data' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe(json);
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('handles JSON embedded in other text', () => {
      const stdout = 'Some prefix {"response": "extracted"} some suffix';
      const result = adapter.extractResponse(stdout, 0);
      expect(result!.content).toBe('extracted');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   ', 0)).toBeNull();
    });

    it('includes exitCode in metadata', () => {
      const json = JSON.stringify({ response: 'data' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.metadata?.exitCode).toBe(0);
    });

    it('handles short replies without 10-char minimum', () => {
      const result = adapter.extractResponse('Ok', 0);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Ok');
    });

    it('falls back to plain text on malformed JSON', () => {
      const result = adapter.extractResponse('{ bad json }', 0);
      expect(result!.content).toBe('{ bad json }');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('handles non-string response field by falling back', () => {
      const json = JSON.stringify({ response: 42 });
      const result = adapter.extractResponse(json, 0);
      // Non-string content falls through to plaintext
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('omits -p and prompt', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'gemini-2.5-pro');
      expect(args).not.toContain('-p');
      expect(args).not.toContain('Hello, world');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--yolo');
      expect(args).toContain('-m');
      expect(args).toContain('gemini-2.5-pro');
    });

    it('includes --include-directories when workingDir set', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput({ workingDir: '/tmp/proj' }), 'gemini-2.5-pro');
      expect(args).toContain('--include-directories');
      expect(args).toContain('/tmp/proj');
    });

    it('omits --include-directories when no workingDir', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'gemini-2.5-pro');
      expect(args).not.toContain('--include-directories');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'Gemini', command: 'gemini' }));
      expect(desc).toContain('Gemini');
      expect(desc).toContain('gemini');
    });

    it('mentions Google', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('Google');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'gemini-2.5-pro' }));
      expect(desc).toContain('gemini-2.5-pro');
    });
  });

  it('has stdin prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('stdin');
  });
});

// ─── Codex Adapter ───────────────────────────────────────────────

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  describe('extractResponse', () => {
    it('extracts JSON content field', () => {
      const json = JSON.stringify({ content: 'Hello from Codex' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Hello from Codex');
      expect(result!.metadata?.jsonFormat).toBe('codex');
    });

    it('extracts JSON result field', () => {
      const json = JSON.stringify({ result: 'Result field' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Result field');
      expect(result!.metadata?.jsonFormat).toBe('codex');
    });

    it('prefers content over result', () => {
      const json = JSON.stringify({ content: 'from-content', result: 'from-result' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('from-content');
    });

    it('falls back to plain text for non-JSON', () => {
      const result = adapter.extractResponse('Plain text from codex', 0);
      expect(result!.content).toBe('Plain text from codex');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   \n\t  ', 0)).toBeNull();
    });

    it('includes exitCode in metadata', () => {
      const json = JSON.stringify({ content: 'data' });
      const result = adapter.extractResponse(json, 1);
      expect(result!.metadata?.exitCode).toBe(1);
    });

    it('handles JSON embedded in output', () => {
      const stdout = 'prefix {"result": "extracted value"} suffix';
      const result = adapter.extractResponse(stdout, 0);
      expect(result!.content).toBe('extracted value');
    });

    it('falls back on malformed JSON', () => {
      const result = adapter.extractResponse('{broken json{', 0);
      expect(result!.content).toBe('{broken json{');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('omits positional prompt and relies on stdin piping', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'gpt-5.3-codex-spark');
      expect(args[0]).toBe('exec');
      expect(args).not.toContain('--stdin');
      expect(args).toContain('--json');
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5.3-codex-spark');
      expect(args).toContain('--full-auto');
      expect(args).toContain('--skip-git-repo-check');
      expect(args).not.toContain('Hello, world');
    });

    it('includes --cd when workingDir set', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput({ workingDir: '/tmp/proj' }), 'gpt-5.3-codex-spark');
      expect(args).toContain('--cd');
      expect(args).toContain('/tmp/proj');
    });

    it('omits --cd when no workingDir', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'gpt-5.3-codex-spark');
      expect(args).not.toContain('--cd');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'Codex', command: 'codex' }));
      expect(desc).toContain('Codex');
      expect(desc).toContain('codex');
    });

    it('mentions OpenAI', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('OpenAI');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'gpt-5.3-codex-spark' }));
      expect(desc).toContain('gpt-5.3-codex-spark');
    });
  });

  it('has stdin prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('stdin');
  });
});

// ─── OpenCode Adapter ────────────────────────────────────────────

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  describe('extractResponse', () => {
    it('extracts JSON response field', () => {
      const json = JSON.stringify({ response: 'Hello from OpenCode' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Hello from OpenCode');
      expect(result!.metadata?.jsonFormat).toBe('opencode');
    });

    it('extracts JSON content field', () => {
      const json = JSON.stringify({ content: 'Content field' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Content field');
      expect(result!.metadata?.jsonFormat).toBe('opencode');
    });

    it('prefers response over content', () => {
      const json = JSON.stringify({ response: 'from-response', content: 'from-content' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('from-response');
    });

    it('falls back to plain text for non-JSON', () => {
      const result = adapter.extractResponse('Plain text output', 0);
      expect(result!.content).toBe('Plain text output');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   \n\t  ', 0)).toBeNull();
    });

    it('includes exitCode in metadata', () => {
      const json = JSON.stringify({ response: 'data' });
      const result = adapter.extractResponse(json, 1);
      expect(result!.metadata?.exitCode).toBe(1);
    });

    it('handles JSON embedded in output', () => {
      const stdout = 'prefix {"response": "extracted value"} suffix';
      const result = adapter.extractResponse(stdout, 0);
      expect(result!.content).toBe('extracted value');
    });

    it('falls back on malformed JSON', () => {
      const result = adapter.extractResponse('{broken json{', 0);
      expect(result!.content).toBe('{broken json{');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('handles non-string response field by falling back', () => {
      const json = JSON.stringify({ response: 42 });
      const result = adapter.extractResponse(json, 0);
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('falls back to plain text when JSON has no response/content field', () => {
      const json = JSON.stringify({ other: 'data' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe(json);
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });
  });

  describe('buildArgs', () => {
    it('builds correct args with prompt', () => {
      const args = adapter.buildArgs(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['-p', 'Hello, world', '-f', 'json', '-q']);
    });

    it('includes -q for quiet mode', () => {
      const args = adapter.buildArgs(makeInput(), 'any-model');
      expect(args).toContain('-q');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('omits -p and prompt from args', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['-f', 'json', '-q']);
      expect(args).not.toContain('-p');
      expect(args).not.toContain('Hello, world');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'OpenCode', command: 'opencode' }));
      expect(desc).toContain('OpenCode');
      expect(desc).toContain('opencode');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'claude-sonnet-4-5' }));
      expect(desc).toContain('claude-sonnet-4-5');
    });

    it('mentions multi-provider', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('multi-provider');
    });
  });

  it('has arg prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('arg');
  });
});

// ─── Copilot Adapter ─────────────────────────────────────────────

describe('CopilotAdapter', () => {
  const adapter = new CopilotAdapter();

  describe('extractResponse', () => {
    it('extracts plain text response', () => {
      const result = adapter.extractResponse('Hello from Copilot', 0);
      expect(result!.content).toBe('Hello from Copilot');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('strips ANSI escape codes', () => {
      const ansiText = '\x1b[32mGreen text\x1b[0m and \x1b[1mbold\x1b[0m';
      const result = adapter.extractResponse(ansiText, 0);
      expect(result!.content).toBe('Green text and bold');
    });

    it('strips complex ANSI sequences', () => {
      const ansiText = '\x1b[38;5;196mRed\x1b[0m \x1b[48;2;0;255;0mGreen BG\x1b[0m';
      const result = adapter.extractResponse(ansiText, 0);
      expect(result!.content).toBe('Red Green BG');
    });

    it('trims whitespace from response', () => {
      const result = adapter.extractResponse('  Hello  \n', 0);
      expect(result!.content).toBe('Hello');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   \n  ', 0)).toBeNull();
    });

    it('returns null for ANSI-only output', () => {
      expect(adapter.extractResponse('\x1b[0m   \x1b[32m', 0)).toBeNull();
    });

    it('handles multiline text', () => {
      const text = 'Line 1\nLine 2\nLine 3';
      const result = adapter.extractResponse(text, 0);
      expect(result!.content).toBe(text);
    });

    it('includes exitCode in metadata', () => {
      const result = adapter.extractResponse('Some output', 1);
      expect(result!.metadata?.exitCode).toBe(1);
    });

    it('works regardless of exit code', () => {
      const result = adapter.extractResponse('Some output', 1);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('Some output');
    });
  });

  describe('buildArgs', () => {
    it('builds correct args with prompt', () => {
      const args = adapter.buildArgs(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['-p', 'Hello, world', '--model', 'claude-sonnet-4-5', '--allow-all-paths']);
    });

    it('uses provided model', () => {
      const args = adapter.buildArgs(makeInput(), 'gpt-4o');
      expect(args).toContain('gpt-4o');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('omits -p and prompt from args', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['--model', 'claude-sonnet-4-5', '--allow-all-paths']);
      expect(args).not.toContain('-p');
      expect(args).not.toContain('Hello, world');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'Copilot CLI', command: 'copilot' }));
      expect(desc).toContain('Copilot CLI');
      expect(desc).toContain('copilot');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'claude-sonnet-4-5' }));
      expect(desc).toContain('claude-sonnet-4-5');
    });

    it('mentions GitHub', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('GitHub');
    });
  });

  it('has arg prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('arg');
  });
});

// ─── Cursor Adapter ──────────────────────────────────────────────

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  describe('extractResponse', () => {
    it('extracts JSON message field', () => {
      const json = JSON.stringify({ message: 'Hello from Cursor' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Hello from Cursor');
      expect(result!.metadata?.jsonFormat).toBe('cursor');
    });

    it('extracts JSON content field', () => {
      const json = JSON.stringify({ content: 'Content field' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Content field');
      expect(result!.metadata?.jsonFormat).toBe('cursor');
    });

    it('extracts JSON response field', () => {
      const json = JSON.stringify({ response: 'Response field' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Response field');
      expect(result!.metadata?.jsonFormat).toBe('cursor');
    });

    it('prefers message over content', () => {
      const json = JSON.stringify({ message: 'from-message', content: 'from-content' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('from-message');
    });

    it('handles NDJSON by taking last complete object', () => {
      const ndjson = [
        JSON.stringify({ type: 'progress', data: 'working...' }),
        JSON.stringify({ message: 'Final result' }),
      ].join('\n');
      const result = adapter.extractResponse(ndjson, 0);
      expect(result!.content).toBe('Final result');
      expect(result!.metadata?.jsonFormat).toBe('cursor');
    });

    it('falls back to plain text for non-JSON', () => {
      const result = adapter.extractResponse('Plain text from cursor', 0);
      expect(result!.content).toBe('Plain text from cursor');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });

    it('returns null for whitespace-only output', () => {
      expect(adapter.extractResponse('   \n\t  ', 0)).toBeNull();
    });

    it('includes exitCode in metadata', () => {
      const json = JSON.stringify({ message: 'data' });
      const result = adapter.extractResponse(json, 1);
      expect(result!.metadata?.exitCode).toBe(1);
    });

    it('falls back on malformed JSON', () => {
      const result = adapter.extractResponse('{broken json{', 0);
      expect(result!.content).toBe('{broken json{');
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('handles non-string message field by falling back', () => {
      const json = JSON.stringify({ message: 42 });
      const result = adapter.extractResponse(json, 0);
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });

    it('falls back to plain text when JSON has no message/content/response field', () => {
      const json = JSON.stringify({ other: 'data' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe(json);
      expect(result!.metadata?.jsonFormat).toBe('plaintext');
    });
  });

  describe('buildArgs', () => {
    it('builds correct args with prompt', () => {
      const args = adapter.buildArgs(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['--print', '--output-format', 'json', '--model', 'claude-sonnet-4-5', '--force', 'Hello, world']);
    });

    it('uses provided model', () => {
      const args = adapter.buildArgs(makeInput(), 'gemini-2.5-flash');
      expect(args).toContain('gemini-2.5-flash');
    });
  });

  describe('buildArgsWithoutPrompt', () => {
    it('omits prompt from args', () => {
      const args = adapter.buildArgsWithoutPrompt!(makeInput(), 'claude-sonnet-4-5');
      expect(args).toEqual(['--print', '--output-format', 'json', '--model', 'claude-sonnet-4-5', '--force']);
      expect(args).not.toContain('Hello, world');
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'Cursor CLI', command: 'cursor-agent' }));
      expect(desc).toContain('Cursor CLI');
      expect(desc).toContain('cursor-agent');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'claude-sonnet-4-5' }));
      expect(desc).toContain('claude-sonnet-4-5');
    });

    it('mentions Cursor', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).toContain('Cursor');
    });
  });

  it('has arg prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('arg');
  });
});

// ─── Generic Adapter ─────────────────────────────────────────────

describe('GenericAdapter', () => {
  const adapter = new GenericAdapter();

  describe('extractResponse', () => {
    it('extracts plain text via shared extractor', () => {
      const result = adapter.extractResponse('This is a longer plain text response', 0);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('This is a longer plain text response');
    });

    it('extracts JSON response field', () => {
      const json = JSON.stringify({ response: 'Hello from generic JSON response' });
      const result = adapter.extractResponse(json, 0);
      expect(result!.content).toBe('Hello from generic JSON response');
    });

    it('returns null for short output (shared extractor has 10-char min)', () => {
      expect(adapter.extractResponse('short', 0)).toBeNull();
    });

    it('returns null for empty output', () => {
      expect(adapter.extractResponse('', 0)).toBeNull();
    });
  });

  describe('buildDescription', () => {
    it('includes display name and command', () => {
      const desc = adapter.buildDescription(makeConfig({ displayName: 'MyTool', command: 'mytool' }));
      expect(desc).toContain('MyTool');
      expect(desc).toContain('mytool');
    });

    it('includes default model', () => {
      const desc = adapter.buildDescription(makeConfig({ defaultModel: 'custom-v1' }));
      expect(desc).toContain('custom-v1');
    });

    it('does not mention specific vendors', () => {
      const desc = adapter.buildDescription(makeConfig());
      expect(desc).not.toContain('Anthropic');
      expect(desc).not.toContain('Google');
      expect(desc).not.toContain('OpenAI');
    });
  });

  it('has arg prompt delivery', () => {
    expect(adapter.promptDelivery).toBe('arg');
  });

  it('does not define buildArgsWithoutPrompt', () => {
    expect(adapter.buildArgsWithoutPrompt).toBeUndefined();
  });
});

// ─── Adapter Registry ────────────────────────────────────────────

describe('getAdapter', () => {
  it('returns ClaudeAdapter for "claude"', () => {
    expect(getAdapter('claude')).toBeInstanceOf(ClaudeAdapter);
  });

  it('returns GeminiAdapter for "gemini"', () => {
    expect(getAdapter('gemini')).toBeInstanceOf(GeminiAdapter);
  });

  it('returns CodexAdapter for "codex"', () => {
    expect(getAdapter('codex')).toBeInstanceOf(CodexAdapter);
  });

  it('returns GenericAdapter for "generic"', () => {
    expect(getAdapter('generic')).toBeInstanceOf(GenericAdapter);
  });

  it('returns OpenCodeAdapter for "opencode"', () => {
    expect(getAdapter('opencode')).toBeInstanceOf(OpenCodeAdapter);
  });

  it('returns CopilotAdapter for "copilot"', () => {
    expect(getAdapter('copilot')).toBeInstanceOf(CopilotAdapter);
  });

  it('returns CursorAdapter for "cursor"', () => {
    expect(getAdapter('cursor')).toBeInstanceOf(CursorAdapter);
  });

  it('returns GenericAdapter for unknown arg builder', () => {
    expect(getAdapter('unknown-backend' as any)).toBeInstanceOf(GenericAdapter);
  });
});
