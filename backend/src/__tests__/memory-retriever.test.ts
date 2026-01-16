import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '../utils/memoryRetriever.js';
import { computeDecayAdjustedScore, applyConditionalBoost } from '../utils/memoryHelpers.js';

describe('MemoryRetriever and helpers', () => {
  it('computeDecayAdjustedScore time-based via helper', async () => {
    const originalScore = 1.0;
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const metadata: any = { timestamp: new Date(now - twoDaysMs).toISOString() };

    const decayCfg = { enabled: true, mode: 'time', halfLife: 1 /* days */ , floor: 0.1 };

    const adjusted = await computeDecayAdjustedScore(originalScore, metadata, decayCfg);
    expect(adjusted).toBeCloseTo(0.25, 2);
  });

  it('MemoryRetriever.queryMemories applies conditional boost', async () => {
    const retriever = new MemoryRetriever();

    // inject mock vectorStore
    (retriever as any).vectorStore = {
      query: async (_query: string, _scope: string, _topK: number, _minSim: number) => {
        return [
          { text: 'ancient sword', similarity: 0.5, metadata: { timestamp: Date.now().toString(), keywords: ['silver'] } }
        ];
      }
    };

    const options: any = {
      worldId: 1,
      characterId: 'char1',
      topK: 3,
      minSimilarity: 0,
      temporalDecay: { enabled: false },
      conditionalRules: [{ field: 'keywords', match: 'silver', boost: 2.0 }]
    };

    const results = await retriever.queryMemories('sword', options);
    expect(results.length).toBeGreaterThan(0);
    // boosted from 0.5 -> 1.0
    expect(results[0].similarity).toBeCloseTo(1.0, 3);
  });
});
