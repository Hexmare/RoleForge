import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as memMod from '../utils/memoryRetriever.js';
import { MemoryRetriever } from '../utils/memoryRetriever.js';

describe('MemoryRetriever.retrieve()', () => {
  let retriever: MemoryRetriever;

  beforeEach(async () => {
    retriever = new MemoryRetriever();
    // inject mock vectorStore on the instance used by queryMemories
    (retriever as any).vectorStore = {
      query: async (query: string, scope: string, topK: number, minSim: number) => {
        // Return a synthetic result that includes the scope for assertion
        return [{ text: `mocked:${scope}:${query}`, similarity: 0.9, metadata: { timestamp: Date.now() } }];
      }
    };
  });

  it('parses scope and delegates to queryMemories', async () => {
    const results = await retriever.retrieve({ scope: 'world_7_char_abc123', query: 'hello world' } as any);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('mocked:world_7_char_abc123');
  });

  it('returns empty array on failure (graceful)', async () => {
    // Replace vectorStore with one that throws
    (retriever as any).vectorStore = {
      query: async () => { throw new Error('boom'); }
    };
    const results = await retriever.retrieve({ scope: 'world_1_char_x', query: 'x' } as any);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});
