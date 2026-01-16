import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '../utils/memoryRetriever';

describe('MemoryRetriever conditional rules boosting', () => {
  it('applies boost when metadata matches rule (substring)', async () => {
    const retriever = new MemoryRetriever();

    const a = { text: 'a', similarity: 0.5, metadata: { keywords: 'shiny silver sword' } } as any;
    const b = { text: 'b', similarity: 0.5, metadata: { keywords: 'rusty bronze shield' } } as any;

    const fakeStore = { query: async () => [a, b] } as any;
    (retriever as any).vectorStore = fakeStore;

    const rules = [{ field: 'keywords', match: 'silver', boost: 2 }];

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      conditionalRules: rules
    });

    expect(results[0].text).toBe('a');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });

  it('supports exact match when configured', async () => {
    const retriever = new MemoryRetriever();

    const a = { text: 'a', similarity: 0.6, metadata: { tag: 'important' } } as any;
    const b = { text: 'b', similarity: 0.9, metadata: { tag: 'not-important' } } as any;

    const fakeStore = { query: async () => [a, b] } as any;
    (retriever as any).vectorStore = fakeStore;

    const rules = [{ field: 'tag', match: 'important', boost: 2, matchType: 'exact' }];

    const results = await (retriever as any).queryMemories('test', {
      worldId: 1,
      characterId: 'char1',
      topK: 2,
      conditionalRules: rules
    });

    // a should be boosted from 0.6 -> 1.2 and come before b
    expect(results[0].text).toBe('a');
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
  });
});
