import { describe, it, expect } from 'vitest';
import { computeDecayAdjustedScore } from '../utils/memoryHelpers.js';
import { MemoryRetriever } from '../utils/memoryRetriever.js';

describe('computeDecayAdjustedScore message-count and fallbacks', () => {
  it('uses direct message count from metadata when present', async () => {
    const orig = 1.0;
    const metadata: any = { messageCountSince: 50 };
    const cfg: any = { enabled: true, mode: 'messageCount', halfLife: 50, floor: 0.05 };

    const adjusted = await computeDecayAdjustedScore(orig, metadata, cfg);
    // halfLife == 50 and messageCountSince == 50 => factor = 0.5
    expect(adjusted).toBeCloseTo(0.5, 6);
  });

  it('calls messageServiceOverride.getMessageCountSince when metadata missing count', async () => {
    const orig = 1.0;
    const metadata: any = { sceneId: 1, timestamp: new Date().toISOString() };
    const cfg: any = { enabled: true, mode: 'messageCount', halfLife: 50, floor: 0.01 };

    const messageServiceOverride = {
      getMessageCountSince: async (_sceneId: number, _ts: any) => {
        return 100; // force large count
      }
    };

    const adjusted = await computeDecayAdjustedScore(orig, metadata, cfg, messageServiceOverride as any);
    // pow(0.5, 100/50) == 0.25
    expect(adjusted).toBeCloseTo(0.25, 6);
  });

  it('falls back to time-based when message count lookup fails and respects floor', async () => {
    const orig = 1.0;
    const metadata: any = { sceneId: 1, timestamp: new Date(0).toISOString() }; // epoch -> very old
    const cfg: any = { enabled: true, mode: 'messageCount', halfLife: 1, floor: 0.07 };

    const messageServiceOverride = {
      getMessageCountSince: async () => { throw new Error('unavailable'); }
    };

    const adjusted = await computeDecayAdjustedScore(orig, metadata, cfg, messageServiceOverride as any);
    // Very old timestamp should result in raw factor << floor, so final == floor
    expect(adjusted).toBeCloseTo(cfg.floor, 6);
  });
});

describe('MemoryRetriever per-query temporalDecay override', () => {
  it('applies per-query temporalDecay override and floor', async () => {
    const retriever = new MemoryRetriever();

    // inject mock vectorStore returning an old-memory with similarity 0.9
    (retriever as any).vectorStore = {
      query: async (_query: string, _scope: string, _topK: number, _minSim: number) => {
        return [ { text: 'ancient tomb', similarity: 0.9, metadata: { timestamp: new Date(0).toISOString() } } ];
      }
    };

    const options: any = {
      worldId: 1,
      characterId: 'c1',
      topK: 3,
      minSimilarity: 0,
      temporalDecay: { enabled: true, mode: 'time', halfLife: 0.0001, floor: 0.2 },
      conditionalRules: []
    };

    const results = await retriever.queryMemories('tomb', options);
    expect(results.length).toBeGreaterThan(0);
    // original 0.9 * floor 0.2 => 0.18
    expect(results[0].similarity).toBeCloseTo(0.18, 3);
  });
});
