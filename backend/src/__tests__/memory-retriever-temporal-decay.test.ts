import { describe, it, expect, beforeEach } from 'vitest';

describe('MemoryRetriever temporal decay integration', () => {
  let retriever: any;

  beforeEach(async () => {
    const mod = await import('../utils/memoryRetriever.js');
    const MemoryRetrieverClass = mod.MemoryRetriever;
    retriever = new MemoryRetrieverClass();

    const now = Date.now();
    const oldTs = new Date(now - (30 * 24 * 60 * 60 * 1000)).toISOString(); // 30 days ago
    const recentTs = new Date(now - (1 * 60 * 1000)).toISOString(); // 1 minute ago

    const fakeResults = [
      { text: 'recent', similarity: 0.9, metadata: { timestamp: recentTs } },
      { text: 'old', similarity: 0.9, metadata: { timestamp: oldTs } },
    ];

    // Fake vector store that returns same two items regardless of scope
    const fakeVectorStore = {
      query: async (_query: string, _scope: string, _topK: number, _minSimilarity: number) => {
        return fakeResults;
      }
    };

    retriever.vectorStore = fakeVectorStore;
  });

  it('applies time-based decay when enabled via per-query override', async () => {
    const opts = {
      worldId: 1,
      characterName: 'charA',
      topK: 5,
      temporalDecay: { enabled: true, mode: 'time', halfLife: 7, floor: 0.1 }
    };

    const results = await retriever.queryMemories('anything', opts);
    expect(results.length).toBeGreaterThanOrEqual(2);

    // recent should rank above old after decay
    expect(results[0].text).toBe('recent');
    expect(results[1].text).toBe('old');

    // recent similarity should remain near original (0.9) while old is reduced by floor
    const recentSim = results.find((r: any) => r.text === 'recent')!.similarity;
    const oldSim = results.find((r: any) => r.text === 'old')!.similarity;
    expect(recentSim).toBeGreaterThan(oldSim);
    expect(recentSim).toBeGreaterThan(0.8);
    expect(oldSim).toBeCloseTo(0.9 * 0.1, 6);
  });
});
