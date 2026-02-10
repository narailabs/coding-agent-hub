import { describe, it, expect } from 'vitest';
import { extractMessageContent, StdoutCollector } from '../src/message-extractor.js';

describe('extractMessageContent', () => {
  it('returns null for empty string', () => {
    expect(extractMessageContent('')).toBeNull();
  });

  it('returns null for very short output', () => {
    expect(extractMessageContent('hi')).toBeNull();
  });

  it('extracts from JSON with response field (Gemini format)', () => {
    const json = JSON.stringify({ response: 'This is the Gemini response content here.' });
    const result = extractMessageContent(json);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('This is the Gemini response content here.');
    expect(result!.metadata?.jsonFormat).toBe('gemini');
  });

  it('extracts from JSON with content field', () => {
    const json = JSON.stringify({ content: 'This is the generic content field value.' });
    const result = extractMessageContent(json);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('This is the generic content field value.');
    expect(result!.metadata?.jsonFormat).toBe('generic');
  });

  it('extracts from JSON with result field (Claude format)', () => {
    const json = JSON.stringify({ result: 'This is the Claude result output content.' });
    const result = extractMessageContent(json);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('This is the Claude result output content.');
    expect(result!.metadata?.jsonFormat).toBe('claude');
  });

  it('falls back to plain text for non-JSON', () => {
    const text = 'This is a plain text response from the agent.';
    const result = extractMessageContent(text);

    expect(result).not.toBeNull();
    expect(result!.content).toBe(text);
    expect(result!.metadata?.jsonFormat).toBe('plaintext');
  });

  it('includes exitCode in metadata', () => {
    const text = 'This is a plain text response with exit code.';
    const result = extractMessageContent(text, 0);

    expect(result!.metadata?.exitCode).toBe(0);
  });

  it('ignores JSON with very short content field', () => {
    const json = JSON.stringify({ content: 'short' });
    const result = extractMessageContent(json);

    // Should fall back to plain text of the whole JSON
    expect(result).not.toBeNull();
    expect(result!.metadata?.jsonFormat).toBe('plaintext');
  });
});

describe('StdoutCollector', () => {
  it('collects chunks and converts to string', () => {
    const collector = new StdoutCollector();
    collector.add(Buffer.from('Hello '));
    collector.add(Buffer.from('World'));

    expect(collector.toString()).toBe('Hello World');
    expect(collector.size()).toBe(11);
    expect(collector.wasTruncated()).toBe(false);
  });

  it('reports correct size', () => {
    const collector = new StdoutCollector();
    collector.add(Buffer.from('12345'));
    expect(collector.size()).toBe(5);
  });

  it('truncates at 5MB limit', () => {
    const collector = new StdoutCollector();
    const bigChunk = Buffer.alloc(3 * 1024 * 1024, 'x');

    collector.add(bigChunk); // 3MB
    expect(collector.wasTruncated()).toBe(false);

    collector.add(bigChunk); // Would be 6MB, truncated
    expect(collector.wasTruncated()).toBe(true);
    expect(collector.size()).toBe(5 * 1024 * 1024);
  });

  it('ignores chunks after truncation', () => {
    const collector = new StdoutCollector();
    const bigChunk = Buffer.alloc(5 * 1024 * 1024 + 1, 'x');

    collector.add(bigChunk);
    expect(collector.wasTruncated()).toBe(true);

    const sizeBefore = collector.size();
    collector.add(Buffer.from('ignored'));
    expect(collector.size()).toBe(sizeBefore);
  });
});
